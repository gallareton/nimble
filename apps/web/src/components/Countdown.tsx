import { useEffect, useState } from 'react'

function fmt(secs: number) {
  const m = Math.floor(secs / 60)
  const s = secs % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

// Visual tick every second; the screen-reader live region announces only
// every 30 s to avoid flooding (spec §5.4).
export function Countdown({ until, onExpired, onTick }:
  { until: string; onExpired?: () => void; onTick?: (secsLeft: number) => void }) {
  const [left, setLeft] = useState(() => Math.max(0, new Date(until).getTime() - Date.now()))

  useEffect(() => {
    const h = setInterval(() => {
      const ms = Math.max(0, new Date(until).getTime() - Date.now())
      setLeft(ms)
      onTick?.(Math.ceil(ms / 1000))
      if (ms === 0) {
        clearInterval(h)
        onExpired?.()
      }
    }, 1000)
    return () => clearInterval(h)
  }, [until, onExpired, onTick])

  const secs = Math.ceil(left / 1000)
  const announced = Math.ceil(secs / 30) * 30
  return (
    <span className="countdown">
      <span aria-hidden>{fmt(secs)}</span>
      <span className="sr-only" aria-live="polite">{announced} seconds left</span>
    </span>
  )
}
