import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, expect, it, vi } from 'vitest'
import { Approval } from '../src/screens/Approval'

afterEach(() => cleanup())

function baseView(overrides: Record<string, unknown>) {
  return {
    sessionId: 's1',
    status: 'CONFIRMING',
    role: 'receiver',
    expiresAt: new Date().toISOString(),
    charge: { chargeId: 'c1', version: 1, amountLuna: '250000', asset: 'NIM', network: 'nimiq',
      reference: 'Soda', recipientAddress: 'NQ99 RECV' },
    ...overrides,
  }
}

function renderApproval(view: Record<string, unknown>) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const api: any = {
    getSession: vi.fn(async () => view),
    openEvents: vi.fn(async () => () => {}),
  }
  const wallet = { sendTransaction: vi.fn() }
  return render(
    <MemoryRouter initialEntries={['/session/s1']}>
      <Routes>
        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
        <Route path="/session/:id" element={<Approval api={api} wallet={wallet as any} />} />
      </Routes>
    </MemoryRouter>,
  )
}

it('receiver at CONFIRMING sees the release panel with the amount and the release instruction', async () => {
  renderApproval(baseView({ status: 'CONFIRMING', role: 'receiver' }))
  const panel = await screen.findByLabelText(/release/i)
  expect(panel).toBeTruthy()
  expect(screen.getAllByText('2.5 NIM').length).toBeGreaterThan(0)
  expect(screen.getByText(/customer.*phone/i)).toBeTruthy()
})

it('payer at CONFIRMING never sees the release panel', async () => {
  renderApproval(baseView({ status: 'CONFIRMING', role: 'payer' }))
  await screen.findByText(/payment/i) // heading renders
  expect(screen.queryByLabelText(/release/i)).toBeNull()
})

it('distinguishes included-but-not-final from finalised (BR-P04)', async () => {
  const { unmount } = renderApproval(baseView({ status: 'CONFIRMING', role: 'receiver' }))
  await screen.findByLabelText(/release/i)
  expect(screen.getByText(/not.*final|final.*not/i)).toBeTruthy()
  unmount()
  cleanup()

  renderApproval(baseView({ status: 'CONFIRMED', role: 'receiver' }))
  await screen.findByLabelText(/release/i)
  expect(screen.getByText(/finali[sz]ed/i)).toBeTruthy()
})

it('renders without throwing when AudioContext and navigator.vibrate are both undefined', async () => {
  const audioCtx = (window as unknown as { AudioContext?: unknown }).AudioContext
  const vibrate = navigator.vibrate
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  delete (window as any).AudioContext
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  delete (navigator as any).vibrate

  expect(() => renderApproval(baseView({ status: 'CONFIRMING', role: 'receiver' }))).not.toThrow()
  await screen.findByLabelText(/release/i)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (audioCtx) (window as any).AudioContext = audioCtx
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (vibrate) (navigator as any).vibrate = vibrate
})

it('dismissing the panel returns to the normal status view', async () => {
  renderApproval(baseView({ status: 'CONFIRMING', role: 'receiver' }))
  await screen.findByLabelText(/release/i)
  fireEvent.click(screen.getByRole('button', { name: /dismiss/i }))
  expect(screen.queryByLabelText(/release/i)).toBeNull()
  expect(screen.getByText(/charge status/i)).toBeTruthy()
})
