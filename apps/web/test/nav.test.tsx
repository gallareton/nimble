import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'
import { AppShell } from '../src/components/AppShell'
import { AppProvider } from '../src/AppContext'

// Same trick test/screens.test.tsx and test/network.test.ts use: Nimiq Pay
// seeds window.nimiqPay before the page script runs, so flipping it here is
// how a test tells inNimiqPay() which branch to exercise.
function enterNimiqPay() {
  ;(window as never as { nimiqPay: object }).nimiqPay = {}
}
function leaveNimiqPay() {
  delete (window as never as { nimiqPay?: object }).nimiqPay
}

// AppShell only cares about the URL and where things live in its own parent
// map — it doesn't need the real screens (which would each reach for a real
// Api over the network) to prove the chrome behaves right. Plain stubs at
// the same paths App.tsx uses are enough.
function renderShell(initialEntries: string[]) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <AppProvider>
        <Routes>
          <Route element={<AppShell />}>
            <Route path="/" element={<main><p>Home screen</p></main>} />
            <Route path="/pay" element={<main><p>Pay screen</p></main>} />
            <Route path="/charge" element={<main><p>Charge screen</p></main>} />
            <Route path="/shift" element={<main><p>Shift screen</p></main>} />
            <Route path="/history" element={<main><p>History screen</p></main>} />
            <Route path="/products" element={<main><p>Products screen</p></main>} />
            <Route path="/settings" element={<main><p>Settings screen</p></main>} />
            <Route path="/session/:id" element={<main><p>Session screen</p></main>} />
            <Route path="/r/:id" element={<main><p>Remote screen</p></main>} />
          </Route>
        </Routes>
      </AppProvider>
    </MemoryRouter>,
  )
}

afterEach(() => {
  cleanup()
  leaveNimiqPay()
})

describe('AppShell', () => {
  it('shows the bottom bar on /, /charge, /shift and /history', () => {
    enterNimiqPay()
    for (const path of ['/', '/charge', '/shift', '/history']) {
      renderShell([path])
      expect(screen.getByRole('navigation', { name: 'Main' })).toBeTruthy()
      cleanup()
    }
  })

  it('marks the active tab with aria-current on each of its routes', () => {
    enterNimiqPay()
    for (const [path, label] of [['/charge', 'Till'], ['/shift', 'Shift'], ['/history', 'History']] as const) {
      renderShell([path])
      const nav = screen.getByRole('navigation', { name: 'Main' })
      const { getByText } = within(nav)
      expect(getByText(label).closest('a')?.getAttribute('aria-current')).toBe('page')
      cleanup()
    }
  })

  it('hides the bottom bar on a payment-flow screen but keeps the header back button', () => {
    enterNimiqPay()
    renderShell(['/session/s1'])
    expect(screen.queryByRole('navigation', { name: 'Main' })).toBeNull()
    expect(screen.getByRole('link', { name: 'Back' })).toBeTruthy()
    cleanup()

    renderShell(['/r/rc1'])
    expect(screen.queryByRole('navigation', { name: 'Main' })).toBeNull()
    expect(screen.getByRole('link', { name: 'Back' })).toBeTruthy()
  })

  it('"‹" from /products leads to /shift, its parent in the map — not /', () => {
    enterNimiqPay()
    renderShell(['/products'])
    const back = screen.getByRole('link', { name: 'Back' })
    expect(back.getAttribute('href')).toBe('/shift')
  })

  it('"More" opens a sheet with Products and Settings, and Escape closes it', () => {
    enterNimiqPay()
    renderShell(['/'])
    fireEvent.click(screen.getByRole('button', { name: 'More' }))
    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Products' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Settings' })).toBeTruthy()

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('renders no bar or header outside Nimiq Pay', () => {
    renderShell(['/'])
    expect(screen.queryByRole('navigation', { name: 'Main' })).toBeNull()
    expect(screen.getByText('Home screen')).toBeTruthy()
  })
})
