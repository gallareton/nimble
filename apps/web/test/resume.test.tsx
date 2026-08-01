import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, expect, it, vi } from 'vitest'
import { Pay, ACTIVE_PAY_KEY } from '../src/screens/Pay'
import { Settings } from '../src/screens/Settings'
import { Home } from '../src/screens/Home'
import { AppProvider } from '../src/AppContext'

afterEach(() => sessionStorage.clear())

const future = () => new Date(Date.now() + 90_000).toISOString()

it('Pay restores an active code from sessionStorage after a reload', async () => {
  sessionStorage.setItem(ACTIVE_PAY_KEY,
    JSON.stringify({ sessionId: 's1', code: '482731', expiresAt: future() }))
  const api = {
    getSession: vi.fn(async () => ({ sessionId: 's1', status: 'AVAILABLE' })),
    createSession: vi.fn(),
    openEvents: vi.fn(async () => () => {}),
  }
  render(<MemoryRouter><Pay api={api as never} /></MemoryRouter>)
  await waitFor(() => expect(screen.getByText('482 731')).toBeTruthy())
  expect(api.openEvents).toHaveBeenCalledWith('s1', expect.any(Function))
})

it('Pay drops a dead stored session and auto-generates a fresh code', async () => {
  sessionStorage.setItem(ACTIVE_PAY_KEY,
    JSON.stringify({ sessionId: 's1', code: '482731', expiresAt: future() }))
  const api = {
    getSession: vi.fn(async () => ({ sessionId: 's1', status: 'EXPIRED' })),
    createSession: vi.fn(async () => ({ sessionId: 's2', code: '111222', expiresAt: future() })),
    openEvents: vi.fn(async () => () => {}),
  }
  render(<MemoryRouter><Pay api={api as never} /></MemoryRouter>)
  await waitFor(() => expect(screen.getByText('111 222')).toBeTruthy())
  expect(JSON.parse(sessionStorage.getItem(ACTIVE_PAY_KEY)!).sessionId).toBe('s2')
})

it('Pay auto-generates a code on entry with no stored session', async () => {
  const api = {
    createSession: vi.fn(async () => ({ sessionId: 's3', code: '333444', expiresAt: future() })),
    openEvents: vi.fn(async () => () => {}),
  }
  render(<MemoryRouter><Pay api={api as never} /></MemoryRouter>)
  await waitFor(() => expect(screen.getByText('333 444')).toBeTruthy())
  expect(api.createSession).toHaveBeenCalledOnce()
})

it('Settings pre-fills the saved display name', async () => {
  const api = {
    getMe: vi.fn(async () => ({ walletAddress: 'NQ07 TEST', displayName: 'Gall' })),
    updateMe: vi.fn(async () => ({ ok: true })),
  }
  render(<MemoryRouter><Settings api={api as never} /></MemoryRouter>)
  await waitFor(() => expect((screen.getByLabelText(/display name/i) as HTMLInputElement).value).toBe('Gall'))
})

it('Home shows the browser landing when not inside Nimiq Pay', () => {
  render(<MemoryRouter><AppProvider><Home /></AppProvider></MemoryRouter>)
  expect(screen.getByRole('link', { name: /open in nimiq pay/i })
    .getAttribute('href')).toMatch(/^nimiqpay:\/\/miniapp/)
})

it('Pay clamps a skewed server expiry so the countdown starts at 2:00', async () => {
  const api = {
    createSession: vi.fn(async () => ({ sessionId: 's4', code: '555666',
      expiresAt: new Date(Date.now() + 127_000).toISOString() })),
    openEvents: vi.fn(async () => () => {}),
  }
  render(<MemoryRouter><Pay api={api as never} /></MemoryRouter>)
  await waitFor(() => expect(screen.getByText('555 666')).toBeTruthy())
  expect(screen.getByText('2:00')).toBeTruthy()
  const stored = JSON.parse(sessionStorage.getItem(ACTIVE_PAY_KEY)!)
  expect(new Date(stored.expiresAt).getTime()).toBeLessThanOrEqual(Date.now() + 120_000)
})

it('History reads filters from the URL and swaps a finalized row on poll', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  const { History } = await import('../src/screens/History')
  const pendingRow = { pending: true, sessionId: 's9', role: 'payer',
    snapshot: { amountNim: '2.5', reference: 'Soda' }, createdAt: new Date().toISOString() }
  const settledRow = { receiptId: 'r9', sessionId: 's9', role: 'payer',
    snapshot: { amountNim: '2.5', reference: 'Soda' }, createdAt: new Date().toISOString() }
  const calls: Array<Record<string, unknown> | undefined> = []
  let settled = false
  const api = {
    history: vi.fn(async (p?: Record<string, unknown>) => {
      calls.push(p)
      return { items: [settled ? settledRow : pendingRow], nextCursor: null }
    }),
  }
  render(
    <MemoryRouter initialEntries={['/history?q=Soda&role=payer&from=2026-07-01&to=2026-07-31']}>
      <AppProvider><History api={api as never} /></AppProvider>
    </MemoryRouter>,
  )
  await waitFor(() => expect(screen.getByText(/Paid — finalizing/)).toBeTruthy())
  expect(calls[0]).toMatchObject({ q: 'Soda', role: 'payer', from: '2026-07-01', to: '2026-07-31' })

  settled = true
  await vi.advanceTimersByTimeAsync(5100)
  await waitFor(() => expect(screen.queryByText(/Paid — finalizing/)).toBeNull())
  vi.useRealTimers()
})
