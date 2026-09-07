import { buildApp } from './app'
import { makeDb } from './db/client'
import { env, DEV_JWT_SECRET, DEV_CODE_PEPPER } from './env'
import { SessionEvents } from './services/events'
import { nimiqHostVerifier } from './services/nimiqAuth'
import type { HostVerifier } from './services/hostVerifier'
import { startSweeper } from './services/sweeper'
import { startMonitor } from './services/monitor'
import { makeNimiqChainClient } from './services/nimiqChain'
import { FakeChainClient } from './services/fakeChain'
import { makeCoingeckoRates } from './services/rates'
import { makeBalanceReader } from './services/balances'

if ((env.mockAuth || env.fakeChain) && process.env.NODE_ENV === 'production')
  throw new Error('MOCK_AUTH / FAKE_CHAIN must never be enabled in production')

if (process.env.NODE_ENV === 'production') {
  const missing: string[] = []
  if (!process.env.JWT_SECRET || env.jwtSecret === DEV_JWT_SECRET) missing.push('JWT_SECRET')
  if (!process.env.CODE_PEPPER || env.codePepper === DEV_CODE_PEPPER) missing.push('CODE_PEPPER')
  if (missing.length > 0)
    throw new Error(`${missing.join(', ')} must be set to a real secret in production (dev default is not allowed)`)
}

// Dev/E2E only: accepts MockWalletProvider identities. The mock publicKey
// carries the address ("mock-pk:<address>") so two browser contexts can act
// as two different users.
const MOCK_DEFAULT_ADDRESS = 'NQ07 0000 0000 0000 0000 0000 0000 0000 0000'
// This is the boundary's own proof: a scheme that verifies no signature at
// all. It trusts the prefix so E2E can drive two distinct users through one
// browser. That it fits HostVerifier without contortion is the evidence the
// seam sits at the right height — if it had needed bending, the shape would
// be wrong.
const mockVerifier: HostVerifier = {
  scheme: 'mock',
  challenge: (nonce) => nimiqHostVerifier.challenge(nonce),
  verify: async ({ payload }) => {
    const publicKey = payload.publicKey ?? ''
    if (!publicKey.startsWith('mock-pk')) return null
    const address = publicKey.includes(':') ? publicKey.slice(publicKey.indexOf(':') + 1) : MOCK_DEFAULT_ADDRESS
    return { subject: address, payoutAddress: address }
  },
}

const { db } = makeDb(env.databaseUrl)
const events = new SessionEvents()
const rates = makeCoingeckoRates()
const chainRef = { current: null as import('./services/monitor').ChainClient | null }
const balances = makeBalanceReader(env.nimiqRpcUrl)
const app = buildApp({ db, hostVerifier: env.mockAuth ? mockVerifier : nimiqHostVerifier, events, rates, chainRef, balances })
startSweeper(db, events)

if (env.fakeChain) {
  const fake = new FakeChainClient()
  chainRef.current = fake
  startMonitor(db, events, fake, 500, rates)
  app.post('/__test/chain/advance', async req => {
    const body = (req.body ?? {}) as { blocks?: number; macro?: boolean; reset?: boolean }
    return fake.advance(body)
  })
} else {
  // Chain consensus can take a while or fail — the API must serve regardless.
  void makeNimiqChainClient()
    .then(chain => { chainRef.current = chain; startMonitor(db, events, chain, 1500, rates) })
    .catch(err => app.log.error({ err }, 'chain client unavailable — monitor not started'))
}

await app.listen({ port: env.port, host: '0.0.0.0' })
