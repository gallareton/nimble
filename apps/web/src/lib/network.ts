// Single-URL, two-network architecture: one domain serves both stacks
// behind /api/main and /api/test; the app picks the backend matching the
// wallet's chain. Re-detected on every return to the app, so flipping the
// wallet between networks keeps working. Legacy single-stack deployments
// (no /api/* prefixes) are detected and used as-is.
import { getWallet } from '../wallet'
import { inNimiqPay } from './host'

export type NetworkChoice = { base: string; suffix: string; net: 'main' | 'test' | 'single' }

let choice: NetworkChoice = { base: '', suffix: '', net: 'single' }
const REMEMBER_KEY = 'nimble.network'

async function probe(base: string): Promise<{ network: string; height: number | null } | null> {
  try {
    const res = await fetch(`${base}/v1/network`, { signal: AbortSignal.timeout(4000) })
    if (!res.ok) return null
    return await res.json() as { network: string; height: number | null }
  } catch { return null }
}

async function walletHeight(): Promise<number | null> {
  if (!inNimiqPay()) return null
  try {
    const w = getWallet()
    if (!w.getBlockNumber) return null
    if (w.isConsensusEstablished && !(await w.isConsensusEstablished())) return null
    return await w.getBlockNumber()
  } catch { return null }
}

async function resolve(): Promise<NetworkChoice> {
  const configured = import.meta.env.VITE_API_URL
  // dev/E2E: explicit API URL → single backend, legacy storage keys
  if (configured) return { base: configured, suffix: '', net: 'single' }

  const [main, test] = await Promise.all([probe('/api/main'), probe('/api/test')])
  // legacy production (no prefixes yet) → same-origin single backend
  if (!main && !test) return { base: '', suffix: '', net: 'single' }

  const height = await walletHeight()
  if (height !== null) {
    if (main?.height != null && Math.abs(height - main.height) < 100_000)
      return { base: '/api/main', suffix: '.main', net: 'main' }
    if (test?.height != null && Math.abs(height - test.height) < 100_000)
      return { base: '/api/test', suffix: '.test', net: 'test' }
  }
  // no wallet signal: last remembered choice, else mainnet (the norm)
  const remembered = localStorage.getItem(REMEMBER_KEY)
  if (remembered === 'test' && test) return { base: '/api/test', suffix: '.test', net: 'test' }
  if (main) return { base: '/api/main', suffix: '.main', net: 'main' }
  return { base: '/api/test', suffix: '.test', net: 'test' }
}

export async function detectNetwork(): Promise<NetworkChoice> {
  choice = await resolve()
  if (choice.net !== 'single') localStorage.setItem(REMEMBER_KEY, choice.net)
  return choice
}

export function networkChoice(): NetworkChoice {
  return choice
}

// Re-detect when the user returns to the app (switching networks in Nimiq
// Pay requires leaving the Mini App). A change reloads with the new stack;
// per-network storage keys keep both sessions alive across flips.
export function watchNetworkFlips() {
  if (choice.net === 'single') return
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return
    void resolve().then(next => {
      if (next.net !== choice.net) {
        localStorage.setItem(REMEMBER_KEY, next.net === 'single' ? 'main' : next.net)
        window.location.reload()
      }
    })
  })
}
