import { afterEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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
  const dialog = await screen.findByRole('dialog')
  fireEvent.click(within(dialog).getByRole('button', { name: 'Close the shift' }))
  await waitFor(() => expect(screen.getByText('Export')).toBeTruthy())
  fireEvent.click(screen.getByText('Export'))
  fireEvent.click(screen.getByText('Export CSV'))
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
  const dialog = await screen.findByRole('dialog')
  fireEvent.click(within(dialog).getByRole('button', { name: 'Close the shift' }))
  await waitFor(() => expect(screen.getByText('Export')).toBeTruthy())
  fireEvent.click(screen.getByText('Export'))
  fireEvent.click(screen.getByText('Export JSON'))
  await waitFor(() => expect(share).toHaveBeenCalledTimes(1))
  expect(screen.queryByRole('textbox')).toBeNull()
  delete (navigator as unknown as { canShare?: unknown }).canShare
  delete (navigator as unknown as { share?: unknown }).share
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
  const dialog = await screen.findByRole('dialog')
  fireEvent.click(within(dialog).getByRole('button', { name: 'Close the shift' }))

  // The closed report and its export action stay reachable until the
  // vendor explicitly leaves — closing must not hide them immediately.
  await waitFor(() => expect(screen.getByText('Export')).toBeTruthy())
  expect(screen.getByText('500 NIM')).toBeTruthy()

  fireEvent.click(screen.getByText(/Back/i))
  await waitFor(() => expect(screen.getByText('Open a shift')).toBeTruthy())
  expect(screen.queryByText('Export')).toBeNull()
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
  const dialog = await screen.findByRole('dialog')
  expect(within(dialog).getByRole('alert')).toBeTruthy()
  expect(within(dialog).getByText(/2 bills are still unpaid/i)).toBeTruthy()
  // Opening the panel warns and must NOT have closed anything.
  expect(api.closeShift).not.toHaveBeenCalled()
  // "Keep it open" is the way out — the old "Close it anyway" idiom is gone.
  expect(within(dialog).getByRole('button', { name: 'Keep it open' })).toBeTruthy()
  expect(screen.queryByText('Close it anyway')).toBeNull()

  fireEvent.click(within(dialog).getByRole('button', { name: 'Close the shift' }))
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
  const dialog = await screen.findByRole('dialog')
  expect(within(dialog).queryByRole('alert')).toBeNull()
  expect(api.closeShift).not.toHaveBeenCalled()

  fireEvent.click(within(dialog).getByRole('button', { name: 'Close the shift' }))
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
  // The lock badge lives in AppShell's header now (nav.test); the screen's own
  // evidence of the lock is what it hides below.

  expect(screen.queryByRole('link', { name: 'Refund' })).toBeNull()
  expect(screen.queryByText('Close the shift')).toBeNull()
  // R16: remote billing lives on Charge step 1 and product management on
  // More/Settings — neither is a link on the Shift screen any more.
  expect(screen.queryByText('Bill someone who isn\'t here')).toBeNull()
  expect(screen.queryByText('Manage products')).toBeNull()
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
})

// --- Task 4: sold-by-product and NIM/cash split -------------------------

it('shows the sold-by-product and NIM/cash split sections when the report carries them', async () => {
  const report = {
    shift: { id: 's1', operatorLabel: 'Ana', openedAt: '2026-09-08T08:00:00.000Z', closedAt: null },
    totals: { count: 2, confirmed: 1, refunded: 0, failed: 0, grossNim: '10', grossFiatMinor: 500,
      fiatCurrency: 'USD', averageTicketNim: '10', cashSales: 1,
      byPaymentMethod: { nim: { count: 1, fiatMinor: 250 }, cash: { count: 1, fiatMinor: 250 } } },
    entries: [],
    cashEntries: [{ saleId: 'c1', occurredAt: '2026-09-08T09:00:00.000Z', amountFiatMinor: 250, reference: 'Soda', amountNim: '62.5' }],
    byProduct: [{ name: 'Coffee', quantity: 2, totalMinor: 500 }],
    fiatIncomplete: false,
  }
  const api = {
    getCurrentShift: vi.fn(async () => ({ id: 's1', operatorLabel: 'Ana', openedAt: '2026-09-08T08:00:00.000Z', closedAt: null })),
    getShiftReport: vi.fn(async () => report),
  }
  render(<MemoryRouter><Shift api={api as never} /></MemoryRouter>)
  await waitFor(() => expect(screen.getByText('Sold by product')).toBeTruthy())
  const product = screen.getByText('Coffee × 2')
  expect(product.className).toBe('row__title')
  // R12: the name and the amount are two elements, never one run of text.
  // "Coffee × 25.00" was what the audit actually saw on the device.
  expect(screen.queryByText('Coffee × 25.00')).toBeNull()
  // Q2: the amount names its currency — "5.00" alone read as pieces or NIM.
  expect(product.closest('.row')!.querySelector('.row__amt')!.textContent).toBe('5.00 USD')
  expect(screen.getByText('By payment method')).toBeTruthy()
  expect(screen.getByText('Soda').className).toBe('row__title')
  // A cash entry shows fiat only — cash corresponds to no NIM sent.
  expect(screen.getByText('Soda').closest('.row')!.querySelector('.price-nim')).toBeNull()
  // No emoji stands in for a payment method.
  expect(screen.queryByText(/🪙/)).toBeNull()
})

