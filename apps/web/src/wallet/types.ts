export interface WalletProvider {
  connect(): Promise<{ address: string }>
  getBlockNumber?(): Promise<number>
  isConsensusEstablished?(): Promise<boolean>
  signMessage(msg: string): Promise<{ publicKey: string; signature: string }>
  sendTransaction(tx: {
    recipient: string
    valueLuna: bigint
    data?: string // ≤64 B; reconciliation token for the charge
  }): Promise<{ hash: string }>
}

export type WalletErrorCode = 'PERMISSION_DENIED' | 'UNAVAILABLE' | 'INVALID_TX'

export class WalletError extends Error {
  constructor(public code: WalletErrorCode, message: string) {
    super(message)
    this.name = 'WalletError'
  }
}
