import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { Charge } from '../src/screens/Charge'
import { Shift } from '../src/screens/Shift'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function fillChargeForm() {
  fireEvent.change(screen.getByPlaceholderText('2.50'), { target: { value: '2.50' } })
  fireEvent.change(screen.getByPlaceholderText('123 456'), { target: { value: '123456' } })
}

it('disables submit and explains why when navigator.onLine is false', async () => {
  vi.stubGlobal('navigator', { ...navigator, onLine: false })
  const api = { getNetwork: vi.fn(async () => ({ network: 'test', height: 1 })), claim: vi.fn() }
  render(<MemoryRouter><Charge api={api as never} /></MemoryRouter>)
  fillChargeForm()
  await waitFor(() => expect(screen.getByText(/offline/i)).toBeTruthy())
  expect((screen.getByText('Request payment') as HTMLButtonElement).disabled).toBe(true)
  expect(api.claim).not.toHaveBeenCalled()
})

it('behaves as today when online and the liveness probe succeeds', async () => {
  vi.stubGlobal('navigator', { ...navigator, onLine: true })
  const api = {
    getNetwork: vi.fn(async () => ({ network: 'test', height: 1 })),
    claim: vi.fn(async () => ({ sessionId: 's1' })),
  }
  render(<MemoryRouter><Charge api={api as never} /></MemoryRouter>)
  fillChargeForm()
  await waitFor(() => expect((screen.getByText('Request payment') as HTMLButtonElement).disabled).toBe(false))
  expect(screen.queryByText(/offline/i)).toBeNull()
  fireEvent.click(screen.getByText('Request payment'))
  await waitFor(() => expect(api.claim).toHaveBeenCalledTimes(1))
})

it('re-enables the form when connectivity returns, without a remount', async () => {
  const nav = { ...navigator, onLine: false }
  vi.stubGlobal('navigator', nav)
  const api = { getNetwork: vi.fn(async () => ({ network: 'test', height: 1 })), claim: vi.fn() }
  render(<MemoryRouter><Charge api={api as never} /></MemoryRouter>)
  fillChargeForm()
  await waitFor(() => expect((screen.getByText('Request payment') as HTMLButtonElement).disabled).toBe(true))

  nav.onLine = true
  fireEvent(window, new Event('online'))

  await waitFor(() => expect((screen.getByText('Request payment') as HTMLButtonElement).disabled).toBe(false))
  expect(screen.queryByText(/offline/i)).toBeNull()
})

it('still renders a past shift report while offline', async () => {
  vi.stubGlobal('navigator', { ...navigator, onLine: false })
  const past = [
    { id: 'past-1', operatorLabel: 'Ana', openedAt: '2026-08-25T08:00:00.000Z', closedAt: '2026-08-25T16:00:00.000Z', grossNim: '400', confirmed: 1 },
  ]
  const pastReport = {
    shift: past[0],
    totals: { count: 1, confirmed: 1, failed: 0, grossNim: '400', grossFiatMinor: null, fiatCurrency: null, averageTicketNim: '400' },
    entries: [], fiatIncomplete: false,
  }
  const api = {
    getCurrentShift: vi.fn(async () => null),
    getShifts: vi.fn(async () => past),
    getShiftReport: vi.fn(async () => pastReport),
  }
  render(<MemoryRouter><Shift api={api as never} /></MemoryRouter>)
  await waitFor(() => expect(screen.getByText('Ana')).toBeTruthy())
  fireEvent.click(screen.getByText('Ana'))
  await waitFor(() => expect(screen.getByText('400 NIM')).toBeTruthy())
})
