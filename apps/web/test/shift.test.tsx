import { afterEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { Shift } from '../src/screens/Shift'
import { NewRemoteCharge } from '../src/screens/NewRemoteCharge'
import { Refund } from '../src/screens/Refund'
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

it('renders the past-shifts list identically whether reached from the open-shift form or the closed-shift view', async () => {
  const past = [
    { id: 'past-1', operatorLabel: 'Ana', openedAt: '2026-08-25T08:00:00.000Z', closedAt: '2026-08-25T16:00:00.000Z', grossNim: '400', confirmed: 1 },
  ]
  const noShiftApi = { getCurrentShift: vi.fn(async () => null), getShifts: vi.fn(async () => past) }
  const { unmount } = render(<MemoryRouter><Shift api={noShiftApi as never} /></MemoryRouter>)
  await waitFor(() => expect(screen.getByText('Ana')).toBeTruthy())
  const noShiftHtml = screen.getByText('Ana').closest('a')!.innerHTML
  unmount()
  cleanup()

  // A closed shift (shift === null, report set) reaches the same "else"
  // render branch as the running-shift view, just without the current
  // shift's own report replaced yet — the list only shows once !shift.
  const closedShiftApi = {
    getCurrentShift: vi.fn(async () => ({ id: 's1', operatorLabel: 'Cy', openedAt: '2026-08-27T08:00:00.000Z', closedAt: null })),
    getShiftReport: vi.fn(async () => ({
      shift: { id: 's1', operatorLabel: 'Cy', openedAt: '2026-08-27T08:00:00.000Z', closedAt: '2026-08-27T16:00:00.000Z' },
      totals: { count: 0, confirmed: 0, failed: 0, grossNim: '0', grossFiatMinor: null, fiatCurrency: null, averageTicketNim: null },
      entries: [], fiatIncomplete: false,
    })),
    closeShift: vi.fn(async () => ({
      shift: { id: 's1', operatorLabel: 'Cy', openedAt: '2026-08-27T08:00:00.000Z', closedAt: '2026-08-27T16:00:00.000Z' },
      totals: { count: 0, confirmed: 0, failed: 0, grossNim: '0', grossFiatMinor: null, fiatCurrency: null, averageTicketNim: null },
      entries: [], fiatIncomplete: false,
    })),
    getShifts: vi.fn(async () => past),
  }
  render(<MemoryRouter><Shift api={closedShiftApi as never} /></MemoryRouter>)
  await waitFor(() => expect(screen.getByText('Close the shift')).toBeTruthy())
  fireEvent.click(screen.getByText('Close the shift'))
  await waitFor(() => expect(screen.getByText('Ana')).toBeTruthy())
  const closedHtml = screen.getByText('Ana').closest('a')!.innerHTML
  expect(closedHtml).toBe(noShiftHtml)
})

it('lets the vendor leave a viewed past shift and return to the open-a-shift form, without a remount', async () => {
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

  fireEvent.click(screen.getByText(/Back/i))
  await waitFor(() => expect(screen.getByText('Open a shift')).toBeTruthy())
})

it('clears an open export panel when the vendor switches from one past shift to another', async () => {
  const past = [
    { id: 'past-2', operatorLabel: 'Cy', openedAt: '2026-08-26T08:00:00.000Z', closedAt: '2026-08-26T16:00:00.000Z', grossNim: '900', confirmed: 3 },
    { id: 'past-1', operatorLabel: 'Ana', openedAt: '2026-08-25T08:00:00.000Z', closedAt: '2026-08-25T16:00:00.000Z', grossNim: '400', confirmed: 1 },
  ]
  const reports: Record<string, unknown> = {
    'past-1': {
      shift: past[1],
      totals: { count: 1, confirmed: 1, failed: 0, grossNim: '400', grossFiatMinor: null, fiatCurrency: null, averageTicketNim: '400' },
      entries: [], fiatIncomplete: false,
    },
    'past-2': {
      shift: past[0],
      totals: { count: 3, confirmed: 3, failed: 0, grossNim: '900', grossFiatMinor: null, fiatCurrency: null, averageTicketNim: '300' },
      entries: [], fiatIncomplete: false,
    },
  }
  const originalCanShare = (navigator as unknown as { canShare?: unknown }).canShare
  delete (navigator as unknown as { canShare?: unknown }).canShare
  const api = {
    getCurrentShift: vi.fn(async () => null),
    getShifts: vi.fn(async () => past),
    getShiftReport: vi.fn(async (id: string) => reports[id]),
    fetchShiftExport: vi.fn(async () => ({ text: 'id,amount\n1,400', filename: 'shift-past-1.csv', mime: 'text/csv' })),
  }
  render(<MemoryRouter><Shift api={api as never} /></MemoryRouter>)
  await waitFor(() => expect(screen.getByText('Ana')).toBeTruthy())

  fireEvent.click(screen.getByText('Ana'))
  await waitFor(() => expect(screen.getByText('400 NIM')).toBeTruthy())
  fireEvent.click(screen.getByText('Download CSV'))
  await waitFor(() => expect(screen.getByRole('textbox')).toBeTruthy())

  fireEvent.click(screen.getByText('Cy'))
  await waitFor(() => expect(screen.getByText('900 NIM')).toBeTruthy())
  expect(screen.queryByRole('textbox')).toBeNull()
  ;(navigator as unknown as { canShare?: unknown }).canShare = originalCanShare
})

it('lets the vendor return to the open-a-shift form after closing a shift, keeping the report until then', async () => {
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
  render(<MemoryRouter><Shift api={api as never} /></MemoryRouter>)
  await waitFor(() => expect(screen.getByText('Close the shift')).toBeTruthy())
  fireEvent.click(screen.getByText('Close the shift'))

  // The closed report and its export actions stay reachable until the
  // vendor explicitly leaves — closing must not hide them immediately.
  await waitFor(() => expect(screen.getByText('Download CSV')).toBeTruthy())
  expect(screen.getByText('500 NIM')).toBeTruthy()

  fireEvent.click(screen.getByText(/Back/i))
  await waitFor(() => expect(screen.getByText('Open a shift')).toBeTruthy())
  expect(screen.queryByText('Download CSV')).toBeNull()
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

interface RemoteChargeOpts { amountLuna?: string; fiatAmountMinor?: number; fiatCurrency?: string; reference?: string }

it('issues a remote bill in USD and sends fiatAmountMinor in cents, not a float', async () => {
  localStorage.clear()
  const createChargeRequest = vi.fn(async (_opts: RemoteChargeOpts) => ({ id: 'cr1', expiresAt: '2026-09-08T12:00:00.000Z' }))
  const api = { createChargeRequest }
  render(<MemoryRouter><NewRemoteCharge api={api as never} /></MemoryRouter>)

  fireEvent.change(screen.getByLabelText(/Amount \(USD\)/i), { target: { value: '12.34' } })
  fireEvent.click(screen.getByRole('button', { name: /Create bill/i }))

  await waitFor(() => expect(createChargeRequest).toHaveBeenCalledTimes(1))
  const [opts] = createChargeRequest.mock.calls[0]
  expect(opts.fiatAmountMinor).toBe(1234)
  expect(Number.isInteger(opts.fiatAmountMinor)).toBe(true)
  expect(opts.fiatCurrency).toBe('USD')
  expect(opts.amountLuna).toBeUndefined()
})

it('sends amountLuna when the vendor prices the bill in NIM', async () => {
  const createChargeRequest = vi.fn(async (_opts: RemoteChargeOpts) => ({ id: 'cr2', expiresAt: '2026-09-08T12:00:00.000Z' }))
  const api = { createChargeRequest }
  render(<MemoryRouter><NewRemoteCharge api={api as never} /></MemoryRouter>)

  fireEvent.click(screen.getByRole('button', { name: 'NIM' }))
  fireEvent.change(screen.getByLabelText(/Amount \(NIM\)/i), { target: { value: '2.5' } })
  fireEvent.click(screen.getByRole('button', { name: /Create bill/i }))

  await waitFor(() => expect(createChargeRequest).toHaveBeenCalledTimes(1))
  const [opts] = createChargeRequest.mock.calls[0]
  expect(opts.amountLuna).toBe('250000')
  expect(opts.fiatAmountMinor).toBeUndefined()
})

it('shows the bill link on screen after issuing it, and lets the vendor copy it', async () => {
  localStorage.clear()
  const writeText = vi.fn(async () => {})
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
  const api = {
    createChargeRequest: vi.fn(async () => ({ id: 'cr3', expiresAt: '2026-09-08T12:00:00.000Z' })),
  }
  render(<MemoryRouter><NewRemoteCharge api={api as never} /></MemoryRouter>)

  fireEvent.change(screen.getByLabelText(/Amount \(USD\)/i), { target: { value: '5.00' } })
  fireEvent.click(screen.getByRole('button', { name: /Create bill/i }))

  await waitFor(() => expect(api.createChargeRequest).toHaveBeenCalledTimes(1))
  // Both links are on screen and both are copyable: the plain one to send to
  // anyone, the nimiqpay:// one that jumps straight into the wallet. The
  // deeplink used to be unselectable body text, which made the very thing you
  // need on a phone the one thing you could not take with you.
  // One link, and it is the ordinary https one. A nimiqpay:// link was offered
  // here until a device test showed messengers do not linkify it at all and a
  // browser address bar sends it to a search engine — so it was a trap: the
  // vendor would copy something that does nothing for the customer.
  const plain = await screen.findByDisplayValue(/^https?:\/\/.*\/r\/cr3$/)
  expect(plain).toBeTruthy()
  expect(screen.queryByDisplayValue(/^nimiqpay:\/\//)).toBeNull()

  fireEvent.click(screen.getByRole('button', { name: /Copy the link/i }))
  await waitFor(() => expect(writeText).toHaveBeenCalledWith(expect.stringContaining('/r/cr3')))
  await waitFor(() => expect(screen.getByText('Copied')).toBeTruthy())
})

it('keeps the sales list live while a shift is open', async () => {
  // The bug: the report was fetched once when the screen opened, so a sale a
  // customer paid for seconds later never appeared. The till has no other way
  // to learn about it — nobody touches the till when a remote bill is paid.
  vi.useFakeTimers({ shouldAdvanceTime: true })
  try {
    const api = {
      getCurrentShift: vi.fn(async () => ({ id: 's9', operatorLabel: 'Ana',
        openedAt: '2026-09-08T08:00:00.000Z', closedAt: null })),
      getShiftReport: vi.fn(async () => ({
        shift: { id: 's9', operatorLabel: 'Ana', openedAt: '2026-09-08T08:00:00.000Z', closedAt: null },
        totals: { count: 0, confirmed: 0, failed: 0, grossNim: '0', grossFiatMinor: null,
          fiatCurrency: null, averageTicketNim: null },
        entries: [], fiatIncomplete: false,
      })),
      getShifts: vi.fn(async () => []),
    }
    render(<MemoryRouter><Shift api={api as never} /></MemoryRouter>)

    await waitFor(() => expect(api.getShiftReport).toHaveBeenCalledTimes(1))

    await act(async () => { vi.advanceTimersByTime(11_000) })
    await waitFor(() => expect(api.getShiftReport.mock.calls.length).toBeGreaterThan(1))
  } finally {
    vi.useRealTimers()
  }
})

it('warns before closing a shift while bills are still unpaid, then closes on the next tap', async () => {
  // A bill paid after the shift closes lands in whatever shift is open then,
  // or in none at all. Closing is the only moment the vendor can act on that.
  const report = {
    shift: { id: 's7', operatorLabel: 'Ana', openedAt: '2026-09-08T08:00:00.000Z', closedAt: null },
    totals: { count: 0, confirmed: 0, failed: 0, grossNim: '0', grossFiatMinor: null,
      fiatCurrency: null, averageTicketNim: null },
    entries: [], fiatIncomplete: false,
  }
  const api = {
    getCurrentShift: vi.fn(async () => report.shift),
    getShiftReport: vi.fn(async () => report),
    getShifts: vi.fn(async () => []),
    getOutstandingBills: vi.fn(async () => ({ bills: [
      { id: 'b1', amountLuna: '250000', fiatAmountMinor: null, fiatCurrency: null,
        reference: null, expiresAt: '2026-09-09T08:00:00.000Z' },
      { id: 'b2', amountLuna: '500000', fiatAmountMinor: null, fiatCurrency: null,
        reference: null, expiresAt: '2026-09-09T08:00:00.000Z' },
    ] })),
    closeShift: vi.fn(async () => ({ ...report, shift: { ...report.shift, closedAt: 'x' } })),
  }
  render(<MemoryRouter><Shift api={api as never} /></MemoryRouter>)
  await waitFor(() => expect(screen.getByText('Close the shift')).toBeTruthy())

  fireEvent.click(screen.getByText('Close the shift'))
  await waitFor(() => expect(api.getOutstandingBills).toHaveBeenCalled())
  expect(await screen.findByRole('alert')).toBeTruthy()
  expect(screen.getByText(/2 bills are still unpaid/i)).toBeTruthy()
  // The first tap warns and must NOT have closed anything.
  expect(api.closeShift).not.toHaveBeenCalled()

  fireEvent.click(screen.getByText('Close it anyway'))
  await waitFor(() => expect(api.closeShift).toHaveBeenCalledTimes(1))
})

it('closes without a warning when no bills are outstanding', async () => {
  const report = {
    shift: { id: 's8', operatorLabel: 'Bo', openedAt: '2026-09-08T08:00:00.000Z', closedAt: null },
    totals: { count: 0, confirmed: 0, failed: 0, grossNim: '0', grossFiatMinor: null,
      fiatCurrency: null, averageTicketNim: null },
    entries: [], fiatIncomplete: false,
  }
  const api = {
    getCurrentShift: vi.fn(async () => report.shift),
    getShiftReport: vi.fn(async () => report),
    getShifts: vi.fn(async () => []),
    getOutstandingBills: vi.fn(async () => ({ bills: [] })),
    closeShift: vi.fn(async () => ({ ...report, shift: { ...report.shift, closedAt: 'x' } })),
  }
  render(<MemoryRouter><Shift api={api as never} /></MemoryRouter>)
  await waitFor(() => expect(screen.getByText('Close the shift')).toBeTruthy())

  fireEvent.click(screen.getByText('Close the shift'))
  await waitFor(() => expect(api.closeShift).toHaveBeenCalledTimes(1))
  expect(screen.queryByRole('alert')).toBeNull()
})

it('lists issued bills and cancels one, so a vendor can undo a mistake', async () => {
  // Issuing links you can neither see nor withdraw is half a feature: a bill
  // typed wrong would stay payable for its full day.
  const bill = { id: 'b1', amountLuna: '250000', fiatAmountMinor: 500, fiatCurrency: 'USD',
    reference: 'Soda', expiresAt: '2026-09-09T08:00:00.000Z' }
  let remaining = [bill]
  const api = {
    createChargeRequest: vi.fn(),
    getOutstandingBills: vi.fn(async () => ({ bills: remaining })),
    cancelChargeRequest: vi.fn(async (id: string) => { remaining = remaining.filter(b => b.id !== id) }),
  }
  render(<MemoryRouter><NewRemoteCharge api={api as never} /></MemoryRouter>)

  expect(await screen.findByText(/Soda/)).toBeTruthy()
  expect(screen.getByText(/5\.00 USD/)).toBeTruthy()

  fireEvent.click(screen.getByRole('button', { name: /^Cancel$/i }))
  await waitFor(() => expect(api.cancelChargeRequest).toHaveBeenCalledWith('b1'))
  // The list reloads from the server rather than trusting local state: whether
  // the cancel really took is the server's answer to give.
  await waitFor(() => expect(screen.queryByText(/Soda/)).toBeNull())
})

// --- Task 4: refund from the shift report ------------------------------

const saleEntry = {
  chargeId: 'c1', localNumber: 1, occurredAt: '2026-09-08T09:00:00.000Z',
  status: 'CONFIRMED', amountNim: '10', asset: 'NIM', network: 'nimiq', hash: 'abc',
  reference: 'Coffee', amountFiatMinor: null, fiatCurrency: null,
  fxRate: null, fxRateAt: null, fxSource: null,
  refundOfLocalNumber: null, refundOfOccurredAt: null,
}
const refundOfSaleEntry = {
  chargeId: 'c2', localNumber: 2, occurredAt: '2026-09-08T10:00:00.000Z',
  status: 'CONFIRMED', amountNim: '-4', asset: 'NIM', network: 'nimiq', hash: 'def',
  reference: 'partial', amountFiatMinor: null, fiatCurrency: null,
  fxRate: null, fxRateAt: null, fxSource: null,
  refundOfLocalNumber: 1, refundOfOccurredAt: '2026-09-08T09:00:00.000Z',
}
const unconfirmedEntry = {
  chargeId: 'c3', localNumber: 3, occurredAt: '2026-09-08T11:00:00.000Z',
  status: 'AWAITING_PAYER_APPROVAL', amountNim: '5', asset: 'NIM', network: 'nimiq', hash: null,
  reference: null, amountFiatMinor: null, fiatCurrency: null,
  fxRate: null, fxRateAt: null, fxSource: null,
  refundOfLocalNumber: null, refundOfOccurredAt: null,
}

it('lists the report entries — a sale and a refund, the refund negative and pointing back at the sale', async () => {
  const report = {
    shift: { id: 's1', operatorLabel: 'Ana', openedAt: '2026-09-08T08:00:00.000Z', closedAt: null },
    totals: { count: 2, confirmed: 1, refunded: 1, failed: 0, grossNim: '6', grossFiatMinor: null,
      fiatCurrency: null, averageTicketNim: '10' },
    entries: [saleEntry, refundOfSaleEntry], fiatIncomplete: false,
  }
  const api = {
    getCurrentShift: vi.fn(async () => ({ id: 's1', operatorLabel: 'Ana', openedAt: '2026-09-08T08:00:00.000Z', closedAt: null })),
    getShiftReport: vi.fn(async () => report),
  }
  render(<MemoryRouter><Shift api={api as never} /></MemoryRouter>)

  await waitFor(() => expect(screen.getByText('10 NIM')).toBeTruthy())
  expect(screen.getByText('Coffee')).toBeTruthy()
  expect(screen.getByText('-4 NIM')).toBeTruthy()
  expect(screen.getByText(/Refund of sale #1/)).toBeTruthy()
})

it('shows the refund action only on a confirmed sale, never on a refund entry or an unconfirmed one', async () => {
  const report = {
    shift: { id: 's1', operatorLabel: 'Ana', openedAt: '2026-09-08T08:00:00.000Z', closedAt: null },
    totals: { count: 3, confirmed: 1, refunded: 1, failed: 0, grossNim: '6', grossFiatMinor: null,
      fiatCurrency: null, averageTicketNim: '10' },
    entries: [saleEntry, refundOfSaleEntry, unconfirmedEntry], fiatIncomplete: false,
  }
  const api = {
    getCurrentShift: vi.fn(async () => ({ id: 's1', operatorLabel: 'Ana', openedAt: '2026-09-08T08:00:00.000Z', closedAt: null })),
    getShiftReport: vi.fn(async () => report),
  }
  render(<MemoryRouter><Shift api={api as never} /></MemoryRouter>)

  await waitFor(() => expect(screen.getByText('10 NIM')).toBeTruthy())
  const refundLinks = screen.getAllByRole('link', { name: 'Refund' })
  expect(refundLinks.length).toBe(1)
  expect(refundLinks[0].getAttribute('href')).toBe('/refund/c1')
})

it('rejects a refund amount bigger than the original sale before sending anything', async () => {
  const createRefund = vi.fn()
  const api = { createRefund }
  render(
    <MemoryRouter initialEntries={[{ pathname: '/refund/c1', state: { amountNim: '10', reference: 'Coffee' } }]}>
      <Routes>
        <Route path="/refund/:chargeId" element={<Refund api={api as never} />} />
      </Routes>
    </MemoryRouter>,
  )

  const input = await screen.findByLabelText(/Amount to refund/i)
  fireEvent.change(input, { target: { value: '20' } })
  fireEvent.click(screen.getByRole('button', { name: /Send refund/i }))

  await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/cannot be more than/i))
  expect(createRefund).not.toHaveBeenCalled()
})

it('moves to the session approval screen after creating a refund', async () => {
  const createRefund = vi.fn(async (_id: string, _opts: { amountLuna?: string; reason?: string }) =>
    ({ refundId: 'r1', sessionId: 'sess1', chargeId: 'c9' }))
  const api = { createRefund }
  render(
    <MemoryRouter initialEntries={[{ pathname: '/refund/c1', state: { amountNim: '10', reference: 'Coffee' } }]}>
      <Routes>
        <Route path="/refund/:chargeId" element={<Refund api={api as never} />} />
        <Route path="/session/:id" element={<div>session screen</div>} />
      </Routes>
    </MemoryRouter>,
  )

  const input = await screen.findByLabelText(/Amount to refund/i)
  fireEvent.change(input, { target: { value: '4' } })
  fireEvent.click(screen.getByRole('button', { name: /Send refund/i }))

  await waitFor(() => expect(createRefund).toHaveBeenCalledTimes(1))
  expect(createRefund.mock.calls[0][0]).toBe('c1')
  expect(createRefund.mock.calls[0][1]).toEqual({ amountLuna: '400000', reason: undefined })
  await waitFor(() => expect(screen.getByText('session screen')).toBeTruthy())
})

// --- Task 2: cashier lock — hidden actions, working payment/report -----

const lockedReport = {
  shift: { id: 's1', operatorLabel: 'Ana', openedAt: '2026-09-08T08:00:00.000Z', closedAt: null },
  totals: { count: 2, confirmed: 1, refunded: 1, failed: 0, grossNim: '6', grossFiatMinor: null,
    fiatCurrency: null, averageTicketNim: '10' },
  entries: [saleEntry, refundOfSaleEntry], fiatIncomplete: false,
}

it('hides refund and close-shift while the cashier lock is on, but leaves the report visible', async () => {
  const api = {
    getCurrentShift: vi.fn(async () => ({ id: 's1', operatorLabel: 'Ana', openedAt: '2026-09-08T08:00:00.000Z', closedAt: null })),
    getShiftReport: vi.fn(async () => lockedReport),
    getMe: vi.fn(async () => ({ walletAddress: 'NQ1', displayName: null, cashierLocked: true, cashierPinSet: true })),
  }
  render(<MemoryRouter><Shift api={api as never} /></MemoryRouter>)

  // The report itself — totals and the entries list — must still be there:
  // this is the assertion guarding against the lock spilling into sales.
  await waitFor(() => expect(screen.getByText('10 NIM')).toBeTruthy())
  expect(screen.getByText('Coffee')).toBeTruthy()
  await waitFor(() => expect(screen.getByText(/isn't broken/i)).toBeTruthy())

  expect(screen.queryByRole('link', { name: 'Refund' })).toBeNull()
  expect(screen.queryByText('Close the shift')).toBeNull()
  // Accepting a bill (creating a charge request) is untouched by the lock.
  expect(screen.getByText('Bill someone who isn\'t here')).toBeTruthy()
})

it('shows refund and close-shift normally when the cashier lock is off', async () => {
  const api = {
    getCurrentShift: vi.fn(async () => ({ id: 's1', operatorLabel: 'Ana', openedAt: '2026-09-08T08:00:00.000Z', closedAt: null })),
    getShiftReport: vi.fn(async () => lockedReport),
    getMe: vi.fn(async () => ({ walletAddress: 'NQ1', displayName: null, cashierLocked: false, cashierPinSet: true })),
  }
  render(<MemoryRouter><Shift api={api as never} /></MemoryRouter>)

  await waitFor(() => expect(screen.getByText('10 NIM')).toBeTruthy())
  expect(screen.getAllByRole('link', { name: 'Refund' }).length).toBe(1)
  expect(screen.getByText('Close the shift')).toBeTruthy()
  expect(screen.queryByText(/isn't broken/i)).toBeNull()
})

it('hides the export links on a past shift\'s report while the cashier lock is on', async () => {
  const past = [{ id: 'past-1', operatorLabel: 'Ana', openedAt: '2026-08-25T08:00:00.000Z',
    closedAt: '2026-08-25T16:00:00.000Z', grossNim: '400', confirmed: 1 }]
  const pastReport = {
    shift: past[0],
    totals: { count: 1, confirmed: 1, failed: 0, grossNim: '400', grossFiatMinor: null, fiatCurrency: null, averageTicketNim: '400' },
    entries: [], fiatIncomplete: false,
  }
  const api = {
    getCurrentShift: vi.fn(async () => null),
    getShifts: vi.fn(async () => past),
    getShiftReport: vi.fn(async () => pastReport),
    getMe: vi.fn(async () => ({ walletAddress: 'NQ1', displayName: null, cashierLocked: true, cashierPinSet: true })),
  }
  render(<MemoryRouter><Shift api={api as never} /></MemoryRouter>)
  await waitFor(() => expect(screen.getByText('Ana')).toBeTruthy())
  fireEvent.click(screen.getByText('Ana'))
  await waitFor(() => expect(screen.getByText('400 NIM')).toBeTruthy())
  expect(screen.queryByText('Download CSV')).toBeNull()
  expect(screen.queryByText('Download JSON')).toBeNull()
})
