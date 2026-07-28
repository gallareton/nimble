import { init } from '@nimiq/mini-app-sdk'
import { WalletError, type WalletProvider } from './types'

type MaybeError<T> = T | { error: { type: string; message: string } }

function unwrap<T>(res: MaybeError<T>): T {
  if (res && typeof res === 'object' && 'error' in (res as object)) {
    const { type, message } = (res as { error: { type: string; message: string } }).error
    throw new WalletError(type === 'PermissionDeniedError' ? 'PERMISSION_DENIED' : 'INVALID_TX', message)
  }
  return res as T
}

export class MiniAppWalletProvider implements WalletProvider {
  #nimiq: Awaited<ReturnType<typeof init>> | null = null

  async #provider() {
    if (!this.#nimiq) {
      try {
        this.#nimiq = await init({ timeout: 10_000 })
      } catch {
        throw new WalletError('UNAVAILABLE', 'Not running inside Nimiq Pay')
      }
    }
    return this.#nimiq
  }

  async connect() {
    const accounts = unwrap(await (await this.#provider()).listAccounts())
    if (!accounts.length) throw new WalletError('UNAVAILABLE', 'no accounts')
    return { address: accounts[0] }
  }

  async signMessage(msg: string) {
    return unwrap(await (await this.#provider()).sign(msg))
  }

  async sendTransaction(tx: { recipient: string; valueLuna: bigint; data?: string }) {
    if (tx.valueLuna > BigInt(Number.MAX_SAFE_INTEGER))
      throw new WalletError('INVALID_TX', 'amount too large')
    const p = await this.#provider()
    const value = Number(tx.valueLuna) // luna fit safely: NIM supply 2.1e15 < 2^53
    const hash = unwrap(
      tx.data
        ? await p.sendBasicTransactionWithData({ recipient: tx.recipient, value, data: tx.data })
        : await p.sendBasicTransaction({ recipient: tx.recipient, value }),
    )
    return { hash }
  }
}