it('renders the shift report with neither new section when byProduct/byPaymentMethod are absent (older report shape)', async () => {
  const report = {
    shift: { id: 's1', operatorLabel: 'Ana', openedAt: '2026-08-27T08:00:00.000Z', closedAt: null },
    totals: { count: 2, confirmed: 2, failed: 0, grossNim: '500', grossFiatMinor: 1234,
      fiatCurrency: 'USD', averageTicketNim: '250' },
    entries: [], fiatIncomplete: false,
  }
  const api = {
    getCurrentShift: vi.fn(async () => ({ id: 's1', operatorLabel: 'Ana', openedAt: '2026-08-27T08:00:00.000Z', closedAt: null })),
    getShiftReport: vi.fn(async () => report),
  }
  render(<MemoryRouter><Shift api={api as never} /></MemoryRouter>)
  await waitFor(() => expect(screen.getByText('500 NIM')).toBeTruthy())
  expect(screen.queryByText('Sold by product')).toBeNull()
  expect(screen.queryByText('By payment method')).toBeNull()
})

// Ruling Q1/Q2 (audit round 2, image20–27): a shift whose only takings were
// two cash sales of 17.50 was headlined "0 NIM · 0 sales" over an empty
// state, with 35.00 USD printed underneath it.
const cashOnlyReport = {
  shift: { id: 's1', operatorLabel: 'Jonek', openedAt: '2026-09-11T08:00:00.000Z', closedAt: null },
  totals: {
    count: 0, confirmed: 0, failed: 0, refunded: 0,
    grossNim: '0', grossFiatMinor: 3500, fiatCurrency: 'USD', averageTicketNim: null,
    cashSales: 2,
    byPaymentMethod: { nim: { count: 0, fiatMinor: 0 }, cash: { count: 2, fiatMinor: 3500 } },
  },
  entries: [],
  cashEntries: [],
  byProduct: [{ name: 'Soda', quantity: 7, totalMinor: 3500 }],
  fiatIncomplete: false,
}
const cashOnlyApi = () => ({
  getCurrentShift: vi.fn(async () => ({ id: 's1', operatorLabel: 'Jonek',
    openedAt: '2026-09-11T08:00:00.000Z', closedAt: null })),
  getShiftReport: vi.fn(async () => cashOnlyReport),
  getOutstandingBills: vi.fn(async () => ({ bills: [] })),
  closeShift: vi.fn(async () => cashOnlyReport),
})

it('counts cash in the takings: a cash-only shift headlines the fiat gross and its sale count, never an empty state', async () => {
  render(<MemoryRouter><Shift api={cashOnlyApi() as never} /></MemoryRouter>)
  await waitFor(() => expect(screen.getByText('Jonek')).toBeTruthy())

  const headline = screen.getAllByText('35.00 USD').find(e => e.className === 'amt')
  expect(headline).toBeTruthy()
  expect(screen.getByText(/0 NIM/).closest('p')!.textContent).toBe('0 NIM · 35.00 USD cash · 2 sales')
  expect(screen.queryByText(/No sales yet/)).toBeNull()

  // Q2: a bare "35.00" beside "Soda × 7" reads as pieces or NIM.
  const product = screen.getByText('Soda × 7').closest('li')!
  expect(within(product).getByText('35.00 USD')).toBeTruthy()
  // Q2: the split counts transactions, not items.
  expect(screen.getByText('2 transactions')).toBeTruthy()
})

it('repeats the full takings — and the cash to settle — in the close-shift dialog', async () => {
  render(<MemoryRouter><Shift api={cashOnlyApi() as never} /></MemoryRouter>)
  await waitFor(() => expect(screen.getByText('Jonek')).toBeTruthy())
  fireEvent.click(screen.getByRole('button', { name: 'Close the shift' }))

  const dialog = await screen.findByRole('dialog')
  expect(within(dialog).getByText('35.00 USD').className).toBe('amt')
  expect(within(dialog).getByText(/Cash to settle/).textContent).toBe('Cash to settle: 35.00 USD')
  expect(within(dialog).getByText(/0 NIM/).closest('p')!.textContent).toBe('0 NIM · 35.00 USD cash · 2 sales')
})

it('will not let the shift be closed on a summary it has not loaded yet', async () => {
  const api = {
    getCurrentShift: vi.fn(async () => ({ id: 's1', operatorLabel: 'Jonek',
      openedAt: '2026-09-11T08:00:00.000Z', closedAt: null })),
    // Never resolves: the report is still in flight when the vendor taps.
    getShiftReport: vi.fn(() => new Promise(() => {})),
    getOutstandingBills: vi.fn(async () => ({ bills: [] })),
  }
  render(<MemoryRouter><Shift api={api as never} /></MemoryRouter>)
  await waitFor(() => expect(screen.getByText('Jonek')).toBeTruthy())
  fireEvent.click(screen.getByRole('button', { name: 'Close the shift' }))

  const dialog = await screen.findByRole('dialog')
  const confirm = within(dialog).getByRole('button', { name: 'Close the shift' }) as HTMLButtonElement
  expect(confirm.disabled).toBe(true)
})
