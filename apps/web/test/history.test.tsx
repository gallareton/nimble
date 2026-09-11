import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { History } from '../src/screens/History'
import { PastShiftReport } from '../src/screens/ShiftReport'

// Past shifts used to live at the bottom of the Shift screen, selected in
// place (these tests moved here from shift.test.tsx). R15 gave them a home
// they belong in: a segment on History, and one read-only route per shift.

afterEach(() => cleanup())
beforeEach(() => { sessionStorage.clear() })

const past = [
  { id: 'past-2', operatorLabel: 'Cy', openedAt: '2026-08-26T08:00:00.000Z',
    closedAt: '2026-08-26T16:00:00.000Z', grossNim: '900', confirmed: 3 },
  { id: 'past-1', operatorLabel: 'Ana', openedAt: '2026-08-25T08:00:00.000Z',
    closedAt: '2026-08-25T16:00:00.000Z', grossNim: '400', confirmed: 1 },
]

const reports: Record<string, unknown> = {
  'past-1': {
    shift: past[1],
    totals: { count: 1, confirmed: 1, failed: 0, grossNim: '400', grossFiatMinor: null,
      fiatCurrency: null, averageTicketNim: '400' },
    entries: [], fiatIncomplete: false,
  },
  'past-2': {
    shift: past[0],
    totals: { count: 3, confirmed: 3, failed: 0, grossNim: '900', grossFiatMinor: null,
      fiatCurrency: null, averageTicketNim: '300' },
    entries: [], fiatIncomplete: false,
  },
}

const emptyHistory = vi.fn(async () => ({ items: [], nextCursor: null }))

function renderHistory(api: object) {
  return render(
    <MemoryRouter initialEntries={['/history']}>
      <Routes>
        <Route path="/history" element={<History api={api as never} />} />
      </Routes>
    </MemoryRouter>,
  )
}

it('lists past shifts under the Shifts segment, each one a link to its own report', async () => {
  const api = { history: emptyHistory, getShifts: vi.fn(async () => past) }
  renderHistory(api)

  // Transactions is what History opens on; shifts are one tap away.
  await waitFor(() => expect(screen.getByRole('tab', { name: 'Transactions' })).toBeTruthy())
  fireEvent.click(screen.getByRole('tab', { name: 'Shifts' }))

  await waitFor(() => expect(screen.getByText('Cy')).toBeTruthy())
  const row = screen.getByText('Ana').closest('a')!
  expect(row.getAttribute('href')).toBe('/history/shifts/past-1')
  // R12: date, operator and amount are three elements, never one glued run.
  expect(within(row).getByText('400 NIM').className).toBe('row__amt')
  expect(screen.getByText('Ana').className).toBe('row__sub')
})

it('says so plainly when the vendor has no closed shifts yet', async () => {
  const api = { history: emptyHistory, getShifts: vi.fn(async () => []) }
  renderHistory(api)

  fireEvent.click(await screen.findByRole('tab', { name: 'Shifts' }))
  await waitFor(() => expect(screen.getByText('No closed shifts yet.')).toBeTruthy())
})

it('shows a past shift report on its own route, with the export action', async () => {
  const api = {
    getShiftReport: vi.fn(async (id: string) => reports[id]),
    fetchShiftExport: vi.fn(async () => ({ text: 'id,amount\n1,400', filename: 'shift-past-1.csv', mime: 'text/csv' })),
  }
  const originalCanShare = (navigator as unknown as { canShare?: unknown }).canShare
  delete (navigator as unknown as { canShare?: unknown }).canShare
  render(
    <MemoryRouter initialEntries={['/history/shifts/past-1']}>
      <Routes>
        <Route path="/history/shifts/:id" element={<PastShiftReport api={api as never} />} />
      </Routes>
    </MemoryRouter>,
  )

  await waitFor(() => expect(screen.getByText('400 NIM')).toBeTruthy())
  expect(screen.getByText('Ana')).toBeTruthy()
  expect(screen.getByText(/one station/i)).toBeTruthy()

  // R13: one "Export" target, which opens the two formats.
  fireEvent.click(screen.getByText('Export'))
  fireEvent.click(screen.getByText('Export CSV'))
  await waitFor(() => expect((screen.getByRole('textbox') as HTMLTextAreaElement).value)
    .toBe('id,amount\n1,400'))
  ;(navigator as unknown as { canShare?: unknown }).canShare = originalCanShare
})

it('hides the export action on a past shift report while the cashier lock is on', async () => {
  const api = {
    getShiftReport: vi.fn(async (id: string) => reports[id]),
    getMe: vi.fn(async () => ({ walletAddress: 'NQ1', displayName: null, cashierLocked: true, cashierPinSet: true })),
  }
  render(
    <MemoryRouter initialEntries={['/history/shifts/past-1']}>
      <Routes>
        <Route path="/history/shifts/:id" element={<PastShiftReport api={api as never} />} />
      </Routes>
    </MemoryRouter>,
  )

  await waitFor(() => expect(screen.getByText('400 NIM')).toBeTruthy())
  expect(screen.queryByText('Export')).toBeNull()
  expect(screen.queryByText('Export CSV')).toBeNull()
})

