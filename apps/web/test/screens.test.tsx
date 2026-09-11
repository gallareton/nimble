import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { expect, it, vi } from 'vitest'
import { CodeDisplay } from '../src/components/CodeDisplay'
import { StatusBadge } from '../src/components/StatusBadge'
import { Approval } from '../src/screens/Approval'
import { Charge, toMinorUnits } from '../src/screens/Charge'
import { Products } from '../src/screens/Products'
import { RemoteCharge } from '../src/screens/RemoteCharge'
import { Receipt } from '../src/screens/Receipt'
import { ApiError } from '../src/api/client'
import { Settings } from '../src/screens/Settings'
import { NewRemoteCharge } from '../src/screens/NewRemoteCharge'
import { UnitSwitch } from '../src/components/UnitSwitch'

it('CodeDisplay groups digits and is screen-reader friendly', () => {
  render(<CodeDisplay code="482731" />)
  expect(screen.getByText('482 731')).toBeTruthy()
  expect(screen.getByLabelText(/4 8 2 7 3 1/)).toBeTruthy()
})

it('StatusBadge renders text labels, only CONFIRMED is success', () => {
  render(<StatusBadge status="SUBMITTED" />)
  expect(screen.getByText(/submitted/i)).toBeTruthy()
  expect(screen.queryByText(/paid/i)).toBeNull()
})

it('Approval shows all mandatory fields and drives intent→send→register on confirm', async () => {
  const api = {
    getSession: vi.fn(async () => ({ sessionId: 's1', status: 'AWAITING_PAYER_APPROVAL', role: 'payer',
      expiresAt: new Date().toISOString(),
      counterpart: { displayName: 'Kiosk', verificationStatus: 'unverified', addressTail: 'XY12' },
      charge: { chargeId: 'c1', version: 1, amountLuna: '250000', asset: 'NIM', network: 'nimiq',
        reference: 'Soda', recipientAddress: 'NQ99 RECV' } })),
    intent: vi.fn(async () => ({ reconciliationToken: 'ab'.repeat(16), recipientAddress: 'NQ99 RECV',
      amountLuna: '250000', validUntil: new Date().toISOString() })),
    registerTx: vi.fn(async () => {}),
    reject: vi.fn(async () => {}),
    openEvents: vi.fn(async () => () => {}),
    getAffordability: vi.fn(async () => ({ sufficient: null, shortfallLuna: null })),
  }
  const wallet = { sendTransaction: vi.fn(async () => ({ hash: 'deadbeef' })) }
  render(
    <MemoryRouter initialEntries={['/session/s1']}>
      <Routes>
        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
        <Route path="/session/:id" element={<Approval api={api as any} wallet={wallet as any} />} />
      </Routes>
    </MemoryRouter>,
  )

  await screen.findByText('Kiosk')
  expect(screen.getByText(/unverified profile/i)).toBeTruthy()
  expect(screen.getByText('2.5 NIM')).toBeTruthy()
  expect(screen.getByText(/XY12/)).toBeTruthy()
  expect(screen.getByText('Soda')).toBeTruthy()

  fireEvent.click(screen.getByRole('button', { name: /confirm/i }))
  await waitFor(() => expect(api.registerTx).toHaveBeenCalledWith('c1', 'deadbeef', expect.any(String)))
  expect(wallet.sendTransaction).toHaveBeenCalledWith(
    expect.objectContaining({ recipient: 'NQ99 RECV', valueLuna: 250000n, data: 'ab'.repeat(16) }))
})

it('Approval shows a shortfall warning but leaves Confirm enabled when sufficient is false', async () => {
  cleanup()
  const api = {
    getSession: vi.fn(async () => ({ sessionId: 's1', status: 'AWAITING_PAYER_APPROVAL', role: 'payer',
      expiresAt: new Date().toISOString(),
      counterpart: { displayName: 'Kiosk', verificationStatus: 'unverified', addressTail: 'XY12' },
      charge: { chargeId: 'c1', version: 1, amountLuna: '250000', asset: 'NIM', network: 'nimiq',
        reference: 'Soda', recipientAddress: 'NQ99 RECV' } })),
    getAffordability: vi.fn(async () => ({ sufficient: false, shortfallLuna: '50000' })),
    openEvents: vi.fn(async () => () => {}),
  }
  const wallet = { sendTransaction: vi.fn(async () => ({ hash: 'deadbeef' })) }
  render(
    <MemoryRouter initialEntries={['/session/s1']}>
      <Routes>
        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
        <Route path="/session/:id" element={<Approval api={api as any} wallet={wallet as any} />} />
      </Routes>
    </MemoryRouter>,
  )

  await screen.findByText('Kiosk')
  await waitFor(() => expect(api.getAffordability).toHaveBeenCalledWith('c1'))
  expect(await screen.findByText(/short by 0\.5 NIM/i)).toBeTruthy()
  const confirmBtn = screen.getByRole('button', { name: /confirm/i }) as HTMLButtonElement
  expect(confirmBtn.disabled).toBe(false)
})

it('Approval shows nothing when affordability is unknown (null)', async () => {
  cleanup()
  const api = {
    getSession: vi.fn(async () => ({ sessionId: 's1', status: 'AWAITING_PAYER_APPROVAL', role: 'payer',
      expiresAt: new Date().toISOString(),
      counterpart: { displayName: 'Kiosk', verificationStatus: 'unverified', addressTail: 'XY12' },
      charge: { chargeId: 'c1', version: 1, amountLuna: '250000', asset: 'NIM', network: 'nimiq',
        reference: 'Soda', recipientAddress: 'NQ99 RECV' } })),
    getAffordability: vi.fn(async () => ({ sufficient: null, shortfallLuna: null })),
    openEvents: vi.fn(async () => () => {}),
  }
  const wallet = { sendTransaction: vi.fn(async () => ({ hash: 'deadbeef' })) }
  render(
    <MemoryRouter initialEntries={['/session/s1']}>
      <Routes>
        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
        <Route path="/session/:id" element={<Approval api={api as any} wallet={wallet as any} />} />
      </Routes>
    </MemoryRouter>,
  )

  await screen.findByText('Kiosk')
  await waitFor(() => expect(api.getAffordability).toHaveBeenCalledWith('c1'))
  expect(screen.queryByText(/short by/i)).toBeNull()
})

