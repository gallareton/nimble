import { useCallback, useEffect, useRef, useState } from 'react'
import type { Api } from '../api/client'

// A till must refuse a payment it cannot verify rather than queue it — a
// deferred transfer of a bearer asset is a double-spend risk a vendor
// cannot assess at the counter (BR-P10). `navigator.onLine` alone is not
// enough (it only means "has a link layer", not "can reach our backend"),
// so we back it with a cheap liveness probe against the existing
// `GET /v1/network` endpoint. Either signal saying "no" means offline.

const PROBE_TIMEOUT_MS = 2500
// While the screen believes it is offline, a dead uplink behind a live
// Wi-Fi association will never fire an `online` event — nothing tells the
// browser anything changed. Poll on a modest interval so the screen can
// recover on its own. Never poll while believed online: that would be
// wasted traffic on a phone for no benefit (the `online`/`offline`
// listeners are the fast path there).
export const RETRY_INTERVAL_MS = 5000

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
 *  either counts as offline — a fast, honest refusal beats a spinner.
 *  Callers who are about to accept a payment should call this directly
 *  (rather than trust a hook's possibly-stale state) so a dead uplink is
 *  caught at the moment it matters. */
export async function isOnline(api: Pick<Api, 'getNetwork'>): Promise<boolean> {
  if (!browserSaysOnline()) return false
  try {
    await withTimeout(api.getNetwork(), PROBE_TIMEOUT_MS)
    return true
  } catch {
    return false
  }
}

/** Live connectivity for a screen. Re-checks on mount, whenever the
 *  browser's `online`/`offline` events fire (the fastest signal when the
 *  host provides them), whenever the window/document regains focus or
 *  visibility, and — the case nothing else covers — on a modest interval
 *  for as long as the screen currently believes it is offline, since a
 *  live Wi-Fi association with a dead uplink fires no event at all.
 *
 *  Returns `[online, recheck]`. `recheck` re-probes immediately and
 *  resolves to the fresh result, so a caller (e.g. a submit handler) can
 *  gate an action on a check made right now instead of on state that may
 *  be minutes stale. */
export function useOnline(api: Pick<Api, 'getNetwork'>): [boolean, () => Promise<boolean>] {
  const [online, setOnline] = useState(browserSaysOnline)
  const onlineRef = useRef(online)
  onlineRef.current = online
  const cancelledRef = useRef(false)

  const check = useCallback(async () => {
    const v = await isOnline(api)
    if (!cancelledRef.current) setOnline(v)
    return v
  }, [api])

  useEffect(() => {
    cancelledRef.current = false
    void check()

    const handleOffline = () => { if (!cancelledRef.current) setOnline(false) }
    const handleOnline = () => void check()
    const handleVisible = () => {
      if (typeof document === 'undefined' || document.visibilityState === 'visible') void check()
    }

    let listening = false
    try {
      window.addEventListener('online', handleOnline)
      window.addEventListener('offline', handleOffline)
      window.addEventListener('focus', handleOnline)
      document.addEventListener('visibilitychange', handleVisible)
      listening = true
    } catch {
      // No window/document event target on this host — the initial check
      // and the interval below are all we get, and that is fine.
    }

    const interval = setInterval(() => {
      if (!cancelledRef.current && !onlineRef.current) void check()
    }, RETRY_INTERVAL_MS)

    return () => {
      cancelledRef.current = true
      clearInterval(interval)
      if (!listening) return
      try {
        window.removeEventListener('online', handleOnline)
        window.removeEventListener('offline', handleOffline)
        window.removeEventListener('focus', handleOnline)
        document.removeEventListener('visibilitychange', handleVisible)
      } catch { /* nothing to clean up */ }
    }
  }, [api, check])

  return [online, check]
}