it('shows a different report when a different shift id is opened', async () => {
  // This replaces the old "switching past shifts clears the export panel"
  // test: the two shifts are separate routes now, so each one mounts its
  // own report (and its own, empty, export state).
  const api = { getShiftReport: vi.fn(async (id: string) => reports[id]) }
  const route = (id: string) => (
    <MemoryRouter initialEntries={[`/history/shifts/${id}`]}>
      <Routes>
        <Route path="/history/shifts/:id" element={<PastShiftReport api={api as never} />} />
      </Routes>
    </MemoryRouter>
  )
  const { unmount } = render(route('past-1'))
  await waitFor(() => expect(screen.getByText('400 NIM')).toBeTruthy())
  unmount()
  cleanup()

  render(route('past-2'))
  await waitFor(() => expect(screen.getByText('900 NIM')).toBeTruthy())
  expect(screen.getByText('Cy')).toBeTruthy()
  expect(screen.queryByText('400 NIM')).toBeNull()
})

it('folds the search and date fields behind a Filters button, and spells out what an empty date means', async () => {
  const api = { history: emptyHistory, getShifts: vi.fn(async () => []) }
  renderHistory(api)

  // Collapsed by default — the chips stay, everything else folds away.
  await waitFor(() => expect(screen.getByText('All')).toBeTruthy())
  expect(screen.queryByLabelText('Search history')).toBeNull()

  fireEvent.click(screen.getByRole('button', { name: 'Filters' }))
  expect(screen.getByLabelText('Search history')).toBeTruthy()
  // R18: a native date input has no placeholder, so the label carries it.
  expect(screen.getByText(/any date/)).toBeTruthy()
  expect(screen.getByText(/today/)).toBeTruthy()
})

it('opens the filters already expanded, and counts them, when a filter is active', async () => {
  const api = { history: emptyHistory, getShifts: vi.fn(async () => []) }
  render(
    <MemoryRouter initialEntries={['/history?q=soda&from=2026-08-01']}>
      <Routes>
        <Route path="/history" element={<History api={api as never} />} />
      </Routes>
    </MemoryRouter>,
  )

  await waitFor(() => expect(screen.getByLabelText('Search history')).toBeTruthy())
  expect(screen.getByRole('button', { name: 'Filters (2)' })).toBeTruthy()
  // The "from" field is set, so only "to" still advertises its default.
  expect(screen.queryByText(/any date/)).toBeNull()
  expect(screen.getByText(/today/)).toBeTruthy()
})

it('shows a paid cash sale as a static row — no receipt to open', async () => {
  const api = {
    history: vi.fn(async () => ({
      items: [{ kind: 'cash', saleId: 'sale-1', role: 'receiver',
        snapshot: { amountFiatMinor: 1500, fiatCurrency: 'USD',
          reference: 'Soda × 2, Sandwich', paymentMethod: 'cash' },
        createdAt: '2026-09-10T10:00:00.000Z' }],
      nextCursor: null,
    })),
    getShifts: vi.fn(async () => []),
  }
  renderHistory(api)

  const label = await screen.findByText(/Cash · Soda × 2, Sandwich/)
  expect(label.closest('a')).toBeNull() // a cash sale has no receipt
  const row = label.closest('li')!
  expect(within(row).getByText('15.00 USD')).toBeTruthy()
  expect(row.querySelector('.list__static')).toBeTruthy()
  // No frozen rate on this sale, so no NIM line at all — never today's rate.
  expect(row.querySelector('.price-nim')).toBeNull()
})

it('shows the NIM value of a cash sale from the rate frozen at the sale (P5)', async () => {
  const api = {
    history: vi.fn(async () => ({
      items: [{ kind: 'cash', saleId: 'sale-2', role: 'receiver',
        snapshot: { amountFiatMinor: 1500, fiatCurrency: 'USD', reference: 'Soda',
          paymentMethod: 'cash', fxRate: '0.004', fxRateAt: '2026-09-10T10:00:00.000Z',
          amountNim: '375.5' },
        createdAt: '2026-09-10T10:00:00.000Z' }],
      nextCursor: null,
    })),
    getShifts: vi.fn(async () => []),
    getRate: vi.fn(async () => ({ usdPerNim: 0.5 })),
  }
  renderHistory(api)

  const row = (await screen.findByText(/Cash · Soda/)).closest('li')!
  expect(within(row).getByText('15.00 USD')).toBeTruthy()
  expect(row.querySelector('.price-nim')!.textContent).toBe('≈ 375.50 NIM')
  // The live rate is never consulted for an already-transacted row.
  expect(api.getRate).not.toHaveBeenCalled()
})
