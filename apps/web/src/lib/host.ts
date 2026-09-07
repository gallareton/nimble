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
