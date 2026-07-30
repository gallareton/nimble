// Wallet/SDK rejections arrive in assorted shapes (Error, {error:{message}},
// {code,message}, plain strings). Turn any of them into readable text —
// never "[object Object]".
export function describeError(e: unknown): string {
  if (e instanceof Error) return e.message
  if (typeof e === 'string') return e
  if (e && typeof e === 'object') {
    const o = e as { message?: unknown; code?: unknown; error?: { message?: unknown; type?: unknown } }
    const msg = o.message ?? o.error?.message
    if (typeof msg === 'string' && msg) {
      const code = o.code ?? o.error?.type
      return typeof code === 'string' && code ? `${code}: ${msg}` : msg
    }
    try { return JSON.stringify(e).slice(0, 300) } catch { /* circular */ }
  }
  return String(e)
}
