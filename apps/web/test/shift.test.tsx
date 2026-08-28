import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { Shift } from '../src/screens/Shift'
import { ApiError } from '../src/api/client'

const noShift = { getCurrentShift: vi.fn(async () => null), openShift: vi.fn() }

afterEach(() => cleanup())

it('offers to open a shift when none is running', async () => {
  render(<MemoryRouter><Shift api={noShift as never} /></MemoryRouter>)
  await waitFor(() => expect(screen.getByText('Open a shift')).toBeTruthy())
  expect(screen.getByText(/one station/i)).toBeTruthy()
})

it('shows the running shift and its totals', async () => {
  const api = {
    getCurrentShift: vi.fn(async () => ({ id: 's1', operatorLabel: 'Ana',
      openedAt: '2026-08-27T08:00:00.000Z', closedAt: null })),
    getShiftReport: vi.fn(async () => ({
      shift: { id: 's1', operatorLabel: 'Ana', openedAt: '2026-08-27T08:00:00.000Z', closedAt: null },
      totals: { count: 2, confirmed: 2, failed: 0, grossNim: '500', grossFiatMinor: 1234,
        fiatCurrency: 'USD', averageTicketNim: '250' },
      entries: [], fiatIncomplete: false,
    })),
  }
  render(<MemoryRouter><Shift api={api as never} /></MemoryRouter>)
  await waitFor(() => expect(screen.getByText('Ana')).toBeTruthy())
  expect(screen.getByText('500 NIM')).toBeTruthy()
  expect(screen.getByText('Close the shift')).toBeTruthy()
})

it('shows a failure message instead of the open-a-shift form when loading breaks', async () => {
  const api = {
    getCurrentShift: vi.fn(async () => { throw new Error('network down') }),
    openShift: vi.fn(),
  }
  render(<MemoryRouter><Shift api={api as never} /></MemoryRouter>)
  await waitFor(() => expect(screen.getByText(/Could not load the shift/i)).toBeTruthy())
  expect(screen.queryByText('Open a shift')).toBeNull()
})

it('shows an on-screen panel with the export text when the webview cannot share or download', async () => {
  const report = {
    shift: { id: 's1', operatorLabel: 'Ana', openedAt: '2026-08-27T08:00:00.000Z', closedAt: '2026-08-27T16:00:00.000Z' },
    totals: { count: 1, confirmed: 1, failed: 0, grossNim: '500', grossFiatMinor: null, fiatCurrency: null, averageTicketNim: '500' },
    entries: [], fiatIncomplete: false,
  }
  const api = {
    getCurrentShift: vi.fn(async () => ({ id: 's1', operatorLabel: 'Ana', openedAt: '2026-08-27T08:00:00.000Z', closedAt: null })),
    getShiftReport: vi.fn(async () => report),
    closeShift: vi.fn(async () => report),
    fetchShiftExport: vi.fn(async () => ({ text: 'id,amount\n1,500', filename: 'shift-s1.csv', mime: 'text/csv' })),
  }
  const originalCanShare = (navigator as unknown as { canShare?: unknown }).canShare
  delete (navigator as unknown as { canShare?: unknown }).canShare
  render(<MemoryRouter><Shift api={api as never} /></MemoryRouter>)
  await waitFor(() => expect(screen.getByText('Close the shift')).toBeTruthy())
  fireEvent.click(screen.getByText('Close the shift'))
  await waitFor(() => expect(screen.getByText('Download CSV')).toBeTruthy())
  fireEvent.click(screen.getByText('Download CSV'))
  await waitFor(() => expect((screen.getByRole('textbox') as HTMLTextAreaElement).value)
    .toBe('id,amount\n1,500'))
  ;(navigator as unknown as { canShare?: unknown }).canShare = originalCanShare
})