it('Approval shows nothing when affordability is sufficient (true)', async () => {
  cleanup()
  const api = {
    getSession: vi.fn(async () => ({ sessionId: 's1', status: 'AWAITING_PAYER_APPROVAL', role: 'payer',
      expiresAt: new Date().toISOString(),
      counterpart: { displayName: 'Kiosk', verificationStatus: 'unverified', addressTail: 'XY12' },
      charge: { chargeId: 'c1', version: 1, amountLuna: '250000', asset: 'NIM', network: 'nimiq',
        reference: 'Soda', recipientAddress: 'NQ99 RECV' } })),
    getAffordability: vi.fn(async () => ({ sufficient: true, shortfallLuna: null })),
    openEvents: vi.fn(async () => () => {}),
  }
  const wallet = { sendTransaction: vi.fn(async () => ({ hash: 'deadbeef' })) }
  render(
    <MemoryRouter initialEntries={['/session/s1']}>
      <Routes>
        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
        <Route path="/session/:id" element={<Approval api={api as any} wallet={wallet as any} />} />
      </Routes>
    </MemoryRouter>,
  )

  await screen.findByText('Kiosk')
  await waitFor(() => expect(api.getAffordability).toHaveBeenCalledWith('c1'))
  expect(screen.queryByText(/short by/i)).toBeNull()
})

// --- Charge: the two-step till (R7) -------------------------------------
//
// Step 1 asks "how much?" (catalog, cart, or a typed amount), step 2 asks
// how the money arrives and takes the payer's code. Every test below walks
// that path: pick a unit, fill Amount, Continue, then fill Code and tap
// Request payment.

const fiatApi = (extra: Record<string, unknown> = {}) => ({
  getRate: vi.fn(async () => ({ usdPerNim: 0.005 })),
  getNetwork: vi.fn(async () => ({ network: 'test', height: 1 })),
  ...extra,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
}) as any

const fillAmount = (value: string) =>
  fireEvent.change(screen.getByLabelText(/amount/i), { target: { value } })
const clickContinue = () => fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
const fillCode = (value = '123456') =>
  fireEvent.change(screen.getByLabelText(/code/i), { target: { value } })
const clickRequestPayment = () => fireEvent.click(screen.getByText(/request payment/i))

it('Charge defaults to USD and sends fiat minor units, never amountLuna', async () => {
  cleanup() // this suite doesn't auto-cleanup between tests (no vitest globals)
  localStorage.clear()
  const claim = vi.fn(async (_code: string, _opts?: Record<string, unknown>) => ({ sessionId: 's1' }))
  const api = fiatApi({ claim })
  render(<MemoryRouter><Charge api={api} /></MemoryRouter>)

  fillAmount('12.34')
  clickContinue()
  fillCode()
  clickRequestPayment()

  await waitFor(() => expect(claim).toHaveBeenCalled())
  expect(claim.mock.calls[0][1]).toMatchObject({ fiatAmountMinor: 1234, fiatCurrency: 'USD' })
  expect(claim.mock.calls[0][1]).not.toHaveProperty('amountLuna')
})

it('Charge in NIM mode sends amountLuna, never fiatAmountMinor', async () => {
  cleanup()
  localStorage.clear()
  const claim = vi.fn(async (_code: string, _opts?: Record<string, unknown>) => ({ sessionId: 's1' }))
  const api = fiatApi({ claim })
  render(<MemoryRouter><Charge api={api} /></MemoryRouter>)

  fireEvent.click(screen.getByRole('button', { name: /^NIM$/i }))
  fillAmount('2.5')
  clickContinue()
  fillCode()
  clickRequestPayment()

  await waitFor(() => expect(claim).toHaveBeenCalled())
  expect(claim.mock.calls[0][1]).toMatchObject({ amountLuna: '250000' })
  expect(claim.mock.calls[0][1]).not.toHaveProperty('fiatAmountMinor')
  expect(claim.mock.calls[0][1]).not.toHaveProperty('fiatCurrency')
})

it('Charge step 1: Continue stays disabled until there is an amount', async () => {
  cleanup()
  localStorage.clear()
  const api = fiatApi({ claim: vi.fn() })
  render(<MemoryRouter><Charge api={api} /></MemoryRouter>)

  expect(screen.getByRole('button', { name: 'Continue' }).hasAttribute('disabled')).toBe(true)
  fillAmount('1.00')
  expect(screen.getByRole('button', { name: 'Continue' }).hasAttribute('disabled')).toBe(false)
})

it('Charge remembers the last chosen unit across mounts via localStorage', async () => {
  cleanup()
  localStorage.clear()
  const api = fiatApi({ claim: vi.fn(async () => ({ sessionId: 's1' })) })
  render(<MemoryRouter><Charge api={api} /></MemoryRouter>)
  fireEvent.click(screen.getByRole('button', { name: /^NIM$/i }))
  cleanup()

  render(<MemoryRouter><Charge api={api} /></MemoryRouter>)
  expect(screen.getByRole('button', { name: /^NIM$/i }).getAttribute('aria-pressed')).toBe('true')
  expect(screen.getByLabelText(/amount/i)).toBeTruthy()
})

it('Charge in USD mode: an invalid amount shows the USD message and never calls claim', async () => {
  cleanup()
  localStorage.clear()
  const claim = vi.fn(async () => ({ sessionId: 's1' }))
  const api = fiatApi({ claim })
  render(<MemoryRouter><Charge api={api} /></MemoryRouter>)

  fillAmount('12.345')
  clickContinue()

  await screen.findByText(/valid amount/i)
  expect(screen.queryByText(/valid nim amount/i)).toBeNull()
  expect(screen.queryByText(/request payment/i)).toBeNull() // never left step 1
  expect(claim).not.toHaveBeenCalled()
})

it('Charge in NIM mode: an invalid amount shows the NIM message and never calls claim', async () => {
  cleanup()
  localStorage.clear()
  const claim = vi.fn(async () => ({ sessionId: 's1' }))
  const api = fiatApi({ claim })
  render(<MemoryRouter><Charge api={api} /></MemoryRouter>)

  fireEvent.click(screen.getByRole('button', { name: /^NIM$/i }))
  fillAmount('2.123456')
  clickContinue()

  await screen.findByText(/valid nim amount/i)
  expect(claim).not.toHaveBeenCalled()
})

it('Charge in NIM mode: a comma decimal ("1,50") sends the same amountLuna as a dot decimal ("1.50")', async () => {
  cleanup()
  localStorage.clear()
  const claim = vi.fn(async (_code: string, _opts?: Record<string, unknown>) => ({ sessionId: 's1' }))
  const api = fiatApi({ claim })
  render(<MemoryRouter><Charge api={api} /></MemoryRouter>)

  fireEvent.click(screen.getByRole('button', { name: /^NIM$/i }))
  fillAmount('1,50')
  clickContinue()
  fillCode()
  clickRequestPayment()

  await waitFor(() => expect(claim).toHaveBeenCalled())
  expect(claim.mock.calls[0][1]).toMatchObject({ amountLuna: '150000' })
})

