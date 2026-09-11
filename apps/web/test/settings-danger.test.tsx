import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup } from '@testing-library/react'

const logout = vi.fn()
vi.mock('../src/AppContext', () => ({
  useApp: () => ({ api: {}, wallet: {}, token: 'tok', address: 'NQ07 TEST',
    login: async () => ({ token: 'tok', address: 'NQ07 TEST' }), logout }),
  useAppOptional: () => ({ api: {}, wallet: {}, token: 'tok', address: 'NQ07 TEST',
    login: async () => ({ token: 'tok', address: 'NQ07 TEST' }), logout }),
  AppProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

const { Settings } = await import('../src/screens/Settings')

afterEach(() => { cleanup(); logout.mockClear() })

const me = { walletAddress: 'NQ1', displayName: null, cashierLocked: false, cashierPinSet: false,
  businessName: null, businessAddress: null, taxId: null }

async function renderSettings() {
  const api = { getMe: vi.fn(async () => me), getApiKeys: vi.fn(async () => []) }
  render(<MemoryRouter><Settings api={api as never} /></MemoryRouter>)
  await waitFor(() => expect(api.getMe).toHaveBeenCalled())
}

// R17: disconnecting is not undoable from inside the app, so a single stray
// tap in the danger zone must not do it.
it('Disconnect signs out only on the second tap', async () => {
  await renderSettings()
  expect(screen.getByRole('heading', { name: 'Danger zone' })).toBeTruthy()

  const button = screen.getByRole('button', { name: 'Disconnect' })
  expect(button.className).toContain('danger')
  fireEvent.click(button)
  expect(logout).not.toHaveBeenCalled()

  const armed = await screen.findByRole('button', { name: /Tap again to disconnect/i })
  fireEvent.click(armed)
  expect(logout).toHaveBeenCalledTimes(1)
})
