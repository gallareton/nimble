import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { App } from './App'
import '@fontsource-variable/mulish'
import './styles.css'
import { locale, t } from './i18n'
import { detectNetwork, watchNetworkFlips } from './lib/network'
import { Spinner } from './components/Spinner'

document.documentElement.lang = locale

// A payment must reach the chain the wallet is on, so nothing may call the
// API before the network is resolved. That resolution can take seconds —
// it waits for the wallet's consensus — which is why it happens behind a
// visible screen instead of an empty page.
function Boot() {
  const [ready, setReady] = useState(false)
  const [slow, setSlow] = useState(false)

  useEffect(() => {
    const timer = setTimeout(() => setSlow(true), 2500)
    void detectNetwork().then(() => {
      watchNetworkFlips()
      clearTimeout(timer)
      setReady(true)
    })
    return () => clearTimeout(timer)
  }, [])

  if (ready) return <App />

  return (
    <main className="boot-screen">
      <h1 className="brand">NIM<em>ble</em></h1>
      <Spinner />
      {slow && <p className="quiet">{t('Waiting for your wallet to sync…')}</p>}
    </main>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <Boot />
    </BrowserRouter>
  </StrictMode>,
)