it('Charge in NIM mode: "0" shows the NIM validation message and never calls claim', async () => {
  cleanup()
  localStorage.clear()
  const claim = vi.fn(async () => ({ sessionId: 's1' }))
  const api = fiatApi({ claim })
  render(<MemoryRouter><Charge api={api} /></MemoryRouter>)

  fireEvent.click(screen.getByRole('button', { name: /^NIM$/i }))
  fillAmount('0')
  clickContinue()

  await screen.findByText(/valid nim amount/i)
  expect(claim).not.toHaveBeenCalled()
})

it('toMinorUnits parses fiat text to integer minor units, rejecting garbage and float-unsafe input', () => {
  expect(toMinorUnits('12.34')).toBe(1234)
  expect(toMinorUnits('12')).toBe(1200)
  expect(toMinorUnits('12,34')).toBe(1234)
  expect(toMinorUnits('12.345')).toBeNull() // more than 2 decimals — never round behind the cashier's back
  expect(toMinorUnits('0')).toBeNull() // must be positive
  expect(toMinorUnits('-1')).toBeNull()
  expect(toMinorUnits('abc')).toBeNull()
  expect(toMinorUnits('')).toBeNull()
  expect(toMinorUnits('1'.repeat(20))).toBeNull() // a till will never see a 20-digit price
})

// --- Charge: catalog and cart -------------------------------------------

const coffee = { id: 'p1', name: 'Coffee', priceMinor: 250, category: null, pinned: true, active: true, sortOrder: 0 }

const nimSale = (id: string) => ({ id, status: 'awaiting', state: 'awaiting',
  paymentMethod: 'nim', totalMinor: 250, fiatCurrency: 'USD', shiftId: null, chargeId: null,
  items: [], createdAt: 'x', paidAt: null })

it('Charge with no catalog shows neither a Cart nor a product search', async () => {
  cleanup()
  localStorage.clear()
  const api = fiatApi({ claim: vi.fn() })
  render(<MemoryRouter><Charge api={api} /></MemoryRouter>)
  expect(screen.queryByText('Cart')).toBeNull()
  expect(screen.queryByText('Search products')).toBeNull()
  expect(screen.getByRole('button', { name: 'Continue' })).toBeTruthy()
})

it('Charge step 1 no longer carries a "Manage products" link', async () => {
  cleanup()
  localStorage.clear()
  const api = fiatApi({ getProducts: vi.fn(async () => [coffee]) })
  render(<MemoryRouter><Charge api={api} /></MemoryRouter>)
  await screen.findByText('Coffee')
  expect(screen.queryByText(/manage products/i)).toBeNull()
})

