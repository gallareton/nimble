import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { expect, it, vi } from 'vitest'
import { CodeDisplay } from '../src/components/CodeDisplay'
import { StatusBadge } from '../src/components/StatusBadge'
import { Approval } from '../src/screens/Approval'
import { Charge, toMinorUnits } from '../src/screens/Charge'

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

it('Charge defaults to USD and sends fiat minor units, never amountLuna', async () => {
  cleanup() // this suite doesn't auto-cleanup between tests (no vitest globals)
  localStorage.clear()
  const claim = vi.fn(async (_code: string, _opts?: Record<string, unknown>) => ({ sessionId: 's1' }))
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const api = { claim, getRate: vi.fn(async () => ({ usdPerNim: 0.005 })) } as any
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
  const api = { claim, getRate: vi.fn(async () => ({ usdPerNim: 0.005 })) } as any
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
  const api = { claim, getRate: vi.fn(async () => ({ usdPerNim: 0.005 })) } as any
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
  const api = { claim, getRate: vi.fn(async () => ({ usdPerNim: 0.005 })) } as any
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
  const api = { claim, getRate: vi.fn(async () => ({ usdPerNim: 0.005 })) } as any
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
  const api = { claim, getRate: vi.fn(async () => ({ usdPerNim: 0.005 })) } as any
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
  const api = { claim, getRate: vi.fn(async () => ({ usdPerNim: 0.005 })) } as any
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
