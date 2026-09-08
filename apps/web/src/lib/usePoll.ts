import { useEffect, useRef } from 'react'

/**
 * Re-runs `fn` every `ms` while `enabled`, and only while the app is actually
 * on screen.
 *
 * The visibility check is not a micro-optimisation: a till phone sits on a
 * counter with this open all day, and a timer that keeps firing in the
 * background spends the vendor's battery and data on answers nobody is
 * looking at. Coming back to the foreground refreshes immediately, so the
 * pause costs nothing.
 *
 * `fn` is kept in a ref so a caller can pass an inline closure without
 * restarting the timer on every render — the classic way this kind of hook
 * ends up firing far more often than its interval suggests.
 */
export function usePoll(fn: () => void, ms: number, enabled = true) {
  const saved = useRef(fn)
  saved.current = fn

  useEffect(() => {
    if (!enabled) return
    const visible = () => typeof document === 'undefined' || document.visibilityState === 'visible'
    const tick = () => { if (visible()) saved.current() }

    const h = setInterval(tick, ms)
    // Returning to the app should show fresh data at once, not after one more
    // full interval of staring at a stale row.
    const onVisibility = () => { if (visible()) saved.current() }
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      clearInterval(h)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [enabled, ms])
}
