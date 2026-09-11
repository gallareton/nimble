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
type Step = 'amount' | 'pay'
type Method = 'nim' | 'cash'
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

// BLIK-style, in two steps (R7): the receiver says how much FIRST — from the
// catalog, from a cart, or by typing an amount — and only then picks how the
// money arrives and takes the payer's code. The cashier prices the sale in
// fiat; the server converts and freezes the quote.
export function Charge(props: { api?: Api }) {
  const ctx = useAppOptional()
  const api = props.api ?? ctx?.api
  if (!api) throw new Error('Charge needs api via props or AppProvider')
  const navigate = useNavigate()
  const [step, setStep] = useState<Step>('amount')
  const [method, setMethod] = useState<Method>('nim')
  const [unit, setUnit] = useState<Unit>(loadUnit)
  const [amount, setAmount] = useState('')
  const [reference, setReference] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const usdRate = useUsdRate(api)
  const [online, recheckOnline] = useOnline(api)

  // Catalog layer. `products` stays null until a catalog-aware caller
  // answers — a test double without getProducts leaves this screen on the
  // no-catalog path, where an owner types an amount by hand.
  const [products, setProducts] = useState<ProductView[] | null>(null)
  const [cart, setCart] = useState<CartItem[]>([])
  const [search, setSearch] = useState('')
  const [cartError, setCartError] = useState<string | null>(null)
  const [cartBusy, setCartBusy] = useState(false)
  const [cashMessage, setCashMessage] = useState<string | null>(null)
  // Set once a NIM cart sale has been minted server-side. It survives a
  // failed claim so a second tap of "Request payment" reuses the same sale
  // instead of minting a duplicate; any edit to the cart clears it.
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

  // --- Cart ------------------------------------------------------------

  const addToCart = (p: ProductView) => {
    setCashMessage(null)
    setPendingSale(null)
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
    setPendingSale(null)
    setCart(prev => [...prev, { productId: null, name: t('Custom'), unitPriceMinor, quantity: 1 }])
    setAmount('')
  }

  const changeQty = (index: number, delta: number) => {
    setCashMessage(null)
    setPendingSale(null)
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

  // Step 2, cart + NIM. The sale is minted once and kept: a wrong code costs
  // a retry, never a duplicate sale on the server.
  const requestPaymentForCart = async () => {
    setError(null)
    setCartError(null)
    setBusy(true)
    const stillOnline = await recheckOnline()
    if (!stillOnline) { setBusy(false); return }
    let saleId = pendingSale?.saleId ?? null
    if (saleId === null) {
      try {
        const sale = await api.createSale({ items: cartItemsForApi(), paymentMethod: 'nim' })
        saleId = sale.id
        setPendingSale({ saleId: sale.id })
      } catch (e) {
        setCartError(saleErrorMessage(e))
        setBusy(false)
        return
      }
    }
    try {
      const res = await api.claim(code.replace(/\s/g, ''), { saleId })
      setCart([])
      navigate(`/session/${res.sessionId}`)
    } catch (e) {
      if (e instanceof ApiError && e.code === 'RATE_LIMITED') setError(t('Too many attempts. Wait a moment.'))
      else setError(t('Code unavailable. Check and try again.'))
    } finally {
      setBusy(false)
    }
  }

  const recordCashSale = async () => {
    setCartError(null)
    setCashMessage(null)
    setCartBusy(true)
    try {
      await api.createSale({ items: cartItemsForApi(), paymentMethod: 'cash' })
      setCart([])
      setPendingSale(null)
      setCashMessage(t('Recorded.'))
      setStep('amount')
    } catch (e) {
      setCartError(saleErrorMessage(e))
    } finally {
      setCartBusy(false)
    }
  }

  // --- Step transition --------------------------------------------------

  // The cart wins: with anything in it, a stray typed amount is ignored.
  const canContinue = cart.length > 0
    || (amount.trim() !== '' && (unit === 'NIM' || !showCatalog))

  const goToPay = () => {
    setError(null)
    if (cart.length > 0) { setStep('pay'); return }
    if (unit === 'USD') {
      if (toMinorUnits(amount) === null) {
        setError(t('Enter a valid amount (max 2 decimals).'))
        return
      }
    } else {
      try {
        if (nimToLuna(amount.replace(',', '.')) <= 0n) throw new RangeError('non-positive NIM amount')
      } catch {
        setError(t('Enter a valid NIM amount (max 5 decimals).'))
        return
      }
    }
    setStep('pay')
  }

  // --- Shared fragments -------------------------------------------------

  const codeField = (
    <div className="field">
      <label htmlFor="charge-code">{t('Code from the payer')}</label>
      <input
        id="charge-code"
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
    </div>
  )

  const offlineNotice = !online && (
    <p role="alert" className="offline-notice">
      {t("Offline — payments can't be accepted until the connection is back.")}
    </p>
  )

  const codeComplete = code.replace(/\s/g, '').length === 6

  // --- Step 2: Payment --------------------------------------------------

  if (step === 'pay') {
    const cartPath = cart.length > 0
    return (
      <main>
        <div className="form-card">
          <h2>{t('Step 2 of 2 · Payment')}</h2>
          <button type="button" className="link-btn" onClick={() => setStep('amount')}>
            ‹ {t('Back to amount')}
          </button>

          <div className="total-line">
            <span>{cartPath ? t('Total') : t('Amount')}</span>
            <span className="row__amt">
              {cartPath ? `${formatMinor(cartTotal)} ${SUPPORTED_FIAT_CURRENCY}` : `${amount} ${unit}`}
            </span>
          </div>
          {!cartPath && approx !== null && <span className="approx">{approx}</span>}

          {cartPath ? (<>
            <div className="seg seg--wide" role="group" aria-label={t('Payment method')}>
              <button type="button" aria-pressed={method === 'nim'} onClick={() => setMethod('nim')}>{t('NIM')}</button>
              <button type="button" aria-pressed={method === 'cash'} onClick={() => setMethod('cash')}>{t('Cash')}</button>
            </div>
            {method === 'nim' ? (<>
              {codeField}
              {offlineNotice}
            </>) : null}
          </>) : (<>
            <div className="field">
              <label htmlFor="charge-reference">{t('Reference')}</label>
              <input id="charge-reference" value={reference} maxLength={100}
                onChange={e => setReference(e.target.value)} placeholder="Soda" />
            </div>
            {codeField}
            {offlineNotice}
          </>)}
        </div>
        {error && <p role="alert">{error}</p>}
        {cartError && <p role="alert">{cartError}</p>}
        <div className="cta-bar">
          {cartPath && method === 'cash' ? (
            <button className="primary" onClick={() => void recordCashSale()} disabled={cartBusy}>
              {t('Record cash sale')}
            </button>
          ) : (
            <button className="primary"
              onClick={cartPath ? () => void requestPaymentForCart() : submit}
              disabled={busy || !online || !codeComplete}>
              {t('Request payment')}
            </button>
          )}
        </div>
      </main>
    )
  }

  // --- Step 1: How much? ------------------------------------------------

  // Pinned first (API order, kept stable — never resorted by popularity, so a
  // cashier's muscle memory for where things sit holds), then categories,
  // then an "Other" bucket for uncategorized items.
  const q = search.trim().toLowerCase()
  const matches = (p: ProductView) => !q || p.name.toLowerCase().includes(q)
  const pinned = activeProducts.filter(p => p.pinned && matches(p))
  const rest = activeProducts.filter(p => !p.pinned && matches(p))
  const categories = Array.from(new Set(rest.map(p => p.category).filter((c): c is string => !!c)))
  const uncategorized = rest.filter(p => !p.category)

  const productButton = (p: ProductView) => (
    <button type="button" key={p.id} className="product-btn" onClick={() => addToCart(p)}>
      <span>{p.name}</span>
      <span className="price">{formatMinor(p.priceMinor)}</span>
    </button>
  )

  return (
    <main>
      <div className="form-card">
        <h2>{t('Step 1 of 2 · How much?')}</h2>

        {showCatalog && (<>
          <div className="field">
            <label htmlFor="charge-search">{t('Search products')}</label>
            <input id="charge-search" value={search} onChange={e => setSearch(e.target.value)}
              placeholder={t('Search products')} />
          </div>
          {pinned.length > 0 && (
            <section>
              <h3>{t('Pinned')}</h3>
              <div className="product-grid">{pinned.map(productButton)}</div>
            </section>
          )}
          {categories.map(cat => (
            <section key={cat}>
              <h3>{cat}</h3>
              <div className="product-grid">{rest.filter(p => p.category === cat).map(productButton)}</div>
            </section>
          ))}
          {uncategorized.length > 0 && (
            <section>
              <h3>{t('Other')}</h3>
              <div className="product-grid">{uncategorized.map(productButton)}</div>
            </section>
          )}
        </>)}

        {cart.length > 0 && (
          <section>
            <h3>{t('Cart')}</h3>
            <ul className="rows rows--plain">
              {cart.map((it, i) => (
                <li key={it.productId ?? `custom-${i}`} className="row">
                  <span className="row__main"><span className="row__title">{it.name}</span></span>
                  <span className="stepper">
                    <button type="button" aria-label="-" onClick={() => changeQty(i, -1)}>−</button>
                    <span className="stepper__n">{it.quantity}</span>
                    <button type="button" aria-label="+" onClick={() => changeQty(i, 1)}>+</button>
                  </span>
                  <span className="row__amt">{formatMinor(it.unitPriceMinor * it.quantity)}</span>
                </li>
              ))}
            </ul>
            <div className="total-line">
              <span>{t('Total')}</span>
              <span className="row__amt">{formatMinor(cartTotal)} {SUPPORTED_FIAT_CURRENCY}</span>
            </div>
          </section>
        )}

        <div className="field">
          <label htmlFor="charge-amount">{t('Amount')}</label>
          <div className="field-suffix">
            <input id="charge-amount" inputMode="decimal" value={amount}
              onChange={e => setAmount(e.target.value)}
              placeholder={unit === 'USD' ? '2.50' : '2.5'} />
            <div className="seg" role="group" aria-label={t('Pricing unit')}>
              <button type="button" aria-pressed={unit === 'USD'} onClick={() => chooseUnit('USD')}>{t('USD')}</button>
              <button type="button" aria-pressed={unit === 'NIM'} onClick={() => chooseUnit('NIM')}>{t('NIM')}</button>
            </div>
          </div>
          {approx !== null && <span className="approx">{approx}</span>}
        </div>

        {showCatalog && unit === 'USD' && (
          <button type="button" className="primary" onClick={addCustomToCart} disabled={!amount}>
            {t('Add to cart')}
          </button>
        )}

        {cashMessage && <p role="status">{cashMessage}</p>}
        {cartError && <p role="alert">{cartError}</p>}
      </div>
      {error && <p role="alert">{error}</p>}
      <ul className="rows">
        <li>
          <Link className="row row--link" to="/charge/remote">
            <span className="row__title">{t("Bill someone who isn't here")}</span>
          </Link>
        </li>
      </ul>
      <div className="cta-bar">
        <button className="primary" onClick={goToPay} disabled={!canContinue}>{t('Continue')}</button>
      </div>
    </main>
  )
}