it('shares the export via navigator.share when the webview supports it, without showing the panel', async () => {
  const report = {
    shift: { id: 's1', operatorLabel: 'Ana', openedAt: '2026-08-27T08:00:00.000Z', closedAt: '2026-08-27T16:00:00.000Z' },
    totals: { count: 1, confirmed: 1, failed: 0, grossNim: '500', grossFiatMinor: null, fiatCurrency: null, averageTicketNim: '500' },
    entries: [], fiatIncomplete: false,
  }
  const api = {
    getCurrentShift: vi.fn(async () => ({ id: 's1', operatorLabel: 'Ana', openedAt: '2026-08-27T08:00:00.000Z', closedAt: null })),
    getShiftReport: vi.fn(async () => report),
    closeShift: vi.fn(async () => report),
    fetchShiftExport: vi.fn(async () => ({ text: 'id,amount\n1,500', filename: 'shift-s1.csv', mime: 'text/csv' })),
  }
  const canShare = vi.fn(() => true)
  const share = vi.fn(async () => {})
  ;(navigator as unknown as { canShare?: unknown }).canShare = canShare
  ;(navigator as unknown as { share?: unknown }).share = share
  render(<MemoryRouter><Shift api={api as never} /></MemoryRouter>)
  await waitFor(() => expect(screen.getByText('Close the shift')).toBeTruthy())
  fireEvent.click(screen.getByText('Close the shift'))
  await waitFor(() => expect(screen.getByText('Download CSV')).toBeTruthy())
  fireEvent.click(screen.getByText('Download CSV'))
  await waitFor(() => expect(share).toHaveBeenCalledTimes(1))
  expect(screen.queryByRole('textbox')).toBeNull()
  delete (navigator as unknown as { canShare?: unknown }).canShare
  delete (navigator as unknown as { share?: unknown }).share
})

it('lists past shifts and shows a selected one\'s report using the same export actions', async () => {
  const past = [
    { id: 'past-2', operatorLabel: 'Cy', openedAt: '2026-08-26T08:00:00.000Z', closedAt: '2026-08-26T16:00:00.000Z', grossNim: '900', confirmed: 3 },
    { id: 'past-1', operatorLabel: 'Ana', openedAt: '2026-08-25T08:00:00.000Z', closedAt: '2026-08-25T16:00:00.000Z', grossNim: '400', confirmed: 1 },
  ]
  const pastReport = {
    shift: past[1],
    totals: { count: 1, confirmed: 1, failed: 0, grossNim: '400', grossFiatMinor: null, fiatCurrency: null, averageTicketNim: '400' },
    entries: [], fiatIncomplete: false,
  }
  const api = {
    getCurrentShift: vi.fn(async () => null),
    getShifts: vi.fn(async () => past),
    getShiftReport: vi.fn(async (id: string) => {
      if (id === 'past-1') return pastReport
      throw new Error('unexpected id')
    }),
  }
  render(<MemoryRouter><Shift api={api as never} /></MemoryRouter>)
  await waitFor(() => expect(screen.getByText('Open a shift')).toBeTruthy())
  await waitFor(() => expect(screen.getByText('Cy')).toBeTruthy())
  expect(screen.getByText('Ana')).toBeTruthy()

  fireEvent.click(screen.getByText('Ana'))
  await waitFor(() => expect(screen.getByText('400 NIM')).toBeTruthy())
  expect(screen.getByText('Download CSV')).toBeTruthy()
})

it('shows nothing extra when the vendor has no past shifts', async () => {
  const api = {
    getCurrentShift: vi.fn(async () => null),
    getShifts: vi.fn(async () => []),
  }
  render(<MemoryRouter><Shift api={api as never} /></MemoryRouter>)
  await waitFor(() => expect(screen.getByText('Open a shift')).toBeTruthy())
  expect(screen.queryByText(/Past shifts/i)).toBeNull()
})

it('tells the vendor a shift is already open instead of failing silently on a 409', async () => {
  const api = {
    getCurrentShift: vi.fn(async () => null),
    openShift: vi.fn(async () => { throw new ApiError('SHIFT_OPEN', 'a shift is already open', 409) }),
  }
  render(<MemoryRouter><Shift api={api as never} /></MemoryRouter>)
  await waitFor(() => expect(screen.getByText('Open a shift')).toBeTruthy())
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Ana' } })
  fireEvent.click(screen.getByText('Open a shift'))
  await waitFor(() => expect(screen.getByRole('alert').textContent)
    .toMatch(/already open/i))
  // The button re-enables so the vendor can retry, rather than staying stuck.
  expect((screen.getByText('Open a shift') as HTMLButtonElement).disabled).toBe(false)
})