it('Charge step 1 links out to the remote bill screen', async () => {
  cleanup()
  localStorage.clear()
  const api = fiatApi({ claim: vi.fn() })
  render(<MemoryRouter><Charge api={api} /></MemoryRouter>)
  const link = screen.getByRole('link', { name: /Bill someone who isn't here/i })
  expect(link.getAttribute('href')).toBe('/charge/remote')
})

it('tapping a 2.50 product twice sums the cart to 5.00, counted in integer cents', async () => {
  cleanup()
  localStorage.clear()
  const api = fiatApi({ getProducts: vi.fn(async () => [coffee]) })
  render(<MemoryRouter><Charge api={api} /></MemoryRouter>)
  const tap = () => fireEvent.click(screen.getByRole('button', { name: /Coffee/ }))
  await waitFor(() => expect(screen.getByRole('button', { name: /Coffee/ })).toBeTruthy())
  tap()
  tap()
  await waitFor(() => expect(screen.getAllByText(/5\.00/).length).toBeGreaterThan(0))
})

it('a cart paid in cash records the sale and returns to step 1 with a confirmation', async () => {
  cleanup()
  localStorage.clear()
  const createSale = vi.fn(async (_body: { items: unknown[]; paymentMethod: string }) => ({ id: 'sale1', status: 'paid', state: 'paid',
    paymentMethod: 'cash', totalMinor: 500, fiatCurrency: 'USD', shiftId: null, chargeId: null,
    items: [], createdAt: 'x', paidAt: 'x' }))
  const api = fiatApi({ getProducts: vi.fn(async () => [coffee]), createSale })
  render(<MemoryRouter><Charge api={api} /></MemoryRouter>)
  const coffeeBtn = () => screen.getByRole('button', { name: /Coffee/ })
  await waitFor(() => expect(coffeeBtn()).toBeTruthy())
  fireEvent.click(coffeeBtn())
  fireEvent.click(coffeeBtn())
  expect(screen.getAllByText(/5\.00/).length).toBeGreaterThan(0)

  clickContinue()
  fireEvent.click(screen.getByRole('button', { name: /^Cash$/i }))
  fireEvent.click(screen.getByRole('button', { name: /record cash sale/i }))

  await waitFor(() => expect(createSale).toHaveBeenCalledTimes(1))
  const [body] = createSale.mock.calls[0]
  expect(body.paymentMethod).toBe('cash')
  expect(body.items).toEqual([{ productId: 'p1', quantity: 2 }])
  await waitFor(() => expect(screen.getByText(/Recorded/i)).toBeTruthy())
  // back on step 1, with the cart cleared
  expect(screen.getByRole('button', { name: 'Continue' })).toBeTruthy()
  expect(screen.queryByText('Cart')).toBeNull()
})

it('a cart paid in NIM creates the sale once and claims the code by saleId', async () => {
  cleanup()
  localStorage.clear()
  const createSale = vi.fn(async (_body: { items: unknown[]; paymentMethod: string }) => nimSale('sale2'))
  const claim = vi.fn(async (_code: string, _opts?: Record<string, unknown>) => ({ sessionId: 's1' }))
  const api = fiatApi({ getProducts: vi.fn(async () => [coffee]), createSale, claim })
  render(<MemoryRouter><Charge api={api} /></MemoryRouter>)
  fireEvent.click(await screen.findByText('Coffee'))
  clickContinue()
  fillCode()
  clickRequestPayment()

  await waitFor(() => expect(claim).toHaveBeenCalledTimes(1))
  expect(createSale).toHaveBeenCalledTimes(1)
  expect(createSale.mock.calls[0][0].paymentMethod).toBe('nim')
  const [, opts] = claim.mock.calls[0]
  expect(opts).toEqual({ saleId: 'sale2' })
  expect(opts).not.toHaveProperty('fiatAmountMinor')
})

it('a failed claim on a cart sale is retried against the same sale, never a duplicate one', async () => {
  cleanup()
  localStorage.clear()
  const createSale = vi.fn(async (_body: { items: unknown[]; paymentMethod: string }) => nimSale('sale2'))
  const claim = vi.fn(async (_code: string, _opts?: Record<string, unknown>) => { throw new ApiError('NOT_FOUND', 'nope', 404) })
  const api = fiatApi({ getProducts: vi.fn(async () => [coffee]), createSale, claim })
  render(<MemoryRouter><Charge api={api} /></MemoryRouter>)
  fireEvent.click(await screen.findByText('Coffee'))
  clickContinue()
  fillCode()
  clickRequestPayment()
  await screen.findByText(/code unavailable/i)
  expect(createSale).toHaveBeenCalledTimes(1)

  clickRequestPayment()
  await waitFor(() => expect(claim).toHaveBeenCalledTimes(2))
  expect(createSale).toHaveBeenCalledTimes(1)
  expect(claim.mock.calls[1][1]).toEqual({ saleId: 'sale2' })
})

it('editing the cart after a failed claim mints a fresh sale on the next request', async () => {
  cleanup()
  localStorage.clear()
  let n = 0
  const createSale = vi.fn(async (_body: { items: unknown[]; paymentMethod: string }) => nimSale(`sale${++n}`))
  const claim = vi.fn(async (_code: string, _opts?: Record<string, unknown>) => { throw new ApiError('NOT_FOUND', 'nope', 404) })
  const api = fiatApi({ getProducts: vi.fn(async () => [coffee]), createSale, claim })
  render(<MemoryRouter><Charge api={api} /></MemoryRouter>)
  fireEvent.click(await screen.findByText('Coffee'))
  clickContinue()
  fillCode()
  clickRequestPayment()
  await screen.findByText(/code unavailable/i)

  fireEvent.click(screen.getByRole('button', { name: /back to amount/i }))
  fireEvent.click(screen.getByLabelText('+'))
  clickContinue()
  clickRequestPayment()

  await waitFor(() => expect(createSale).toHaveBeenCalledTimes(2))
  expect(createSale.mock.calls[1][0].items).toEqual([{ productId: 'p1', quantity: 2 }])
  await waitFor(() => expect(claim.mock.calls[1][1]).toEqual({ saleId: 'sale2' }))
})

it('"Back to amount" keeps the cart intact', async () => {
  cleanup()
  localStorage.clear()
  const api = fiatApi({ getProducts: vi.fn(async () => [coffee]), createSale: vi.fn(), claim: vi.fn() })
  render(<MemoryRouter><Charge api={api} /></MemoryRouter>)
  fireEvent.click(await screen.findByText('Coffee'))
  clickContinue()
  expect(screen.queryByText('Cart')).toBeNull() // step 2 shows a total, not the list
  fireEvent.click(screen.getByRole('button', { name: /back to amount/i }))

  expect(screen.getByText('Cart')).toBeTruthy()
  expect(screen.getAllByText(/2\.50/).length).toBeGreaterThan(0)
})

// --- P1: the NIM equivalent beside every fiat price ---------------------

it('a product chip and the cart carry the NIM equivalent of the fiat price', async () => {
  cleanup()
  localStorage.clear()
  const api = fiatApi({ getProducts: vi.fn(async () => [coffee]) })
  render(<MemoryRouter><Charge api={api} /></MemoryRouter>)
  // 2.50 USD at 0.005 USD/NIM = 500 NIM
  await waitFor(() => expect(screen.getAllByText('≈ 500.00 NIM').length).toBeGreaterThan(0))
  fireEvent.click(screen.getByRole('button', { name: /Coffee/ }))
  // chip, cart line and Total all carry it now
  await waitFor(() => expect(screen.getAllByText('≈ 500.00 NIM').length).toBe(3))
})

// --- P2: a non-empty cart owns the amount field -------------------------

it('with a cart there is no NIM unit button: the amount field is a cart line', async () => {
  cleanup()
  localStorage.clear()
  const api = fiatApi({ getProducts: vi.fn(async () => [coffee]) })
  render(<MemoryRouter><Charge api={api} /></MemoryRouter>)
  fireEvent.click(await screen.findByText('Coffee'))
  expect(screen.queryAllByRole('button', { name: /^NIM$/ })).toEqual([])
  expect(screen.getByLabelText(/add a custom amount \(USD\)/i)).toBeTruthy()
  expect(screen.getByRole('button', { name: /^Add to cart$/i })).toBeTruthy()
})

it('a typed amount beside a cart is ignored: Continue carries the cart total', async () => {
  cleanup()
  localStorage.clear()
  const api = fiatApi({ getProducts: vi.fn(async () => [coffee]), createSale: vi.fn(), claim: vi.fn() })
  render(<MemoryRouter><Charge api={api} /></MemoryRouter>)
  fireEvent.click(await screen.findByText('Coffee'))
  fillAmount('5000000')
  clickContinue()

  expect(screen.getByText('Step 2 of 2 · Payment')).toBeTruthy()
  expect(screen.getByText('2.50 USD')).toBeTruthy()
  expect(screen.queryByText(/5000000/)).toBeNull()
})

it('emptying the cart brings the USD/NIM segment back, with the remembered unit', async () => {
  cleanup()
  localStorage.clear()
  const api = fiatApi({ getProducts: vi.fn(async () => [coffee]), claim: vi.fn() })
  render(<MemoryRouter><Charge api={api} /></MemoryRouter>)
  fireEvent.click(await screen.findByText('Coffee'))
  expect(screen.queryAllByRole('button', { name: /^NIM$/ })).toEqual([])

  fireEvent.click(screen.getByLabelText('-'))
  expect(screen.queryByText('Cart')).toBeNull()
  expect(screen.getByRole('button', { name: /^NIM$/ })).toBeTruthy()
  expect(screen.getByRole('button', { name: /^USD$/ }).getAttribute('aria-pressed')).toBe('true')
})

it('Products: adding a product priced "2,50" sends priceMinor as an integer 250', async () => {
  cleanup()
  const createProduct = vi.fn(async (_body: { name: string; priceMinor: number; category?: string }) => ({ id: 'p1', name: 'Coffee', priceMinor: 250,
    category: null, pinned: false, active: true, sortOrder: 0 }))
  const api = { getProducts: vi.fn(async () => []), createProduct } as any
  render(<MemoryRouter><Products api={api} /></MemoryRouter>)
  fireEvent.change(await screen.findByLabelText(/^Name$/i), { target: { value: 'Coffee' } })
  fireEvent.change(screen.getByLabelText(/Price/i), { target: { value: '2,50' } })
  fireEvent.click(screen.getByText(/Add product/i))
  await waitFor(() => expect(createProduct).toHaveBeenCalledTimes(1))
  const [body] = createProduct.mock.calls[0]
  expect(body.priceMinor).toBe(250)
  expect(Number.isInteger(body.priceMinor)).toBe(true)
})

// RemoteCharge only shows its "in Nimiq Pay" preview once the host is
// detected — outside that, it renders Landing instead (tested separately
// below). These helpers flip that detection the same way test/network.test.ts
// does, so each test controls which branch it exercises.
function enterNimiqPay() {
  ;(window as never as { nimiqPay: object }).nimiqPay = {}
}
function leaveNimiqPay() {
  delete (window as never as { nimiqPay?: object }).nimiqPay
}

function renderRemoteCharge(api: unknown, opts?: { token?: string | null; login?: () => Promise<unknown> }) {
  return render(
    <MemoryRouter initialEntries={['/r/rc1']}>
      <Routes>
        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
        <Route path="/r/:id" element={<RemoteCharge api={api as any} token={opts?.token ?? 't1'} login={opts?.login} />} />
        <Route path="/session/:id" element={<p>session screen {/* eslint-disable-line */}</p>} />
      </Routes>
    </MemoryRouter>,
  )
}

it('RemoteCharge shows amount, description and receiver for an open bill', async () => {
  cleanup()
  enterNimiqPay()
  const api = {
    getChargeRequest: vi.fn(async () => ({
      amountLuna: '250000', fiatAmountMinor: 250, fiatCurrency: 'USD', reference: 'Soda',
      receiverDisplayName: 'Kiosk', receiverAddressTail: 'XY12',
      expiresAt: new Date(Date.now() + 3600_000).toISOString(), state: 'open',
    })),
  }
  renderRemoteCharge(api)

  await waitFor(() => expect(api.getChargeRequest).toHaveBeenCalledWith('rc1'))
  expect(await screen.findByText('Kiosk')).toBeTruthy()
  expect(screen.getByText('2.5 NIM')).toBeTruthy()
  expect(screen.getByText('Soda')).toBeTruthy()
  expect(screen.getByText(/XY12/)).toBeTruthy()
  leaveNimiqPay()
})

it('RemoteCharge distinguishes an expired bill from an already-paid one', async () => {
  cleanup()
  enterNimiqPay()
  const expiredApi = {
    getChargeRequest: vi.fn(async () => ({
      amountLuna: '250000', fiatAmountMinor: null, fiatCurrency: null, reference: null,
      receiverDisplayName: 'Kiosk', receiverAddressTail: 'XY12',
      expiresAt: new Date(Date.now() - 1000).toISOString(), state: 'expired',
    })),
  }
  renderRemoteCharge(expiredApi)
  await waitFor(() => expect(expiredApi.getChargeRequest).toHaveBeenCalledWith('rc1'))
  const expiredMsg = await screen.findByRole('alert')
  expect(expiredMsg.textContent).toMatch(/expired/i)

  cleanup()
  const paidApi = {
    getChargeRequest: vi.fn(async () => ({
      amountLuna: '250000', fiatAmountMinor: null, fiatCurrency: null, reference: null,
      receiverDisplayName: 'Kiosk', receiverAddressTail: 'XY12',
      expiresAt: new Date(Date.now() - 1000).toISOString(), state: 'paid',
    })),
  }
  renderRemoteCharge(paidApi)
  await waitFor(() => expect(paidApi.getChargeRequest).toHaveBeenCalledWith('rc1'))
  const paidMsg = await screen.findByRole('alert')
  expect(paidMsg.textContent).toMatch(/already been paid/i)
  expect(paidMsg.textContent).not.toEqual(expiredMsg.textContent)
  leaveNimiqPay()
})

it('RemoteCharge accepting an open bill calls accept and lands on /session/:id', async () => {
  cleanup()
  enterNimiqPay()
  const api = {
    getChargeRequest: vi.fn(async () => ({
      amountLuna: '250000', fiatAmountMinor: 250, fiatCurrency: 'USD', reference: 'Soda',
      receiverDisplayName: 'Kiosk', receiverAddressTail: 'XY12',
      expiresAt: new Date(Date.now() + 3600_000).toISOString(), state: 'open',
    })),
    acceptChargeRequest: vi.fn(async () => ({ sessionId: 's99', chargeId: 'c99' })),
  }
  renderRemoteCharge(api)

  await screen.findByText('Kiosk')
  fireEvent.click(screen.getByRole('button', { name: /accept/i }))

  await waitFor(() => expect(api.acceptChargeRequest).toHaveBeenCalledWith('rc1', expect.any(String)))
  expect(await screen.findByText(/session screen/i)).toBeTruthy()
  leaveNimiqPay()
})

it('RemoteCharge opened outside Nimiq Pay shows the landing page with a link to this bill', async () => {
  cleanup()
  leaveNimiqPay() // not in Nimiq Pay — the default in this test environment
  const api = { getChargeRequest: vi.fn(async () => ({
    amountLuna: '250000', fiatAmountMinor: null, fiatCurrency: null, reference: null,
    receiverDisplayName: 'Kiosk', receiverAddressTail: 'XY12',
    expiresAt: new Date(Date.now() + 3600_000).toISOString(), state: 'open',
  })) }
  renderRemoteCharge(api)

  // The bill is shown BEFORE the button, on purpose: opening this link in a
  // browser means a landing page, then a button, then the wallet's own
  // "unknown link" warning — three steps during which the person would
  // otherwise have no idea what they are being asked to approve. The preview
  // endpoint is public exactly so this is possible.
  await waitFor(() => expect(api.getChargeRequest).toHaveBeenCalledWith('rc1'))
  expect(await screen.findByText('2.5 NIM')).toBeTruthy()
  expect(screen.getByText('Kiosk')).toBeTruthy()

  // An App Link on nimpay.app, not the nimiqpay:// scheme: a custom scheme is
  // not shareable — messengers do not linkify it and a browser address bar
  // searches for it. This is the format the Nimiq team pointed at.
  const link = await screen.findByRole('link', { name: /pay in nimiq pay/i })
  const href = link.getAttribute('href') ?? ''
  expect(href).toMatch(/^https:\/\/nimpay\.app\/miniapps\/open\//)
  expect(href).not.toContain('nimiqpay://')
  expect(href).toContain('/r/rc1')
})

// --- Task 2: cashier lock — Settings screen -----------------------------

function meWith(overrides: { cashierLocked?: boolean; cashierPinSet?: boolean } = {}) {
  return { walletAddress: 'NQ1', displayName: null,
    cashierLocked: overrides.cashierLocked ?? false, cashierPinSet: overrides.cashierPinSet ?? false,
    businessName: null, businessAddress: null, taxId: null }
}

it('Settings states plainly that the PIN does not protect the wallet\'s funds', async () => {
  const api = { getMe: vi.fn(async () => meWith()) }
  render(<MemoryRouter><Settings api={api as never} /></MemoryRouter>)
  await waitFor(() => expect(api.getMe).toHaveBeenCalled())
  expect(screen.getAllByText(/does not protect your NIM/i).length).toBeGreaterThan(0)
})

it('a correct PIN removes the cashier lock', async () => {
  const disableCashierLock = vi.fn(async (pin: string) => { expect(pin).toBe('1234'); return { ok: true as const } })
  const api = { getMe: vi.fn(async () => meWith({ cashierLocked: true, cashierPinSet: true })), disableCashierLock }
  render(<MemoryRouter><Settings api={api as never} /></MemoryRouter>)
  await screen.findByRole('button', { name: /unlock the till/i })

  fireEvent.change(screen.getByLabelText(/PIN to unlock/i), { target: { value: '1234' } })
  fireEvent.click(screen.getByRole('button', { name: /unlock the till/i }))

  await waitFor(() => expect(disableCashierLock).toHaveBeenCalledWith('1234'))
  // The lock badge now lives in AppShell's header (covered by nav.test); here we
  // assert the screen's own behaviour: the unlock control is gone once unlocked.
  await waitFor(() => expect(screen.queryByRole('button', { name: /unlock the till/i })).toBeNull())
})

it('shows distinct messages for a wrong PIN and a rate-limited unlock attempt', async () => {
  const wrongPinApi = {
    getMe: vi.fn(async () => meWith({ cashierLocked: true, cashierPinSet: true })),
    disableCashierLock: vi.fn(async () => { throw new ApiError('AUTH_FAILED', 'incorrect PIN', 401) }),
  }
  render(<MemoryRouter><Settings api={wrongPinApi as never} /></MemoryRouter>)
  await screen.findByRole('button', { name: /unlock the till/i })
  fireEvent.change(screen.getByLabelText(/PIN to unlock/i), { target: { value: '0000' } })
  fireEvent.click(screen.getByRole('button', { name: /unlock the till/i }))
  const wrongMsg = await screen.findByText(/incorrect pin/i)

  cleanup()

  const rateLimitedApi = {
    getMe: vi.fn(async () => meWith({ cashierLocked: true, cashierPinSet: true })),
    disableCashierLock: vi.fn(async () => { throw new ApiError('RATE_LIMITED', 'too many attempts', 429) }),
  }
  render(<MemoryRouter><Settings api={rateLimitedApi as never} /></MemoryRouter>)
  await screen.findByRole('button', { name: /unlock the till/i })
  fireEvent.change(screen.getByLabelText(/PIN to unlock/i), { target: { value: '1234' } })
  fireEvent.click(screen.getByRole('button', { name: /unlock the till/i }))
  const rateLimitedMsg = await screen.findByText(/wait a moment/i)

  expect(wrongMsg.textContent).not.toBe(rateLimitedMsg.textContent)
})

// --- Task 6: API keys panel — Settings screen ---------------------------

it('creating an API key shows it once for copying, and it is gone from the list on reload', async () => {
  const created = { id: 'k1', label: 'POS terminal', key: 'nmbl_secret123', createdAt: '2026-09-10T00:00:00.000Z' }
  const getApiKeys = vi.fn(async () => [{ id: 'k1', label: 'POS terminal', createdAt: created.createdAt, revokedAt: null }])
  const createApiKey = vi.fn(async () => created)
  const api = { getMe: vi.fn(async () => meWith()), getApiKeys, createApiKey }
  render(<MemoryRouter><Settings api={api as never} /></MemoryRouter>)
  await waitFor(() => expect(getApiKeys).toHaveBeenCalledTimes(1))

  fireEvent.change(screen.getByLabelText(/label/i), { target: { value: 'POS terminal' } })
  fireEvent.click(screen.getByRole('button', { name: /^create$/i }))

  await waitFor(() => expect(createApiKey).toHaveBeenCalledWith('POS terminal'))
  await waitFor(() => expect(screen.getByDisplayValue('nmbl_secret123')).toBeTruthy())
  expect(screen.getByText(/only.*once|shown only once/i)).toBeTruthy()

  // The list itself, once reloaded, never carries the plaintext key.
  await waitFor(() => expect(getApiKeys).toHaveBeenCalledTimes(2))
  expect(screen.queryAllByDisplayValue('nmbl_secret123').length).toBe(1)
})

it('revoking a key calls DELETE only after a second confirming tap', async () => {
  cleanup()
  const getApiKeys = vi.fn(async () => [{ id: 'k1', label: 'Old key', createdAt: '2026-09-01T00:00:00.000Z', revokedAt: null }])
  const revokeApiKey = vi.fn(async () => {})
  const api = { getMe: vi.fn(async () => meWith()), getApiKeys, revokeApiKey }
  render(<MemoryRouter><Settings api={api as never} /></MemoryRouter>)
  await screen.findByText('Old key')

  const revokeBtn = screen.getByRole('button', { name: /revoke/i })
  fireEvent.click(revokeBtn)
  expect(revokeApiKey).not.toHaveBeenCalled()

  const confirmBtn = await screen.findByRole('button', { name: /sure|confirm/i })
  fireEvent.click(confirmBtn)
  await waitFor(() => expect(revokeApiKey).toHaveBeenCalledWith('k1'))
})

it('shows a cashier-lock message when the API keys list comes back 423', async () => {
  cleanup()
  const getApiKeys = vi.fn(async () => { throw new ApiError('CASHIER_LOCKED', 'locked', 423) })
  const api = { getMe: vi.fn(async () => meWith()), getApiKeys }
  render(<MemoryRouter><Settings api={api as never} /></MemoryRouter>)
  await waitFor(() => expect(getApiKeys).toHaveBeenCalled())
  await screen.findByText(/cashier lock is active/i)
})

// --- Task C: point-of-sale profile (BR-P15) ------------------------------

it('Settings saves business name, address and Tax ID together with the display name', async () => {
  cleanup()
  const updateMe = vi.fn(async () => ({ ok: true as const }))
  const api = { getMe: vi.fn(async () => meWith()), updateMe }
  render(<MemoryRouter><Settings api={api as never} /></MemoryRouter>)
  await waitFor(() => expect(api.getMe).toHaveBeenCalled())

  fireEvent.change(screen.getByLabelText(/display name/i), { target: { value: 'Gall' } })
  fireEvent.change(screen.getByLabelText(/business name/i), { target: { value: 'Corner Kiosk' } })
  fireEvent.change(screen.getByLabelText(/business address/i), { target: { value: '1 Market St' } })
  fireEvent.change(screen.getByLabelText(/tax id/i), { target: { value: 'PL1234567890' } })
  fireEvent.click(screen.getByRole('button', { name: /^save$/i }))

  await waitFor(() => expect(updateMe).toHaveBeenCalledWith({
    displayName: 'Gall', businessName: 'Corner Kiosk', businessAddress: '1 Market St', taxId: 'PL1234567890',
  }))
  // The disclaimer that matters most on this screen: no claim of verification.
  expect(screen.getByText(/not verified/i)).toBeTruthy()
})

it('the cashier lock hides the point-of-sale profile fields, same as display name', async () => {
  cleanup()
  const api = { getMe: vi.fn(async () => meWith({ cashierLocked: true, cashierPinSet: true })) }
  render(<MemoryRouter><Settings api={api as never} /></MemoryRouter>)
  await waitFor(() => expect(api.getMe).toHaveBeenCalled())
  expect(screen.queryByLabelText(/business name/i)).toBeNull()
  expect(screen.queryByLabelText(/business address/i)).toBeNull()
  expect(screen.queryByLabelText(/tax id/i)).toBeNull()
})

it('Approval shows the point-of-sale business name above the display name, but never a claim of verification', async () => {
  cleanup()
  const api = {
    getSession: vi.fn(async () => ({ sessionId: 's1', status: 'AWAITING_PAYER_APPROVAL', role: 'payer',
      expiresAt: new Date().toISOString(),
      counterpart: { displayName: 'Kiosk', verificationStatus: 'unverified', addressTail: 'XY12',
        businessName: 'Corner Kiosk' },
      charge: { chargeId: 'c1', version: 1, amountLuna: '250000', asset: 'NIM', network: 'nimiq',
        reference: 'Soda', recipientAddress: 'NQ99 RECV' } })),
    openEvents: vi.fn(async () => () => {}),
    getAffordability: vi.fn(async () => ({ sufficient: null, shortfallLuna: null })),
  }
  const wallet = { sendTransaction: vi.fn(async () => ({ hash: 'deadbeef' })) }
  render(
    <MemoryRouter initialEntries={['/session/s1']}>
      <Routes>
        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
        <Route path="/session/:id" element={<Approval api={api as any} wallet={wallet as any} />} />
      </Routes>
    </MemoryRouter>,
  )
  await screen.findByText('Corner Kiosk')
  expect(screen.getByText(/unverified profile/i)).toBeTruthy()
  // The badge stays as-is; the business name never carries a "verified" claim itself.
  expect(screen.queryByText(/corner kiosk.*verified/i)).toBeNull()
})

it('Receipt shows the receiving point-of-sale name and Tax ID frozen on the charge snapshot', async () => {
  cleanup()
  const history = vi.fn(async () => ({
    items: [{ receiptId: 'r1', role: 'payer', snapshot: {
      amountNim: '2.5', amountLuna: '250000', asset: 'NIM', network: 'nimiq',
      sender: 'NQ00 SENDER', recipient: 'NQ99 RECV', hash: 'deadbeef'.repeat(4),
      confirmedAt: new Date().toISOString(),
      receiverBusinessName: 'Corner Kiosk', receiverTaxId: 'PL1234567890',
    } }],
  }))
  const api = { history }
  render(
    <MemoryRouter initialEntries={['/receipt/r1']}>
      <Routes>
        <Route path="/receipt/:id" element={<Receipt api={api as never} />} />
      </Routes>
    </MemoryRouter>,
  )
  await screen.findByText('Corner Kiosk')
  expect(screen.getByText('PL1234567890')).toBeTruthy()
  expect(screen.getByText('Tax ID')).toBeTruthy()
  // R20: a receipt ends with somewhere to go — the primary is the action
  // this person would take again (they paid, so "New payment"), and "Done"
  // goes home. The luna figure is demoted to its own faint class.
  expect(screen.getByRole('button', { name: 'New payment' })).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'New charge' })).toBeNull()
  expect(screen.getByRole('button', { name: 'Done' })).toBeTruthy()
  expect(screen.getByText(/250000 luna/).className).toBe('luna')
})

