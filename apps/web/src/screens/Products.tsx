import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import type { ProductView } from '@nimble/shared'
import { useAppOptional } from '../AppContext'
import type { Api } from '../api/client'
import { t } from '../i18n'
import { toMinorUnits } from './Charge'

/** A vendor's catalog: add, edit, pin, and retire (never delete — a
 *  withdrawn product's id may still be sitting on a historical sale_item,
 *  so the API has no DELETE and this screen doesn't pretend otherwise). */
export function Products(props: { api?: Api }) {
  const ctx = useAppOptional()
  const api = props.api ?? ctx?.api
  if (!api) throw new Error('Products needs api via props or AppProvider')

  const [products, setProducts] = useState<ProductView[]>([])
  const [loadError, setLoadError] = useState(false)
  const [name, setName] = useState('')
  const [price, setPrice] = useState('')
  const [category, setCategory] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editPrice, setEditPrice] = useState('')
  const [editCategory, setEditCategory] = useState('')

  const load = () => {
    setLoadError(false)
    void api.getProducts().then(setProducts).catch(() => setLoadError(true))
  }
  useEffect(load, [api])

  const addProduct = async () => {
    setError(null)
    const priceMinor = toMinorUnits(price)
    if (!name.trim() || priceMinor === null) {
      setError(t('Enter a valid amount (max 2 decimals).'))
      return
    }
    setBusy(true)
    try {
      await api.createProduct({ name: name.trim(), priceMinor, category: category.trim() || undefined })
      setName('')
      setPrice('')
      setCategory('')
      load()
    } catch {
      setError(t('Could not save the product. Check your connection and try again.'))
    } finally {
      setBusy(false)
    }
  }

  const startEdit = (p: ProductView) => {
    setEditingId(p.id)
    setEditName(p.name)
    setEditPrice((p.priceMinor / 100).toFixed(2))
    setEditCategory(p.category ?? '')
    setError(null)
  }

  const saveEdit = async (id: string) => {
    const priceMinor = toMinorUnits(editPrice)
    if (!editName.trim() || priceMinor === null) {
      setError(t('Enter a valid amount (max 2 decimals).'))
      return
    }
    setBusy(true)
    setError(null)
    try {
      await api.updateProduct(id, { name: editName.trim(), priceMinor, category: editCategory.trim() || null })
      setEditingId(null)
      load()
    } catch {
      setError(t('Could not save the product. Check your connection and try again.'))
    } finally {
      setBusy(false)
    }
  }

  const togglePinned = async (p: ProductView) => {
    setError(null)
    try {
      await api.updateProduct(p.id, { pinned: !p.pinned })
      load()
    } catch {
      setError(t('Could not save the product. Check your connection and try again.'))
    }
  }

  const toggleActive = async (p: ProductView) => {
    setError(null)
    try {
      await api.updateProduct(p.id, { active: !p.active })
      load()
    } catch {
      setError(t('Could not save the product. Check your connection and try again.'))
    }
  }

  if (loadError) {
    return (
      <main>
        <h1>{t('Products')}</h1>
        <p role="alert">{t('Could not load the products. Check your connection and try again.')}</p>
        <p className="footer-nav"><Link to="/">{t('Home')}</Link></p>
      </main>
    )
  }

  return (
    <main>
      <header className="top-bar">
        <Link to="/" className="back" aria-label={t('Back to home')}>‹ {t('Home')}</Link>
        <h1>{t('Products')}</h1>
      </header>

      <section className="form-card">
        <h2>{t('Add a product')}</h2>
        <label>
          {t('Name')}
          <input value={name} maxLength={60} onChange={e => setName(e.target.value)} />
        </label>
        <label>
          {t('Price (USD)')}
          <input inputMode="decimal" value={price} onChange={e => setPrice(e.target.value)} placeholder="2.50" />
        </label>
        <label>
          {t('Category (optional)')}
          <input value={category} maxLength={30} onChange={e => setCategory(e.target.value)} />
        </label>
        <button className="primary" onClick={() => void addProduct()} disabled={busy || !name || !price}>
          {t('Add product')}
        </button>
      </section>

      {error && <p role="alert">{error}</p>}

      {products.length === 0 ? (
        <p className="quiet">{t('No products yet.')}</p>
      ) : (
        <section className="list-card">
          <ul className="list">
            {products.map(p => (
              <li key={p.id} className={p.active ? '' : 'product--withdrawn'}>
                {editingId === p.id ? (
                  <div className="form-card">
                    <label>
                      {t('Name')}
                      <input value={editName} maxLength={60} onChange={e => setEditName(e.target.value)} />
                    </label>
                    <label>
                      {t('Price (USD)')}
                      <input inputMode="decimal" value={editPrice} onChange={e => setEditPrice(e.target.value)} />
                    </label>
                    <label>
                      {t('Category (optional)')}
                      <input value={editCategory} maxLength={30} onChange={e => setEditCategory(e.target.value)} />
                    </label>
                    <div className="actions">
                      <button onClick={() => void saveEdit(p.id)} disabled={busy}>{t('Save')}</button>
                      <button onClick={() => setEditingId(null)}>{t('Cancel')}</button>
                    </div>
                  </div>
                ) : (
                  <>
                    <span className="dir">
                      {p.name} — {(p.priceMinor / 100).toFixed(2)} USD
                      {p.category ? ` · ${p.category}` : ''}
                      {p.pinned ? ` · 📌` : ''}
                      {!p.active && ` · ${t('Withdrawn')}`}
                    </span>
                    <div className="actions">
                      <button onClick={() => startEdit(p)}>{t('Edit')}</button>
                      <button onClick={() => void togglePinned(p)}>{p.pinned ? t('Unpin') : t('Pin')}</button>
                      <button onClick={() => void toggleActive(p)}>{p.active ? t('Retire') : t('Reactivate')}</button>
                    </div>
                  </>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
      <p className="footer-nav"><Link to="/">{t('Home')}</Link></p>
    </main>
  )
}
