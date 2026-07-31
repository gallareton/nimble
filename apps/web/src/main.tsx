import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { App } from './App'
import '@fontsource-variable/mulish'
import './styles.css'
import { locale } from './i18n'
import { detectNetwork, watchNetworkFlips } from './lib/network'

document.documentElement.lang = locale

void detectNetwork().then(() => {
  watchNetworkFlips()
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </StrictMode>,
  )
})