it('Receipt offers "New charge" to the side that took the money', async () => {
  cleanup()
  const history = vi.fn(async () => ({
    items: [{ receiptId: 'r2', role: 'receiver', snapshot: {
      amountNim: '2.5', amountLuna: '250000', asset: 'NIM', network: 'nimiq',
      sender: 'NQ00 SENDER', recipient: 'NQ99 RECV', hash: 'deadbeef'.repeat(4),
      confirmedAt: new Date().toISOString(),
    } }],
  }))
  const api = { history }
  render(
    <MemoryRouter initialEntries={['/receipt/r2']}>
      <Routes>
        <Route path="/receipt/:id" element={<Receipt api={api as never} />} />
      </Routes>
    </MemoryRouter>,
  )
  expect(await screen.findByRole('button', { name: 'New charge' })).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Done' })).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'New payment' })).toBeNull()
})

// --- Task 5: Settings reorganisation (R4, R5, R11, R17) ------------------

it('form buttons that save something are .primary, and go disabled empty-handed', async () => {
  cleanup()
  const api = { getMe: vi.fn(async () => meWith()), getApiKeys: vi.fn(async () => []) }
  render(<MemoryRouter><Settings api={api as never} /></MemoryRouter>)
  await waitFor(() => expect(api.getMe).toHaveBeenCalled())

  // R11: a disabled save button must still look like the primary action —
  // the grey comes from :disabled, not from dropping the class.
  const create = screen.getByRole('button', { name: 'Create' })
  expect(create.className).toContain('primary')
  expect(create.hasAttribute('disabled')).toBe(true)
  fireEvent.change(screen.getByLabelText('Label'), { target: { value: 'POS' } })
  expect(screen.getByRole('button', { name: 'Create' }).hasAttribute('disabled')).toBe(false)

  const savePin = screen.getByRole('button', { name: 'Save PIN' })
  expect(savePin.className).toContain('primary')
  expect(savePin.hasAttribute('disabled')).toBe(true)
  fireEvent.change(screen.getByLabelText(/Set a cashier PIN/i), { target: { value: '1234' } })
  expect(screen.getByRole('button', { name: 'Save PIN' }).hasAttribute('disabled')).toBe(false)

  const save = screen.getByRole('button', { name: 'Save' })
  expect(save.className).toContain('primary')
  expect(save.hasAttribute('disabled')).toBe(true)

  // "Lock the till" is the secondary of the pair and stays plain.
  expect(screen.queryByRole('button', { name: 'Lock the till' })).toBeNull()
})

