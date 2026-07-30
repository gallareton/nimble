import { buildApp } from './app'
import { makeDb } from './db/client'
import { env } from './env'
import { SessionEvents } from './services/events'
import { nimiqVerifier } from './services/nimiqAuth'
import { startSweeper } from './services/sweeper'
import { startMonitor } from './services/monitor'
import { makeNimiqChainClient } from './services/nimiqChain'
import { FakeChainClient } from './services/fakeChain'
import { makeCoingeckoRates } from './services/rates'

if ((env.mockAuth || env.fakeChain) && process.env.NODE_ENV === 'production')
  throw new Error('MOCK_AUTH / FAKE_CHAIN must never be enabled in production')

// Dev/E2E only: accepts MockWalletProvider identities. The mock publicKey
// carries the address ("mock-pk:<address>") so two browser contexts can act
// as two different users.
const MOCK_DEFAULT_ADDRESS = 'NQ07 0000 0000 0000 0000 0000 0000 0000 0000'
const mockVerifier = {
  verify: async (_msg: string, publicKey: string) => {
    if (!publicKey.startsWith('mock-pk')) return { valid: false, address: null }
    const address = publicKey.includes(':') ? publicKey.slice(publicKey.indexOf(':') + 1) : MOCK_DEFAULT_ADDRESS
    return { valid: true, address }
  },
}

const { db } = makeDb(env.databaseUrl)
const events = new SessionEvents()
const rates = makeCoingeckoRates()
const app = buildApp({ db, verifier: env.mockAuth ? mockVerifier : nimiqVerifier, events, rates })
startSweeper(db, events)

if (env.fakeChain) {
  const fake = new FakeChainClient()
  startMonitor(db, events, fake, 500, rates)
  app.post('/__test/chain/advance', async req => {
    const body = (req.body ?? {}) as { blocks?: number; macro?: boolean; reset?: boolean }
    return fake.advance(body)
  })
} else {
  // Chain consensus can take a while or fail — the API must serve regardless.
  void makeNimiqChainClient()
    .then(chain => startMonitor(db, events, chain, 1500, rates))
    .catch(err => app.log.error({ err }, 'chain client unavailable — monitor not started'))
}

await app.listen({ port: env.port, host: '0.0.0.0' })
