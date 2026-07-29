import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, expect, it, vi } from 'vitest'
import { Pay, ACTIVE_PAY_KEY } from '../src/screens/Pay'
import { Settings } from '../src/screens/Settings'

afterEach(() => sessionStorage.clear())

const future = () => new Date(Date.now() + 90_000).toISOString()

it('Pay restores an active code from sessionStorage after a reload', async () => {
  sessionStorage.setItem(ACTIVE_PAY_KEY,
    JSON.stringify({ sessionId: 's1', code: '482731', expiresAt: future() }))
  const api = {
    getSession: vi.fn(async () => ({ sessionId: 's1', status: 'AVAILABLE' })),
    openEvents: vi.fn(async () => () => {}),
  }
  render(<MemoryRouter><Pay api={api as never} /></MemoryRouter>)
  await waitFor(() => expect(screen.getByText('482 731')).toBeTruthy())
  expect(api.openEvents).toHaveBeenCalledWith('s1', expect.any(Function))
})

it('Pay drops a stored session the server no longer reports as AVAILABLE', async () => {
  sessionStorage.setItem(ACTIVE_PAY_KEY,
    JSON.stringify({ sessionId: 's1', code: '482731', expiresAt: future() }))
  const api = {
    getSession: vi.fn(async () => ({ sessionId: 's1', status: 'EXPIRED' })),
    openEvents: vi.fn(async () => () => {}),
  }
  render(<MemoryRouter><Pay api={api as never} /></MemoryRouter>)
  await waitFor(() => expect(screen.getByRole('button', { name: /generate code/i })).toBeTruthy())
  expect(sessionStorage.getItem(ACTIVE_PAY_KEY)).toBeNull()
})

it('Settings pre-fills the saved display name', async () => {
  const api = {
    getMe: vi.fn(async () => ({ walletAddress: 'NQ07 TEST', displayName: 'Gall' })),
    updateMe: vi.fn(async () => ({ ok: true })),
  }
  render(<MemoryRouter><Settings api={api as never} /></MemoryRouter>)
  await waitFor(() => expect((screen.getByLabelText(/display name/i) as HTMLInputElement).value).toBe('Gall'))
})