it('Settings files Products under Point of sale and the guide under Help', async () => {
  cleanup()
  const api = { getMe: vi.fn(async () => meWith()), getApiKeys: vi.fn(async () => []) }
  render(<MemoryRouter><Settings api={api as never} /></MemoryRouter>)
  await waitFor(() => expect(api.getMe).toHaveBeenCalled())

  expect(screen.getByRole('heading', { name: 'Point of sale' })).toBeTruthy()
  expect(screen.getByRole('link', { name: 'Products' }).getAttribute('href')).toBe('/products')
  expect(screen.getByRole('heading', { name: 'Help' })).toBeTruthy()
  expect(screen.getByRole('link', { name: 'How it works' }).getAttribute('href')).toBe('/guide')
  expect(screen.getByRole('button', { name: 'Recommend NIMble' })).toBeTruthy()

  // The guide is a screen now, not a localStorage flag to un-set (R4).
  expect(screen.queryByText(/Show the guide again/i)).toBeNull()
  expect(screen.queryByRole('link', { name: 'Manage products' })).toBeNull()
})

// --- Audit round 2 (Q5–Q11): one switch, honest hints, ordered CTAs ------

it('UnitSwitch names its two sides and marks the active one with aria-pressed', () => {
  cleanup()
  const onChange = vi.fn()
  render(<UnitSwitch unit="NIM" onChange={onChange} />)
  const usd = screen.getByRole('button', { name: /^USD$/ })
  const nim = screen.getByRole('button', { name: /^NIM$/ })
  expect(usd.getAttribute('aria-pressed')).toBe('false')
  expect(nim.getAttribute('aria-pressed')).toBe('true')
  fireEvent.click(usd)
  expect(onChange).toHaveBeenCalledWith('USD')
})

