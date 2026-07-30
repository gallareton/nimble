// Nimiq Pay seeds window.nimiqPay (and injects window.nimiq) before the page
// script runs, so host detection is synchronous. Mock mode counts as hosted
// so dev/E2E keep the normal flow.
export function inNimiqPay(): boolean {
  if (typeof window === 'undefined') return false
  if (import.meta.env.VITE_WALLET === 'mock') return true
  const w = window as { nimiqPay?: unknown; nimiq?: unknown }
  return Boolean(w.nimiqPay || w.nimiq)
}

export const APP_URL = 'https://nimble.gallareton.pl'
export const DEEPLINK = `nimiqpay://miniapp?url=${encodeURIComponent(APP_URL)}`
export const PLAY_STORE = 'https://play.google.com/store/apps/details?id=com.nimiq.pay'
export const APP_STORE = 'https://apps.apple.com/app/nimiq-pay/id6471844738'
