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
  // A transaction MUST go to the wallet's own network, so inside Nimiq Pay
  // we never guess: retry until the wallet's consensus answers (its client
  // usually settles within a few seconds of opening the Mini App).
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      const w = getWallet()
      if (!w.getBlockNumber) return null
      const ready = !w.isConsensusEstablished || (await w.isConsensusEstablished())
      if (ready) return await w.getBlockNumber()
    } catch { /* retry */ }
    await new Promise(r => setTimeout(r, 2000))
  }
  return null
}

async function resolve(): Promise<NetworkChoice> {
  const configured = import.meta.env.VITE_API_URL
  // dev/E2E: explicit API URL → single backend, legacy storage keys
  if (configured) return { base: configured, suffix: '', net: 'single' }

  const MAIN: NetworkChoice = { base: '/api/main', suffix: '.main', net: 'main' }
  const TEST: NetworkChoice = { base: '/api/test', suffix: '.test', net: 'test' }
  const near = (a: number, b: number) => Math.abs(a - b) < 100_000

  let main = await probe('/api/main')
  let test = await probe('/api/test')
  // legacy production (no prefixes yet) → same-origin single backend
  if (!main && !test) return { base: '', suffix: '', net: 'single' }

  const height = await walletHeight()

  // No wallet (browser landing): nothing can be signed here, so the
  // remembered choice or mainnet — the norm per Nimiq — is safe.
  if (height === null) {
    const remembered = localStorage.getItem(REMEMBER_KEY)
    if (remembered === 'test' && test) return TEST
    return main ? MAIN : TEST
  }

  // With a wallet we must NEVER guess: a payment has to reach the chain the
  // wallet is on. Match by height, or eliminate: a backend whose known
  // height rules it out proves the wallet is on the other network. A stack
  // still syncing (height null) resolves after a retry.
  for (let attempt = 0; attempt < 6; attempt++) {
    if (main?.height != null && near(height, main.height)) return MAIN
    if (test?.height != null && near(height, test.height)) return TEST
    const mainRuledOut = main?.height != null
    const testRuledOut = test?.height != null
    if (testRuledOut && !mainRuledOut && main) return MAIN // by elimination
    if (mainRuledOut && !testRuledOut && test) return TEST // by elimination
    await new Promise(r => setTimeout(r, 2000))
    main = await probe('/api/main')
    test = await probe('/api/test')
  }

  // Both backends answered and neither matches the wallet: routing is
  // genuinely undecidable. Land on mainnet, where the in-app guard sees the
  // height mismatch and blocks paying rather than sending to a wrong chain.
  return main ? MAIN : TEST
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
