import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAppOptional } from '../AppContext'
import type { Api } from '../api/client'

export function Settings({ api: apiProp }: { api?: Api } = {}) {
  const ctx = useAppOptional()
  const api = apiProp ?? ctx!.api
  const address = ctx?.address ?? null
  const [name, setName] = useState('')
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    let cancelled = false
    void api.getMe().then((me) => {
      if (!cancelled && me.displayName) setName(me.displayName)
    }).catch(() => {})
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const save = async () => {
    await api.updateMe({ displayName: name })
    setSaved(true)
  }

  return (
    <main>
      <h1>Settings</h1>
      <div className="form-card">
      <label>
        Display name
        <input value={name} maxLength={50} onChange={e => { setName(e.target.value); setSaved(false) }} />
      </label>
      <button onClick={save} disabled={!name}>Save</button>
      {saved && <p role="status">Saved.</p>}
      </div>
      <p className="quiet">
        Receiving address (your wallet): <code>{address ?? '—'}</code>
      </p>
      {ctx && <button onClick={ctx.logout}>Disconnect</button>}
      <p className="footer-nav"><Link to="/">Home</Link></p>
    </main>
  )
}
