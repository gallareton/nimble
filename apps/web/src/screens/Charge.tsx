import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { nimToLuna, SUPPORTED_FIAT_CURRENCY } from '@nimble/shared'
import type { ProductView } from '@nimble/shared'
import { useAppOptional } from '../AppContext'
import type { Api } from '../api/client'
import { ApiError } from '../api/client'
import { t } from '../i18n'
import { formatUsd, useUsdRate } from '../lib/fiat'
import { useOnline } from '../lib/online'

type Unit = 'USD' | 'NIM'
const UNIT_KEY = 'nimble.charge.unit'

function loadUnit(): Unit {
  try { return localStorage.getItem(UNIT_KEY) === 'NIM' ? 'NIM' : 'USD' } catch { return 'USD' }
}

function saveUnit(unit: Unit) {
  try { localStorage.setItem(UNIT_KEY, unit) } catch { /* private mode */ }
}

/** '12.34' → 1234. Rejects more than two decimals rather than rounding money
 *  behind the cashier's back. */
export function toMinorUnits(input: string): number | null {
  // Bounded to 9 major-unit digits — a till will never exceed $999,999,999,
  // and it keeps the intermediate well clear of 2^53.
  const m = /^(\d{1,9})(?:[.,](\d{1,2}))?$/.exec(input.trim())
  if (!m) return null
  const minor = Number(m[1]) * 100 + Number((m[2] ?? '0').padEnd(2, '0'))
  return minor > 0 ? minor : null
}

interface CartItem {
  productId: string | null
  name: string
  unitPriceMinor: number
  quantity: number
}

function formatMinor(minor: number): string {
  return (minor / 100).toFixed(2)
}

