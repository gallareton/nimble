import { cleanup, render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DashboardView } from '@nimble/shared'
import { Dashboard } from '../src/screens/Dashboard'

afterEach(() => cleanup())

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10)
}
function yesterdayUtc(): string {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() - 1)
  return d.toISOString().slice(0, 10)
}

const baseView: DashboardView = {
  day: todayUtc(),
  grossFiatMinor: 750,
  grossNim: '12.5',
  salesCount: 3,
  refundsCount: 0,
  refundedNim: '0',
  byPaymentMethod: { nim: { count: 2, fiatMinor: 500 }, cash: { count: 1, fiatMinor: 250 } },
  byOperator: [{ operatorLabel: 'Alice', salesCount: 3, grossFiatMinor: 750, grossNim: '12.5' }],
  topProducts: [{ name: 'Soda', quantity: 4, totalMinor: 400 }],
  openShift: { id: 'sh1', operatorLabel: 'Alice', openedAt: new Date().toISOString() },
  awaiting: [],
  outstandingBills: 0,
}

const emptyView: DashboardView = {
  day: todayUtc(),
  grossFiatMinor: 0,
  grossNim: '0',
  salesCount: 0,
  refundsCount: 0,
  refundedNim: '0',
  byPaymentMethod: { nim: { count: 0, fiatMinor: 0 }, cash: { count: 0, fiatMinor: 0 } },
  byOperator: [],
  topProducts: [],
  openShift: null,
  awaiting: [],
  outstandingBills: 0,
}

function renderDashboard(getDashboard: (day?: string) => Promise<DashboardView>) {
  const api = { getDashboard: vi.fn(getDashboard) }
  render(
    <MemoryRouter initialEntries={['/dashboard']}>
      <Routes>
        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
        <Route path="/dashboard" element={<Dashboard api={api as any} />} />
        <Route path="/session/:id" element={<main><p>Session screen</p></main>} />
      </Routes>
    </MemoryRouter>,
  )
  return api
}

describe('Dashboard', () => {
  it('renders tile numbers from the fixture', async () => {
    renderDashboard(async () => baseView)
    await screen.findByText('7.50')
    expect(screen.getByText(/12\.5 NIM · 3 sales/)).toBeTruthy()
  })

  it('shows an empty state, not zeros, for a day with nothing recorded', async () => {
    renderDashboard(async () => emptyView)
    await waitFor(() => expect(screen.getByText(/nothing/i)).toBeTruthy())
    expect(screen.queryByText('0.00')).toBeNull()
  })

  it('renders an awaiting entry as a link to its session', async () => {
    const view: DashboardView = {
      ...baseView,
      awaiting: [{ saleId: 'sa1', totalMinor: 300, createdAt: new Date().toISOString(), sessionId: 's99' }],
    }
    renderDashboard(async () => view)
    const link = await screen.findByRole('link', { name: /3\.00/ })
    expect(link.getAttribute('href')).toBe('/session/s99')
  })

  it('disables "›" for today and "‹" fetches yesterday', async () => {
    const api = renderDashboard(async () => baseView)
    await screen.findByText('7.50')

    const next = screen.getByRole('button', { name: /›/ }) as HTMLButtonElement
    expect(next.disabled).toBe(true)

    const prev = screen.getByRole('button', { name: /‹/ })
    fireEvent.click(prev)

    await waitFor(() => expect(api.getDashboard).toHaveBeenLastCalledWith(yesterdayUtc()))
  })
})
