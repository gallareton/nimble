import { useEffect, useState } from 'react'
import type { Api } from '../api/client'

// A till must refuse a payment it cannot verify rather than queue it — a
// deferred transfer of a bearer asset is a double-spend risk a vendor
// cannot assess at the counter (BR-P10). `navigator.onLine` alone is not
// enough (it only means "has a link layer", not "can reach our backend"),
// so we back it with a cheap liveness probe against the existing
// `GET /v1/network` endpoint. Either signal saying "no" means offline.

const PROBE_TIMEOUT_MS = 2500

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('probe timed out')), ms)
    p.then(
      v => { clearTimeout(timer); resolve(v) },
      e => { clearTimeout(timer); reject(e) },
    )
  })
}

// `navigator.onLine` is absent on some hosts (the Nimiq Pay webview is
// poorer than a browser) — never assume it, and never let a missing or
// throwing property take the app down. Its absence is not evidence of
// being offline, only its explicit `false` is.
function browserSaysOnline(): boolean {
  try {
    return typeof navigator === 'undefined' || navigator.onLine !== false
  } catch {
    return true
  }
}

/** One-shot check: combines the browser's link-layer signal with a short,
 *  bounded liveness probe against the backend. Failure or timeout of
 *  either counts as offline — a fast, honest refusal beats a spinner. */
export async function isOnline(api: Pick<Api, 'getNetwork'>): Promise<boolean> {
  if (!browserSaysOnline()) return false
  try {
    await withTimeout(api.getNetwork(), PROBE_TIMEOUT_MS)
    return true
  } catch {
    return false
  }
}

/** Live connectivity for a screen: re-checks on mount and whenever the
 *  browser's `online`/`offline` events fire, so a vendor whose connection
 *  comes back never has to reload. Starts from the synchronous
 *  `navigator.onLine` read so an already-offline screen never flashes as
 *  usable while the first probe is in flight. */
export function useOnline(api: Pick<Api, 'getNetwork'>): boolean {
  const [online, setOnline] = useState(browserSaysOnline)

  useEffect(() => {
    let cancelled = false
    const check = () => {
      void isOnline(api).then(v => { if (!cancelled) setOnline(v) })
    }
    check()

    const handleOffline = () => { if (!cancelled) setOnline(false) }
    const handleOnline = () => check()

    let listening = false
    try {
      window.addEventListener('online', handleOnline)
      window.addEventListener('offline', handleOffline)
      listening = true
    } catch {
      // No window/event target on this host — the initial and any
      // caller-triggered checks are all we get, and that is fine.
    }

    return () => {
      cancelled = true
      if (!listening) return
      try {
        window.removeEventListener('online', handleOnline)
        window.removeEventListener('offline', handleOffline)
      } catch { /* nothing to clean up */ }
    }
  }, [api])

  return online
}
