import { MiniAppWalletProvider } from './miniAppProvider'
import { MockWalletProvider } from './mockProvider'
import type { WalletProvider } from './types'

export * from './types'
export { MiniAppWalletProvider, MockWalletProvider }

let instance: WalletProvider | null = null

export function getWallet(): WalletProvider {
  if (!instance) {
    instance = import.meta.env.VITE_WALLET === 'mock'
      ? new MockWalletProvider()
      : new MiniAppWalletProvider()
  }
  return instance
}
