// Balance is read server-side against a public Nimiq RPC, never from the
// browser: one place to configure the endpoint per network, no third-party
// host in the webview's CSP, and a single place to fail safe.
//
// The Mini App SDK has no balance call (the Nimiq team confirmed on
// 2026-08-30 that `nimiq.getBalance` does not exist), and the embedded
// light client cannot read balances either — a public RPC is the supported
// route for now.

export interface BalanceReader {
  /** null means "unknown" — unreachable, slow, or malformed reply. Never
   *  "zero": a false "zero" would tell a funded payer they cannot pay. */
  getBalanceLuna(address: string): Promise<bigint | null>
}

const TIMEOUT_MS = 2000

interface RpcAccountResponse {
  result?: { data?: { address?: string; balance?: unknown; type?: string } }
}

export function makeBalanceReader(rpcUrl: string): BalanceReader {
  return {
    async getBalanceLuna(address) {
      try {
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
        let res: Response
        try {
          res = await fetch(rpcUrl, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              jsonrpc: '2.0', id: 1, method: 'getAccountByAddress', params: [address],
            }),
            signal: controller.signal,
          })
        } finally {
          clearTimeout(timer)
        }
        if (!res.ok) return null
        const json = (await res.json()) as RpcAccountResponse
        const balance = json?.result?.data?.balance
        // The RPC returns balance as a JSON number. Reject anything that is
        // not a safe integer rather than silently losing precision by
        // converting a float or an out-of-range number to bigint.
        if (typeof balance !== 'number' || !Number.isFinite(balance) || !Number.isInteger(balance)
          || !Number.isSafeInteger(balance) || balance < 0)
          return null
        return BigInt(balance)
      } catch {
        // Unreachable, timed out, or malformed JSON: unknown, not zero.
        return null
      }
    },
  }
}
