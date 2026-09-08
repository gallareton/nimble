import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { expect, it, vi } from 'vitest'
import { CodeDisplay } from '../src/components/CodeDisplay'
import { StatusBadge } from '../src/components/StatusBadge'
import { Approval } from '../src/screens/Approval'
import { Charge, toMinorUnits } from '../src/screens/Charge'
import { RemoteCharge } from '../src/screens/RemoteCharge'
import { ApiError } from '../src/api/client'
import { Settings } from '../src/screens/Settings'

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

it('Charge defaults to USD and sends fiat minor units, never amountLuna', async () => {
  cleanup() // this suite doesn't auto-cleanup between tests (no vitest globals)
  localStorage.clear()
  const claim = vi.fn(async (_code: string, _opts?: Record<string, unknown>) => ({ sessionId: 's1' }))
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const api = { claim, getRate: vi.fn(async () => ({ usdPerNim: 0.005 })),
    getNetwork: vi.fn(async () => ({ network: 'test', height: 1 })) } as any
  render(<MemoryRouter><Charge api={api} /></MemoryRouter>)

  fireEvent.change(screen.getByLabelText(/amount/i), { target: { value: '12.34' } })
  fireEvent.change(screen.getByLabelText(/code/i), { target: { value: '123456' } })
  fireEvent.click(screen.getByText(/request payment/i))

  await waitFor(() => expect(claim).toHaveBeenCalled())
  expect(claim.mock.calls[0][1]).toMatchObject({ fiatAmountMinor: 1234, fiatCurrency: 'USD' })
  expect(claim.mock.calls[0][1]).not.toHaveProperty('amountLuna')
})

it('Charge in NIM mode sends amountLuna, never fiatAmountMinor', async () => {
  cleanup()
  localStorage.clear()
  const claim = vi.fn(async (_code: string, _opts?: Record<string, unknown>) => ({ sessionId: 's1' }))
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const api = { claim, getRate: vi.fn(async () => ({ usdPerNim: 0.005 })),
    getNetwork: vi.fn(async () => ({ network: 'test', height: 1 })) } as any
  render(<MemoryRouter><Charge api={api} /></MemoryRouter>)

  fireEvent.click(screen.getByRole('button', { name: /^NIM$/i }))
  fireEvent.change(screen.getByLabelText(/amount/i), { target: { value: '2.5' } })
  fireEvent.change(screen.getByLabelText(/code/i), { target: { value: '123456' } })
  fireEvent.click(screen.getByText(/request payment/i))

  await waitFor(() => expect(claim).toHaveBeenCalled())
  expect(claim.mock.calls[0][1]).toMatchObject({ amountLuna: '250000' })
  expect(claim.mock.calls[0][1]).not.toHaveProperty('fiatAmountMinor')
  expect(claim.mock.calls[0][1]).not.toHaveProperty('fiatCurrency')
})

it('Charge remembers the last chosen unit across mounts via localStorage', async () => {
  cleanup()
  localStorage.clear()
  const claim = vi.fn(async () => ({ sessionId: 's1' }))
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const api = { claim, getRate: vi.fn(async () => ({ usdPerNim: 0.005 })),
    getNetwork: vi.fn(async () => ({ network: 'test', height: 1 })) } as any
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const api = { claim, getRate: vi.fn(async () => ({ usdPerNim: 0.005 })),
    getNetwork: vi.fn(async () => ({ network: 'test', height: 1 })) } as any
  render(<MemoryRouter><Charge api={api} /></MemoryRouter>)

  fireEvent.change(screen.getByLabelText(/amount/i), { target: { value: '12.345' } })
  fireEvent.change(screen.getByLabelText(/code/i), { target: { value: '123456' } })
  fireEvent.click(screen.getByText(/request payment/i))

  await screen.findByText(/valid amount/i)
  expect(screen.queryByText(/valid nim amount/i)).toBeNull()
  expect(claim).not.toHaveBeenCalled()
})

it('Charge in NIM mode: an invalid amount shows the NIM message and never calls claim', async () => {
  cleanup()
  localStorage.clear()
  const claim = vi.fn(async () => ({ sessionId: 's1' }))
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const api = { claim, getRate: vi.fn(async () => ({ usdPerNim: 0.005 })),
    getNetwork: vi.fn(async () => ({ network: 'test', height: 1 })) } as any
  render(<MemoryRouter><Charge api={api} /></MemoryRouter>)

  fireEvent.click(screen.getByRole('button', { name: /^NIM$/i }))
  fireEvent.change(screen.getByLabelText(/amount/i), { target: { value: '2.123456' } })
  fireEvent.change(screen.getByLabelText(/code/i), { target: { value: '123456' } })
  fireEvent.click(screen.getByText(/request payment/i))

  await screen.findByText(/valid nim amount/i)
  expect(claim).not.toHaveBeenCalled()
})

