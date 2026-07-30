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
