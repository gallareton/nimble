import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { Charge } from '../src/screens/Charge'
import { Shift } from '../src/screens/Shift'
import { RETRY_INTERVAL_MS } from '../src/lib/online'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.useRealTimers()
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

it('refuses at submit time when a fresh probe fails, even though navigator.onLine is still true — a dead uplink behind a live Wi-Fi association', async () => {
  vi.stubGlobal('navigator', { ...navigator, onLine: true })
  let calls = 0
  const api = {
    getNetwork: vi.fn(async () => {
      calls++
      if (calls === 1) return { network: 'test', height: 1 } // mount probe: fine
      throw new Error('dead uplink') // submit-time probe: not fine
    }),
    claim: vi.fn(async () => ({ sessionId: 's1' })),
  }
  render(<MemoryRouter><Charge api={api as never} /></MemoryRouter>)
  fillChargeForm()
  await waitFor(() => expect((screen.getByText('Request payment') as HTMLButtonElement).disabled).toBe(false))

  fireEvent.click(screen.getByText('Request payment'))

  await waitFor(() => expect(screen.getByText(/offline/i)).toBeTruthy())
  expect(api.claim).not.toHaveBeenCalled()
})

it('recovers on its own via periodic re-probe once the backend answers again, without an online event ever firing', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  // Stays true the whole test — this is the "live Wi-Fi, dead uplink"
  // case the online/offline events cannot signal at all.
  vi.stubGlobal('navigator', { ...navigator, onLine: true })
  let calls = 0
  const api = {
    getNetwork: vi.fn(async () => {
      calls++
      if (calls < 3) throw new Error('down')
      return { network: 'test', height: 1 }
    }),
    claim: vi.fn(),
  }
  render(<MemoryRouter><Charge api={api as never} /></MemoryRouter>)
  fillChargeForm()
  await waitFor(() => expect((screen.getByText('Request payment') as HTMLButtonElement).disabled).toBe(true))

  await vi.advanceTimersByTimeAsync(RETRY_INTERVAL_MS * 3)

  await waitFor(() => expect((screen.getByText('Request payment') as HTMLButtonElement).disabled).toBe(false))
  expect(screen.queryByText(/offline/i)).toBeNull()
})
