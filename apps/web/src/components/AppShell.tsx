import { useEffect, useState } from 'react'
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useApp } from '../AppContext'
import { CashierLockBadge } from './CashierLockBadge'
import { inNimiqPay } from '../lib/host'
import { t } from '../i18n'

// One navigation source for the whole app (owner report, 2026-09-10: "different
// buttons on different screens lead to different places"). Every screen used to
// own its own header/footer and its own idea of "back" — this component is the
// only place that decides both, from now on.

// Route → parent-in-the-map, never "wherever you came from". `/` has no
// entry — the header shows no "‹" there. Kept as one object, in one place,
// per the plan (never scattered back into individual screens again).
const PARENTS: Array<[RegExp, string]> = [
  [/^\/dashboard/, '/'],
  [/^\/charge\/remote/, '/charge'],
  [/^\/products/, '/settings'],
  [/^\/refund\//, '/shift'],
  [/^\/receipt\//, '/history'],
  [/^\/settings/, '/'],
  [/^\/guide/, '/'],
  [/^\/history\/shifts\//, '/history'],
  [/^\/history/, '/'],
  [/^\/session\//, '/'],
  [/^\/r\//, '/'],
  [/^\/pay/, '/'],
  [/^\/charge/, '/'],
  [/^\/shift/, '/'],
]

function parentOf(pathname: string): string | null {
  if (pathname === '/') return null
  for (const [re, parent] of PARENTS) if (re.test(pathname)) return parent
  return '/'
}

// Only the screens that used to render their own `top-bar` (a title next to
// a back link) get a title from here — the rest already render a title of
// their own in the content (Home's brand mark, Shift/Settings' plain <h1>,
// Approval's role-dependent one) and this would only double it up.
const TITLES: Array<[RegExp, string]> = [
  [/^\/dashboard/, 'Dashboard'],
  [/^\/pay/, 'Pay'],
  [/^\/charge\/remote/, 'Remote bill'],
  [/^\/charge/, 'Charge'],
  [/^\/products/, 'Products'],
  [/^\/guide/, 'How it works'],
  [/^\/history\/shifts\//, 'Shift report'],
  [/^\/history/, 'History'],
  [/^\/refund\//, 'Refund'],
]

function titleFor(pathname: string): string | null {
  for (const [re, key] of TITLES) if (re.test(pathname)) return t(key)
  return null
}

// A stray tap must never pull a cashier out of a payment in progress, so the
// bottom bar disappears on these — the header (with its own "‹") is all
// that's left. `/pay` deliberately keeps the bar even with a live code on
// screen: the code expires on its own in two minutes and nothing on that
// screen is destructive, unlike leaving mid-approval or mid-refund.
function hidesBar(pathname: string): boolean {
  return /^\/session\//.test(pathname)
    || /^\/r\//.test(pathname)
    || /^\/receipt\//.test(pathname)
    || /^\/refund\//.test(pathname)
}

interface Tab { to: string; label: string; icon: string }
const TABS: Tab[] = [
  { to: '/', label: 'Home', icon: '⌂' },
  { to: '/pay', label: 'Pay', icon: '↗' },
  { to: '/charge', label: 'Charge', icon: '⊞' },
  { to: '/shift', label: 'Shift', icon: '≡' },
  { to: '/history', label: 'History', icon: '⟲' },
]

interface MoreItem { to: string; label: string }
const MORE_ITEMS: MoreItem[] = [
  { to: '/dashboard', label: 'Dashboard' },
  { to: '/products', label: 'Products' },
  { to: '/guide', label: 'How it works' },
  { to: '/settings', label: 'Settings' },
]

// R9: the bottom bar must get out of the way of the on-screen keyboard —
// a cashier typing an amount should see the field, not six tabs under it.
// Two independent signals, because neither is reliable alone: a text field
// taking focus on a touch device, and the visual viewport shrinking. Both
// are guarded for the test environment, which has neither API in full.
const NON_TEXT_INPUT_TYPES = ['checkbox', 'radio', 'button', 'submit', 'range', 'file']

function isTextField(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  if (!el || !el.tagName) return false
  if (el.tagName === 'TEXTAREA') return true
  if (el.tagName !== 'INPUT') return false
  return !NON_TEXT_INPUT_TYPES.includes((el as HTMLInputElement).type)
}

function useKeyboardOpen(): boolean {
  const [textFieldFocused, setTextFieldFocused] = useState(false)
  const [viewportShrunk, setViewportShrunk] = useState(false)

  useEffect(() => {
    const onFocusIn = (e: FocusEvent) => { if (isTextField(e.target)) setTextFieldFocused(true) }
    const onFocusOut = (e: FocusEvent) => { if (isTextField(e.target)) setTextFieldFocused(false) }
    document.addEventListener('focusin', onFocusIn)
    document.addEventListener('focusout', onFocusOut)
    return () => {
      document.removeEventListener('focusin', onFocusIn)
      document.removeEventListener('focusout', onFocusOut)
    }
  }, [])

  useEffect(() => {
    const vv = typeof window === 'undefined' ? undefined : window.visualViewport
    if (!vv) return
    const read = () => {
      const h = vv.height
      setViewportShrunk(h > 0 && h < window.innerHeight * 0.8)
    }
    read()
    vv.addEventListener('resize', read)
    return () => vv.removeEventListener('resize', read)
  }, [])

  const coarse = typeof window === 'undefined'
    ? false
    : window.matchMedia?.('(pointer: coarse)')?.matches ?? false

  return (textFieldFocused && coarse) || viewportShrunk
}

export function AppShell() {
  const location = useLocation()
  const navigate = useNavigate()
  const { api, token, wallet } = useApp()
  const [moreOpen, setMoreOpen] = useState(false)
  const [locked, setLocked] = useState(false)
  const keyboardOpen = useKeyboardOpen()

  const pathname = location.pathname

  useEffect(() => setMoreOpen(false), [pathname])

  useEffect(() => {
    if (!moreOpen) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMoreOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [moreOpen])

  // Cashier lock badge (spec §6): display-only, same fetch Shift/Settings
  // already do on their own — this just makes it visible from any screen,
  // not only the two that happen to show it in their content.
  useEffect(() => {
    if (!token) { setLocked(false); return }
    let cancelled = false
    void api.getMe?.().then(me => { if (!cancelled) setLocked(me.cashierLocked) }).catch(() => {})
    return () => { cancelled = true }
  }, [api, token])

  if (!inNimiqPay()) return <Outlet />

  const parent = parentOf(pathname)
  const title = titleFor(pathname)
  const showBar = !hidesBar(pathname)
  const barVisible = showBar && !keyboardOpen

  return (
    <div className={barVisible ? 'app-shell' : 'app-shell app-shell--no-bar tabbar-hidden'}>
      {(parent !== null || title !== null || locked) && (
        <header className="app-header">
          {parent !== null && (
            <Link to={parent} className="app-header__back" aria-label={t('Back')}>‹</Link>
          )}
          {title !== null && <h1 className="app-header__title">{title}</h1>}
          {locked && <CashierLockBadge locked={locked} />}
        </header>
      )}

      <div className={showBar ? 'app-shell__content app-shell__content--with-bar' : 'app-shell__content'}>
        <Outlet />
      </div>

      {barVisible && (
        <nav className="app-tabbar" aria-label="Main">
          {TABS.map(tab => {
            const active = pathname === tab.to
            return (
              <Link key={tab.to} to={tab.to} className="app-tabbar__item"
                aria-current={active ? 'page' : undefined}>
                <span className="app-tabbar__icon" aria-hidden>{tab.icon}</span>
                <span>{t(tab.label)}</span>
              </Link>
            )
          })}
          <button type="button" className="app-tabbar__item app-tabbar__item--button"
            aria-haspopup="dialog" aria-expanded={moreOpen} onClick={() => setMoreOpen(o => !o)}>
            <span className="app-tabbar__icon" aria-hidden>⋯</span>
            <span>{t('More')}</span>
          </button>
        </nav>
      )}

      {moreOpen && (
        <div className="app-sheet-backdrop" onClick={() => setMoreOpen(false)}>
          <section className="app-sheet" role="dialog" aria-label={t('More')}
            onClick={e => e.stopPropagation()}>
            <ul className="app-sheet__list">
              {MORE_ITEMS.map(item => (
                <li key={item.to}>
                  <button type="button" onClick={() => { setMoreOpen(false); navigate(item.to) }}>
                    {t(item.label)}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        </div>
      )}
    </div>
  )
}
