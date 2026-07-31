import type { ChainClient } from './monitor'

// In-memory chain for E2E: any hash the monitor asks about becomes included
// once a block is advanced; a macro advance finalizes everything included.
export class FakeChainClient implements ChainClient {
  #height = 0
  #macroHeight = 0
  #included = new Map<string, number>()

  advance(opts: { blocks?: number; macro?: boolean; reset?: boolean }) {
    if (opts.reset) {
      this.#height = 0
      this.#macroHeight = 0
      this.#included.clear()
    }
    if (opts.blocks) this.#height += opts.blocks
    if (opts.macro) this.#macroHeight = this.#height
    return { height: this.#height, macroHeight: this.#macroHeight }
  }

  async getTransaction(hash: string) {
    if (this.#height > 0) {
      if (!this.#included.has(hash)) this.#included.set(hash, this.#height)
      return { includedAtHeight: this.#included.get(hash)!, expired: false }
    }
    return { includedAtHeight: null, expired: false }
  }

  balanceLuna: bigint | null = null // null = unlimited (pre-check passes)
  async getBalance(_address: string) {
    return this.balanceLuna
  }

  async getLastMacroHeight() {
    return this.#macroHeight
  }

  async findIncomingByData() {
    return null // reconciliation is covered by the unit test in monitor.test.ts
  }
}
