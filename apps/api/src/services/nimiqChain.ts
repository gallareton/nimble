import type { ChainClient } from './monitor'
import { env } from '../env'

// Real Nimiq light client. Every @nimiq/core call stays inside this file —
// method names/shapes are device-verified against testnet (plan Task 17);
// adjust here only, the ChainClient interface is the contract.
export async function makeNimiqChainClient(): Promise<ChainClient> {
  const Nimiq = await import('@nimiq/core')
  const config = new Nimiq.ClientConfiguration()
  config.network(env.nimiqNetwork)
  // Device-verified: config.network('TestAlbatross') sets the network id but
  // KEEPS the mainnet seed list, so consensus never establishes (testnet
  // handshake to mainnet peers is rejected). Explicit testnet seeds fix it.
  if (env.nimiqNetwork === 'TestAlbatross') {
    config.seedNodes([
      '/dns4/seed1.pos.nimiq-testnet.com/tcp/8443/wss',
      '/dns4/seed2.pos.nimiq-testnet.com/tcp/8443/wss',
      '/dns4/seed3.pos.nimiq-testnet.com/tcp/8443/wss',
      '/dns4/seed4.pos.nimiq-testnet.com/tcp/8443/wss',
    ])
  }
  const client = await Nimiq.Client.create(config.build())
  await client.waitForConsensusEstablished()

  // Albatross testnet batch length; a macro (checkpoint) block finalizes each
  // batch. Validated on device in Task 17.
  const BATCH = 60

  return {
    async getTransaction(hash) {
      try {
        const tx = await client.getTransaction(hash)
        if (!tx) return null
        if (tx.state === 'expired' || tx.state === 'invalidated')
          return { includedAtHeight: null, expired: true }
        return { includedAtHeight: tx.blockHeight && tx.blockHeight > 0 ? tx.blockHeight : null, expired: false }
      } catch { return null }
    },
    async getLastMacroHeight() {
      const head = await client.getHeadHeight()
      return Math.floor(head / BATCH) * BATCH
    },
    async findIncomingByData(recipient, dataHex) {
      try {
        const txs = await client.getTransactionsByAddress(recipient, 0, null, null, 50)
        const hit = txs.find(t => t.recipient === recipient &&
          t.data.type === 'raw' && t.data.raw.toLowerCase().includes(dataHex.toLowerCase()))
        return hit ? { hash: hit.transactionHash } : null
      } catch { return null }
    },
  }
}
