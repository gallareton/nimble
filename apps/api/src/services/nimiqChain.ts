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

  // getTransaction(hash) against remote peers only finds a transaction once
  // its batch is finalized (device-observed: SUBMITTED jumped straight to
  // CONFIRMED at the macro block, skipping CONFIRMING). For second-level
  // inclusion the client must LISTEN: subscribe to the recipients of pending
  // charges and buffer what the network pushes at inclusion time.
  type Seen = { hash: string; recipient: string; dataRaw: string; height: number }
  const seen: Seen[] = []
  let watchHandle: number | null = null
  let watchedKey = ''

  return {
    async watchAddresses(addresses: string[]) {
      const key = addresses.slice().sort().join(',')
      if (key === watchedKey) return
      watchedKey = key
      if (watchHandle !== null) { await client.removeListener(watchHandle).catch(() => {}); watchHandle = null }
      if (addresses.length === 0) return
      watchHandle = await client.addTransactionListener(tx => {
        if (!tx.blockHeight || tx.blockHeight <= 0) return
        seen.push({ hash: tx.transactionHash, recipient: tx.recipient,
          dataRaw: tx.data.type === 'raw' ? tx.data.raw : '', height: tx.blockHeight })
        if (seen.length > 200) seen.splice(0, seen.length - 200)
      }, addresses)
    },
    async getTransaction(hash) {
      const buffered = seen.find(x => x.hash === hash)
      if (buffered) return { includedAtHeight: buffered.height, expired: false }
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
      const buffered = seen.find(x => x.recipient === recipient &&
        x.dataRaw.toLowerCase().includes(dataHex.toLowerCase()))
      if (buffered) return { hash: buffered.hash }
      try {
        const txs = await client.getTransactionsByAddress(recipient, 0, null, null, 50)
        const hit = txs.find(t => t.recipient === recipient &&
          t.data.type === 'raw' && t.data.raw.toLowerCase().includes(dataHex.toLowerCase()))
        return hit ? { hash: hit.transactionHash } : null
      } catch { return null }
    },
  }
}
