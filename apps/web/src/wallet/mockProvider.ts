import type { WalletProvider } from './types'

const MOCK_ADDRESS = 'NQ07 0000 0000 0000 0000 0000 0000 0000 0000'

// Deterministic wallet for browser dev and E2E — outside the Nimiq Pay
// WebView `window.nimiq` does not exist.
export class MockWalletProvider implements WalletProvider {
  async connect() {
    return { address: MOCK_ADDRESS }
  }

  async signMessage(_msg: string) {
    return { publicKey: 'mock-pk', signature: 'mock-sig' }
  }

  async sendTransaction(_tx: { recipient: string; valueLuna: bigint; data?: string }) {
    await new Promise(r => setTimeout(r, 300))
    return { hash: `mock-${crypto.randomUUID()}` }
  }
}
