// Nimiq Pay seeds window.nimiqPay (and injects window.nimiq) before the page
// script runs, so host detection is synchronous. Mock mode counts as hosted
// so dev/E2E keep the normal flow.
export function inNimiqPay(): boolean {
  if (typeof window === 'undefined') return false
  if (import.meta.env.VITE_WALLET === 'mock') return true
  const w = window as { nimiqPay?: unknown; nimiq?: unknown }
  return Boolean(w.nimiqPay || w.nimiq)
}

// One deployment serves both networks behind /api/main and /api/test (no
// testnet subdomain — verified against the nginx config on 2026-09-07), so
// deriving from the page origin is still correct: it just means "this
// deployment", not "this network".
export const APP_URL = typeof window !== 'undefined' && window.location.origin.startsWith('http')
  ? window.location.origin
  : 'https://nimble.gallareton.pl'
export const DEEPLINK = `nimiqpay://miniapp?url=${encodeURIComponent(APP_URL)}`
export const PLAY_STORE = 'https://play.google.com/store/apps/details?id=com.nimiq.pay'
export const APP_STORE = 'https://apps.apple.com/app/nimiq-pay/id6471844738'

// A remote charge is previewed and paid by whoever holds the link, not
// necessarily inside Nimiq Pay yet — so it needs a plain web URL. Whether
// the wallet's `url` param preserves a path is untested on-device as of this
// writing, so both forms are built and the caller picks: the deep link for
// opening straight into Nimiq Pay, the plain URL for anything else (e.g.
// pasting into a browser or another chat app).
export function remoteChargeUrl(id: string): string {
  return `${APP_URL}/r/${id}`
}
export function remoteChargeDeeplink(id: string): string {
  return `nimiqpay://miniapp?url=${encodeURIComponent(remoteChargeUrl(id))}`
}

const REMOTE_CHARGE_ID_RE = /\/r\/([^/?#]+)/

// Whether Nimiq Pay preserves the deeplink's `url` path when it opens a Mini
// App, or opens just the origin and passes the intended URL back some other
// way (a query param, a hash), is untested on-device — see remoteChargeUrl's
// comment. This looks for a /r/:id charge-request id wherever it might have
// landed — the path itself, a `url`/`u` query param (its value may itself be
// a full, percent-encoded URL), or the hash — so the app can redirect to the
// canonical route regardless of which shape the host chose. Returns null
// when nothing that looks like a remote-charge link is present.
export function findRemoteChargeId(loc: { pathname: string; search: string; hash: string }): string | null {
  const direct = loc.pathname.match(REMOTE_CHARGE_ID_RE)
  if (direct) return direct[1]

  const params = new URLSearchParams(loc.search)
  for (const key of ['url', 'u']) {
    const raw = params.get(key)
    if (!raw) continue
    let decoded = raw
    try { decoded = decodeURIComponent(raw) } catch { /* already decoded */ }
    const m = decoded.match(REMOTE_CHARGE_ID_RE)
    if (m) return m[1]
  }

  const hashMatch = loc.hash.match(REMOTE_CHARGE_ID_RE)
  if (hashMatch) return hashMatch[1]

  return null
}
