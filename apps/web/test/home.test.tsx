import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Guide } from '../src/screens/Guide'
import { Pay } from '../src/screens/Pay'

// Home reads its api/token straight off the context; a stub provider is
// cheaper than wiring a real wallet login just to see the two cards.
const stub = vi.hoisted(() => ({
  api: {
    history: vi.fn(async () => ({ items: [], nextCursor: null })),
    getNetwork: vi.fn(async () => ({ network: 'Testnet', height: null })),
  },
}))
vi.mock('../src/AppContext', () => ({
  useApp: () => ({ api: stub.api, wallet: {}, token: 'tok', address: 'NQ07 TEST',
    login: async () => ({ token: 'tok', address: 'NQ07 TEST' }), logout: () => {} }),
  useAppOptional: () => null,
  AppProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

afterEach(() => { cleanup(); localStorage.clear(); sessionStorage.clear() })

async function renderHome() {
  // The first-run card hides the rest of the screen; these tests are about
  // the returning-user home.
  localStorage.setItem('nimble.intro.seen', '1')
  const { Home } = await import('../src/screens/Home')
  return render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route path="/" element={<Home />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('Home', () => {
  it('offers a symmetric Pay/Charge pair with role captions', async () => {
    await renderHome()
    const pay = screen.getByRole('button', { name: /^pay$/i })
    const charge = screen.getByRole('button', { name: /charge/i })
    expect(within(pay).getByText('Pay someone')).toBeTruthy()
    expect(within(charge).getByText('Take a payment')).toBeTruthy()
    expect(charge.className).toContain('home-actions__charge')
  })

  it('heads the Recent section with a link to the dashboard', async () => {
    await renderHome()
    await waitFor(() => expect(stub.api.history).toHaveBeenCalled())
    const link = screen.getByRole('link', { name: /today's numbers/i })
    expect(link.getAttribute('href')).toBe('/dashboard')
    expect(screen.getByRole('heading', { name: 'Recent' })).toBeTruthy()
  })

  it('replaces the HOW IT WORKS list with a single row linking to the guide', async () => {
    await renderHome()
    const row = screen.getByRole('link', { name: /how does nimble work\?/i })
    expect(row.getAttribute('href')).toBe('/guide')
    expect(row.className).toContain('row--link')
    expect(screen.queryByRole('heading', { name: 'How it works' })).toBeNull()
  })
})

describe('Guide', () => {
  it('renders the three steps with no "Got it" button', () => {
    render(<MemoryRouter><Guide /></MemoryRouter>)
    expect(screen.getByText('The person paying shows a code.')).toBeTruthy()
    expect(screen.getByText('The person getting paid types it in.')).toBeTruthy()
    expect(screen.getByText('The payer approves in the wallet.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /got it/i })).toBeNull()
  })
})

describe('Pay ring', () => {
  async function renderPayExpiringIn(ms: number) {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const api = {
      createSession: vi.fn(async () => ({ sessionId: 's1', code: '123456',
        expiresAt: new Date(Date.now() + ms).toISOString() })),
      openEvents: vi.fn(async () => () => {}),
    }
    const { container } = render(<MemoryRouter><Pay api={api as never} /></MemoryRouter>)
    await waitFor(() => expect(container.querySelector('[data-testid="code"]')).toBeTruthy())
    await vi.advanceTimersByTimeAsync(1100)
    const ring = container.querySelector('.code-ring') as HTMLElement
    const className = ring.className
    vi.useRealTimers()
    return className
  }

  it('turns amber under 30 seconds left', async () => {
    const className = await renderPayExpiringIn(25_000)
    expect(className).toContain('code-ring--warn')
    expect(className).not.toContain('code-ring--urgent')
  })

  it('turns red under 10 seconds left', async () => {
    const className = await renderPayExpiringIn(9_500)
    expect(className).toContain('code-ring--urgent')
  })
})

describe('Home RECENT cash rows', () => {
  it('lists a paid cash sale with its fiat amount and no receipt link', async () => {
    stub.api.history.mockResolvedValueOnce({
      items: [{ kind: 'cash', saleId: 'sale-9', role: 'receiver',
        snapshot: { amountFiatMinor: 1500, fiatCurrency: 'USD',
          reference: 'Soda × 2', paymentMethod: 'cash' },
        createdAt: '2026-09-10T10:00:00.000Z' }],
      nextCursor: null,
    } as never)
    await renderHome()
    const label = await screen.findByText(/Cash · Soda × 2/)
    expect(label.closest('a')).toBeNull()
    expect(within(label.closest('li')!).getByText('15.00 USD')).toBeTruthy()
    expect(label.closest('li')!.querySelector('.price-nim')).toBeNull()
  })

  it('shows the NIM value frozen at the sale under the fiat amount (P5)', async () => {
    stub.api.history.mockResolvedValueOnce({
      items: [{ kind: 'cash', saleId: 'sale-10', role: 'receiver',
        snapshot: { amountFiatMinor: 1500, fiatCurrency: 'USD', reference: 'Tea',
          paymentMethod: 'cash', fxRate: '0.004', amountNim: '375.5' },
        createdAt: '2026-09-10T10:00:00.000Z' }],
      nextCursor: null,
    } as never)
    await renderHome()
    const row = (await screen.findByText(/Cash · Tea/)).closest('li')!
    expect(within(row).getByText('15.00 USD')).toBeTruthy()
    expect(row.querySelector('.price-nim')!.textContent).toBe('≈ 375.50 NIM')
  })
})