// BLIK-style: the receiver fills in what they are asking for FIRST; the code
// is the last thing entered, and the payer gets the approval prompt the
// moment it is submitted — no second data-entry step on this side. The
// cashier prices the sale in fiat; the server converts and freezes the quote.
export function Charge(props: { api?: Api }) {
  const ctx = useAppOptional()
  const api = props.api ?? ctx?.api
  if (!api) throw new Error('Charge needs api via props or AppProvider')
  const navigate = useNavigate()
  const [unit, setUnit] = useState<Unit>(loadUnit)
  const [amount, setAmount] = useState('')
  const [reference, setReference] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const usdRate = useUsdRate(api)
  const [online, recheckOnline] = useOnline(api)

  // Catalog layer (Task 4). `products` stays null until a catalog-aware
  // caller answers — a test double without getProducts (every pre-existing
  // test) leaves this screen exactly as it was, per the governing rule that
  // an owner with no catalog sees today's screen unchanged.
  const [products, setProducts] = useState<ProductView[] | null>(null)
  const [cart, setCart] = useState<CartItem[]>([])
  const [search, setSearch] = useState('')
  const [cartError, setCartError] = useState<string | null>(null)
  const [cartBusy, setCartBusy] = useState(false)
  const [cashMessage, setCashMessage] = useState<string | null>(null)
  // Set once "Take NIM" has minted a sale awaiting payment — the screen then
  // narrows to just the code field, same shape as the no-catalog flow's own
  // code step, but claiming by saleId instead of by amount.
  const [pendingSale, setPendingSale] = useState<{ saleId: string } | null>(null)

  useEffect(() => {
    const req = api.getProducts?.()
    if (!req) return
    let cancelled = false
    req.then(ps => { if (!cancelled) setProducts(ps) }).catch(() => { if (!cancelled) setProducts([]) })
    return () => { cancelled = true }
  }, [api])

  const activeProducts = (products ?? []).filter(p => p.active)
  const showCatalog = activeProducts.length > 0

  const chooseUnit = (next: Unit) => {
    setUnit(next)
    saveUnit(next)
  }

  const approx = (() => {
    const n = Number(amount.replace(',', '.'))
    if (!Number.isFinite(n) || n <= 0) return null
    if (unit === 'USD') return usdRate ? `≈ ${(n / usdRate).toFixed(5)} NIM` : null
    return formatUsd(n, usdRate)
  })()

  const submit = async () => {
    setError(null)
    setBusy(true)
    // A dead uplink behind a live Wi-Fi association fires no event, so
    // `online` (from the hook) can be stale. Re-check right now, at the
    // moment the till is about to accept money, rather than trust a
    // probe made minutes ago.
    const stillOnline = await recheckOnline()
    if (!stillOnline) {
      // recheckOnline() already flipped `online` to false, so the
      // offline notice below the form is now showing — no need for a
      // second, duplicate message here.
      setBusy(false)
      return
    }
    if (unit === 'USD') {
      const fiatAmountMinor = toMinorUnits(amount)
      if (fiatAmountMinor === null) {
        setError(t('Enter a valid amount (max 2 decimals).'))
        return
      }
      setBusy(true)
      try {
        const res = await api.claim(code.replace(/\s/g, ''),
          { fiatAmountMinor, fiatCurrency: SUPPORTED_FIAT_CURRENCY, reference: reference || undefined })
        navigate(`/session/${res.sessionId}`)
      } catch (e) {
        if (e instanceof ApiError && e.code === 'RATE_LIMITED') setError(t('Too many attempts. Wait a moment.'))
        else if (e instanceof ApiError && e.code === 'NO_RATE') setError(t('No exchange rate available right now. Try again shortly.'))
        else setError(t('Code unavailable. Check and try again.'))
      } finally {
        setBusy(false)
      }
      return
    }

    let amountLuna: string
    try {
      // Five of our six locales use a comma decimal separator, and a phone
      // keypad emits one — normalise it here rather than in nimToLuna
      // itself, which other callers rely on staying dot-only.
      const luna = nimToLuna(amount.replace(',', '.'))
      if (luna <= 0n) throw new RangeError('non-positive NIM amount')
      amountLuna = luna.toString()
    } catch {
      setError(t('Enter a valid NIM amount (max 5 decimals).'))
      return
    }
    setBusy(true)
    try {
      const res = await api.claim(code.replace(/\s/g, ''), { amountLuna, reference: reference || undefined })
      navigate(`/session/${res.sessionId}`)
    } catch (e) {
      if (e instanceof ApiError && e.code === 'RATE_LIMITED') setError(t('Too many attempts. Wait a moment.'))
      else setError(t('Code unavailable. Check and try again.'))
    } finally {
      setBusy(false)
    }
  }

  // --- Cart (Task 4) ------------------------------------------------

  const addToCart = (p: ProductView) => {
    setCashMessage(null)
    setCart(prev => {
      const idx = prev.findIndex(it => it.productId === p.id)
      if (idx >= 0) {
        const next = [...prev]
        next[idx] = { ...next[idx], quantity: next[idx].quantity + 1 }
        return next
      }
      return [...prev, { productId: p.id, name: p.name, unitPriceMinor: p.priceMinor, quantity: 1 }]
    })
  }

  const addCustomToCart = () => {
    setCartError(null)
    const unitPriceMinor = toMinorUnits(amount)
    if (unitPriceMinor === null) {
      setCartError(t('Enter a valid amount (max 2 decimals).'))
      return
    }
    setCashMessage(null)
    setCart(prev => [...prev, { productId: null, name: t('Custom'), unitPriceMinor, quantity: 1 }])
    setAmount('')
  }

  const changeQty = (index: number, delta: number) => {
    setCashMessage(null)
    setCart(prev => {
      const next = [...prev]
      const item = next[index]
      const quantity = item.quantity + delta
      if (quantity <= 0) { next.splice(index, 1); return next }
      next[index] = { ...item, quantity }
      return next
    })
  }

  const cartTotal = cart.reduce((sum, it) => sum + it.unitPriceMinor * it.quantity, 0)

  const cartItemsForApi = () => cart.map(it => it.productId
    ? { productId: it.productId, quantity: it.quantity }
    : { name: it.name, unitPriceMinor: it.unitPriceMinor, quantity: it.quantity })

  const saleErrorMessage = (e: unknown) => {
    if (e instanceof ApiError && (e.status === 409 || e.status === 400))
      return t('Could not complete the sale. Check the cart and try again.')
    return t('Could not complete the sale. Check your connection and try again.')
  }

  const takeNim = async () => {
    setCartError(null)
    setCashMessage(null)
    const stillOnline = await recheckOnline()
    if (!stillOnline) return
    setCartBusy(true)
    try {
      const sale = await api.createSale({ items: cartItemsForApi(), paymentMethod: 'nim' })
      setCart([])
      setPendingSale({ saleId: sale.id })
    } catch (e) {
      setCartError(saleErrorMessage(e))
    } finally {
      setCartBusy(false)
    }
  }

  const takeCash = async () => {
    setCartError(null)
    setCashMessage(null)
    setCartBusy(true)
    try {
      await api.createSale({ items: cartItemsForApi(), paymentMethod: 'cash' })
      setCart([])
      setCashMessage(t('Recorded.'))
    } catch (e) {
      setCartError(saleErrorMessage(e))
    } finally {
      setCartBusy(false)
    }
  }

  const claimSaleCode = async () => {
    if (!pendingSale) return
    setError(null)
    setBusy(true)
    const stillOnline = await recheckOnline()
    if (!stillOnline) { setBusy(false); return }
    try {
      const res = await api.claim(code.replace(/\s/g, ''), { saleId: pendingSale.saleId })
      navigate(`/session/${res.sessionId}`)
    } catch (e) {
      if (e instanceof ApiError && e.code === 'RATE_LIMITED') setError(t('Too many attempts. Wait a moment.'))
      else setError(t('Code unavailable. Check and try again.'))
    } finally {
      setBusy(false)
    }
  }

  // --- Render ---------------------------------------------------------

  if (pendingSale) {
    return (
      <main>
        <div className="form-card">
          <label>
            {t('Code from the payer')}
            <input
              className="code-input"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={7}
              value={code}
              onChange={e => {
                const digits = e.target.value.replace(/\D/g, '').slice(0, 6)
                setCode(digits.length > 3 ? `${digits.slice(0, 3)} ${digits.slice(3)}` : digits)
              }}
              placeholder="123 456"
            />
          </label>
          {!online && (
            <p role="alert" className="offline-notice">
              {t("Offline — payments can't be accepted until the connection is back.")}
            </p>
          )}
          <button className="primary" onClick={() => void claimSaleCode()}
            disabled={busy || !online || code.replace(/\s/g, '').length !== 6}>
            {t('Request payment')}
          </button>
        </div>
        {error && <p role="alert">{error}</p>}
      </main>
    )
  }

  if (!showCatalog) {
    return (
      <main>
        <div className="form-card">
        <div className="chips" role="group" aria-label={t('Pricing unit')}>
          <button type="button" className={`chip ${unit === 'USD' ? 'chip--on' : ''}`}
            aria-pressed={unit === 'USD'} onClick={() => chooseUnit('USD')}>{t('USD')}</button>
          <button type="button" className={`chip ${unit === 'NIM' ? 'chip--on' : ''}`}
            aria-pressed={unit === 'NIM'} onClick={() => chooseUnit('NIM')}>{t('NIM')}</button>
        </div>
        <label>
          {unit === 'USD' ? t('Amount (USD)') : t('Amount (NIM)')}
          <input inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)}
            placeholder={unit === 'USD' ? '2.50' : '2.5'} />
          {approx !== null && <span className="quiet">{approx}</span>}
        </label>
        <label>
          {t('Reference')}
          <input value={reference} maxLength={100} onChange={e => setReference(e.target.value)} placeholder="Soda" />
        </label>
        <label>
          {t('Code from the payer')}
          <input
            className="code-input"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={7}
            value={code}
            onChange={e => {
              const digits = e.target.value.replace(/\D/g, '').slice(0, 6)
              setCode(digits.length > 3 ? `${digits.slice(0, 3)} ${digits.slice(3)}` : digits)
            }}
            placeholder="123 456"
          />
        </label>
        {!online && (
          <p role="alert" className="offline-notice">
            {t("Offline — payments can't be accepted until the connection is back.")}
          </p>
        )}
        <button className="primary" onClick={submit}
          disabled={busy || !online || !amount || code.replace(/\s/g, '').length !== 6}>
          {t('Request payment')}
        </button>
        </div>
        {error && <p role="alert">{error}</p>}
      </main>
    )
  }

  // Catalog view: pinned first (API order, kept stable — never resorted by
  // popularity, so a cashier's muscle memory for where things sit holds),
  // then categories, then an "Other" bucket for uncategorized items.
  const q = search.trim().toLowerCase()
  const matches = (p: ProductView) => !q || p.name.toLowerCase().includes(q)
  const pinned = activeProducts.filter(p => p.pinned && matches(p))
  const rest = activeProducts.filter(p => !p.pinned && matches(p))
  const categories = Array.from(new Set(rest.map(p => p.category).filter((c): c is string => !!c)))
  const uncategorized = rest.filter(p => !p.category)

  return (
    <main>
      <div className="form-card">
        <label>
          {t('Search products')}
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder={t('Search products')} />
        </label>
        {pinned.length > 0 && (
          <section>
            <h3>{t('Pinned')}</h3>
            <div className="product-grid">
              {pinned.map(p => (
                <button type="button" key={p.id} className="product-btn" onClick={() => addToCart(p)}>
                  <span>{p.name}</span>
                  <span className="quiet">{formatMinor(p.priceMinor)}</span>
                </button>
              ))}
            </div>
          </section>
        )}
        {categories.map(cat => (
          <section key={cat}>
            <h3>{cat}</h3>
            <div className="product-grid">
              {rest.filter(p => p.category === cat).map(p => (
                <button type="button" key={p.id} className="product-btn" onClick={() => addToCart(p)}>
                  <span>{p.name}</span>
                  <span className="quiet">{formatMinor(p.priceMinor)}</span>
                </button>
              ))}
            </div>
          </section>
        ))}
        {uncategorized.length > 0 && (
          <section>
            <h3>{t('Other')}</h3>
            <div className="product-grid">
              {uncategorized.map(p => (
                <button type="button" key={p.id} className="product-btn" onClick={() => addToCart(p)}>
                  <span>{p.name}</span>
                  <span className="quiet">{formatMinor(p.priceMinor)}</span>
                </button>
              ))}
            </div>
          </section>
        )}

        <div className="chips" role="group" aria-label={t('Pricing unit')}>
          <button type="button" className={`chip ${unit === 'USD' ? 'chip--on' : ''}`}
            aria-pressed={unit === 'USD'} onClick={() => chooseUnit('USD')}>{t('USD')}</button>
          <button type="button" className={`chip ${unit === 'NIM' ? 'chip--on' : ''}`}
            aria-pressed={unit === 'NIM'} onClick={() => chooseUnit('NIM')}>{t('NIM')}</button>
        </div>
        <label>
          {unit === 'USD' ? t('Amount (USD)') : t('Amount (NIM)')}
          <input inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)}
            placeholder={unit === 'USD' ? '2.50' : '2.5'} />
          {approx !== null && <span className="quiet">{approx}</span>}
        </label>
        {unit === 'USD' ? (
          <button type="button" onClick={addCustomToCart} disabled={!amount}>{t('Add to cart')}</button>
        ) : (<>
          <label>
            {t('Reference')}
            <input value={reference} maxLength={100} onChange={e => setReference(e.target.value)} placeholder="Soda" />
          </label>
          <label>
            {t('Code from the payer')}
            <input
              className="code-input"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={7}
              value={code}
              onChange={e => {
                const digits = e.target.value.replace(/\D/g, '').slice(0, 6)
                setCode(digits.length > 3 ? `${digits.slice(0, 3)} ${digits.slice(3)}` : digits)
              }}
              placeholder="123 456"
            />
          </label>
          <button className="primary" onClick={submit}
            disabled={busy || !online || !amount || code.replace(/\s/g, '').length !== 6}>
            {t('Request payment')}
          </button>
        </>)}

        {cart.length > 0 && (
          <section className="cart">
            <h3>{t('Cart')}</h3>
            <ul className="cart-list">
              {cart.map((it, i) => (
                <li key={it.productId ?? `custom-${i}`}>
                  <span>{it.name}</span>
                  <span className="qty">
                    <button type="button" aria-label="-" onClick={() => changeQty(i, -1)}>−</button>
                    {it.quantity}
                    <button type="button" aria-label="+" onClick={() => changeQty(i, 1)}>+</button>
                  </span>
                  <span>{formatMinor(it.unitPriceMinor * it.quantity)}</span>
                </li>
              ))}
            </ul>
            <p className="amt">{t('Total')}: {formatMinor(cartTotal)} {SUPPORTED_FIAT_CURRENCY}</p>
            {!online && (
              <p role="alert" className="offline-notice">
                {t("Offline — payments can't be accepted until the connection is back.")}
              </p>
            )}
            <div className="actions">
              <button className="primary" onClick={() => void takeNim()} disabled={cartBusy || !online}>
                {t('Take NIM')}
              </button>
              <button onClick={() => void takeCash()} disabled={cartBusy}>{t('Cash')}</button>
            </div>
          </section>
        )}
        {cashMessage && <p role="status">{cashMessage}</p>}
        {cartError && <p role="alert">{cartError}</p>}
      </div>
      <p><Link to="/products">{t('Manage products')}</Link></p>
    </main>
  )
}
