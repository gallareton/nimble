import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { Shift } from '../src/screens/Shift'

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
