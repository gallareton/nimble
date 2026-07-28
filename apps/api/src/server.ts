import { buildApp } from './app'
import { makeDb } from './db/client'
import { env } from './env'
import { SessionEvents } from './services/events'
import { nimiqVerifier } from './services/nimiqAuth'
import { startSweeper } from './services/sweeper'
import { startMonitor } from './services/monitor'
import { makeNimiqChainClient } from './services/nimiqChain'

if (env.mockAuth && process.env.NODE_ENV === 'production')
  throw new Error('MOCK_AUTH must never be enabled in production')

// Dev/E2E only: accepts the MockWalletProvider's fixed identity.
const mockVerifier = {
  verify: async (_msg: string, publicKey: string) => ({
    valid: publicKey === 'mock-pk',
    address: 'NQ07 0000 0000 0000 0000 0000 0000 0000 0000',
  }),
}

const { db } = makeDb(env.databaseUrl)
const events = new SessionEvents()
const app = buildApp({ db, verifier: env.mockAuth ? mockVerifier : nimiqVerifier, events })
startSweeper(db, events)

// Chain consensus can take a while or fail — the API must serve regardless.
void makeNimiqChainClient()
  .then(chain => startMonitor(db, events, chain))
  .catch(err => app.log.error({ err }, 'chain client unavailable — monitor not started'))

await app.listen({ port: env.port, host: '0.0.0.0' })