it('Charge in NIM mode: a comma decimal ("1,50") sends the same amountLuna as a dot decimal ("1.50")', async () => {
  cleanup()
  localStorage.clear()
  const claim = vi.fn(async (_code: string, _opts?: Record<string, unknown>) => ({ sessionId: 's1' }))
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const api = { claim, getRate: vi.fn(async () => ({ usdPerNim: 0.005 })),
    getNetwork: vi.fn(async () => ({ network: 'test', height: 1 })) } as any
  render(<MemoryRouter><Charge api={api} /></MemoryRouter>)

  fireEvent.click(screen.getByRole('button', { name: /^NIM$/i }))
  fireEvent.change(screen.getByLabelText(/amount/i), { target: { value: '1,50' } })
  fireEvent.change(screen.getByLabelText(/code/i), { target: { value: '123456' } })
  fireEvent.click(screen.getByText(/request payment/i))

  await waitFor(() => expect(claim).toHaveBeenCalled())
  expect(claim.mock.calls[0][1]).toMatchObject({ amountLuna: '150000' })
})

it('Charge in NIM mode: "0" shows the NIM validation message and never calls claim', async () => {
  cleanup()
  localStorage.clear()
  const claim = vi.fn(async () => ({ sessionId: 's1' }))
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const api = { claim, getRate: vi.fn(async () => ({ usdPerNim: 0.005 })),
    getNetwork: vi.fn(async () => ({ network: 'test', height: 1 })) } as any
  render(<MemoryRouter><Charge api={api} /></MemoryRouter>)

  fireEvent.click(screen.getByRole('button', { name: /^NIM$/i }))
  fireEvent.change(screen.getByLabelText(/amount/i), { target: { value: '0' } })
  fireEvent.change(screen.getByLabelText(/code/i), { target: { value: '123456' } })
  fireEvent.click(screen.getByText(/request payment/i))

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
    cashierLocked: overrides.cashierLocked ?? false, cashierPinSet: overrides.cashierPinSet ?? false }
}

it('Settings states plainly that the PIN does not protect the wallet\'s funds', async () => {
  const api = { getMe: vi.fn(async () => meWith()) }
  render(<MemoryRouter><Settings api={api as never} /></MemoryRouter>)
  await waitFor(() => expect(api.getMe).toHaveBeenCalled())
  expect(screen.getByText(/does not protect your NIM/i)).toBeTruthy()
})

it('a correct PIN removes the cashier lock', async () => {
  const disableCashierLock = vi.fn(async (pin: string) => { expect(pin).toBe('1234'); return { ok: true as const } })
  const api = { getMe: vi.fn(async () => meWith({ cashierLocked: true, cashierPinSet: true })), disableCashierLock }
  render(<MemoryRouter><Settings api={api as never} /></MemoryRouter>)
  await waitFor(() => expect(screen.getByText(/isn't broken/i)).toBeTruthy())

  fireEvent.change(screen.getByLabelText(/PIN to unlock/i), { target: { value: '1234' } })
  fireEvent.click(screen.getByRole('button', { name: /unlock the till/i }))

  await waitFor(() => expect(disableCashierLock).toHaveBeenCalledWith('1234'))
  await waitFor(() => expect(screen.queryByText(/isn't broken/i)).toBeNull())
})

it('shows distinct messages for a wrong PIN and a rate-limited unlock attempt', async () => {
  const wrongPinApi = {
    getMe: vi.fn(async () => meWith({ cashierLocked: true, cashierPinSet: true })),
    disableCashierLock: vi.fn(async () => { throw new ApiError('AUTH_FAILED', 'incorrect PIN', 401) }),
  }
  render(<MemoryRouter><Settings api={wrongPinApi as never} /></MemoryRouter>)
  await waitFor(() => expect(screen.getByText(/isn't broken/i)).toBeTruthy())
  fireEvent.change(screen.getByLabelText(/PIN to unlock/i), { target: { value: '0000' } })
  fireEvent.click(screen.getByRole('button', { name: /unlock the till/i }))
  const wrongMsg = await screen.findByText(/incorrect pin/i)

  cleanup()

  const rateLimitedApi = {
    getMe: vi.fn(async () => meWith({ cashierLocked: true, cashierPinSet: true })),
    disableCashierLock: vi.fn(async () => { throw new ApiError('RATE_LIMITED', 'too many attempts', 429) }),
  }
  render(<MemoryRouter><Settings api={rateLimitedApi as never} /></MemoryRouter>)
  await waitFor(() => expect(screen.getByText(/isn't broken/i)).toBeTruthy())
  fireEvent.change(screen.getByLabelText(/PIN to unlock/i), { target: { value: '1234' } })
  fireEvent.click(screen.getByRole('button', { name: /unlock the till/i }))
  const rateLimitedMsg = await screen.findByText(/wait a moment/i)

  expect(wrongMsg.textContent).not.toBe(rateLimitedMsg.textContent)
})