it('Charge and Remote bill wear the same unit switch (Q5)', async () => {
  cleanup()
  localStorage.clear()
  render(<MemoryRouter><Charge api={fiatApi({ claim: vi.fn() })} /></MemoryRouter>)
  const inCharge = screen.getByRole('button', { name: /^USD$/ }).parentElement!
  expect(inCharge.className).toBe('seg')
  cleanup()

  const remoteApi = fiatApi({ createChargeRequest: vi.fn(), getOutstandingBills: vi.fn(async () => ({ bills: [] })) })
  render(<MemoryRouter><NewRemoteCharge api={remoteApi} /></MemoryRouter>)
  const inRemote = screen.getByRole('button', { name: /^USD$/ }).parentElement!
  expect(inRemote.className).toBe('seg')
  expect(inRemote.getAttribute('role')).toBe('group')
})

it('the hint under a disabled Continue says what is missing, and goes once it is not (Q6)', async () => {
  cleanup()
  localStorage.clear()
  const api = fiatApi({ getProducts: vi.fn(async () => [coffee]), claim: vi.fn() })
  render(<MemoryRouter><Charge api={api} /></MemoryRouter>)
  await screen.findByText('Coffee')
  expect(screen.getByRole('button', { name: 'Continue' }).hasAttribute('disabled')).toBe(true)
  expect(screen.getByText('Add a product or enter an amount to continue')).toBeTruthy()

  fireEvent.click(screen.getByText('Coffee'))
  expect(screen.getByRole('button', { name: 'Continue' }).hasAttribute('disabled')).toBe(false)
  expect(screen.queryByText('Add a product or enter an amount to continue')).toBeNull()
})

