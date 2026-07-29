import { uuid } from '../lib/uuid'
import type { WalletProvider } from './types'

const MOCK_ADDRESS = 'NQ07 0000 0000 0000 0000 0000 0000 0000 0000'

// Deterministic wallet for browser dev and E2E — outside the Nimiq Pay
// WebView `window.nimiq` does not exist. E2E gives each browser context its
// own identity via localStorage['nimblink.mockAddress']; the mock publicKey
// carries the address so the server's mock verifier can recover it.
export class MockWalletProvider implements WalletProvider {
  #address(): string {
    return localStorage.getItem('nimblink.mockAddress') ?? MOCK_ADDRESS
  }

  async connect() {
    return { address: this.#address() }
  }

  async signMessage(_msg: string) {
    return { publicKey: `mock-pk:${this.#address()}`, signature: 'mock-sig' }
  }

  async sendTransaction(_tx: { recipient: string; valueLuna: bigint; data?: string }) {
    await new Promise(r => setTimeout(r, 300))
    return { hash: `mock-${uuid()}` }
  }
}
