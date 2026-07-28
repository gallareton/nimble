import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useApp } from '../AppContext'

export function Settings() {
  const { api, address, logout } = useApp()
  const [name, setName] = useState('')
  const [saved, setSaved] = useState(false)

  const save = async () => {
    await api.updateMe({ displayName: name })
    setSaved(true)
  }

  return (
    <main>
      <h1>Settings</h1>
      <label>
        Display name
        <input value={name} maxLength={50} onChange={e => { setName(e.target.value); setSaved(false) }} />
      </label>
      <button onClick={save} disabled={!name}>Save</button>
      {saved && <p role="status">Saved.</p>}
      <p>
        Receiving address (your wallet): <code>{address ?? '—'}</code>
      </p>
      <button onClick={logout}>Disconnect</button>
      <p><Link to="/">Home</Link></p>
    </main>
  )
}