it('Remote bill hints under its disabled Create bill (Q6)', async () => {
  cleanup()
  localStorage.clear()
  const api = fiatApi({ createChargeRequest: vi.fn(), getOutstandingBills: vi.fn(async () => ({ bills: [] })) })
  render(<MemoryRouter><NewRemoteCharge api={api} /></MemoryRouter>)
  expect(screen.getByText('Enter an amount to create the bill')).toBeTruthy()
  fireEvent.change(screen.getByLabelText(/Amount \(USD\)/i), { target: { value: '5.00' } })
  expect(screen.queryByText('Enter an amount to create the bill')).toBeNull()
})

it('"Bill someone who isn\'t here" sits after the CTA bar, not across the path (Q7)', async () => {
  cleanup()
  localStorage.clear()
  const api = fiatApi({ getProducts: vi.fn(async () => [coffee]), claim: vi.fn() })
  const { container } = render(<MemoryRouter><Charge api={api} /></MemoryRouter>)
  await screen.findByText('Coffee')
  const bar = container.querySelector('.cta-bar')!
  const side = screen.getByText(/Bill someone who isn't here/)
  // DOCUMENT_POSITION_FOLLOWING === 4: the side door comes after the bar.
  expect(bar.compareDocumentPosition(side) & 4).toBe(4)
})

it('Products: a row carries name, category and price, and Retire is dressed as destructive (Q11)', async () => {
  cleanup()
  const p = { id: 'p1', name: 'Soda', priceMinor: 500, category: 'Drinks', pinned: false, active: true, sortOrder: 0 }
  const api = { getProducts: vi.fn(async () => [p]), updateProduct: vi.fn() } as never
  const { container } = render(<MemoryRouter><Products api={api} /></MemoryRouter>)
  await screen.findByText('Soda')
  const row = container.querySelector('.row')!
  expect(row.querySelector('.row__sub')!.textContent).toBe('Drinks')
  expect(row.querySelector('.row__amt')!.textContent).toContain('5.00 USD')
  expect(screen.getByRole('button', { name: 'Retire' }).className).toContain('danger')
  expect(screen.getByRole('button', { name: 'Edit' }).className).toContain('btn-sm')
})

it('Settings leads with the one-line warning and folds the detail into Learn more (Q8)', async () => {
  cleanup()
  const api = { getMe: vi.fn(async () => meWith()) }
  const { container } = render(<MemoryRouter><Settings api={api as never} /></MemoryRouter>)
  await waitFor(() => expect(api.getMe).toHaveBeenCalled())

  const lead = container.querySelector('.notice--warn')!
  expect(lead.textContent).toBe('This PIN locks this app. It does not protect your NIM in Nimiq Pay.')
  const details = container.querySelector('details.learn-more')!
  expect(details.querySelector('summary')!.textContent).toBe('Learn more')
  expect(details.textContent).toContain('nothing in this app can stop that')
})
