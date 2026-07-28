import { useEffect, useState } from 'react'

// Visual tick every second; the screen-reader live region announces only
// every 30 s to avoid flooding (spec §5.4).
export function Countdown({ until, onExpired }: { until: string; onExpired?: () => void }) {
  const [left, setLeft] = useState(() => Math.max(0, new Date(until).getTime() - Date.now()))

  useEffect(() => {
    const h = setInterval(() => {
      const ms = Math.max(0, new Date(until).getTime() - Date.now())
      setLeft(ms)
      if (ms === 0) {
        clearInterval(h)
        onExpired?.()
      }
    }, 1000)
    return () => clearInterval(h)
  }, [until, onExpired])

  const secs = Math.ceil(left / 1000)
  const announced = Math.ceil(secs / 30) * 30
  return (
    <span className="countdown">
      <span aria-hidden>{secs}s</span>
      <span className="sr-only" aria-live="polite">{announced} seconds left</span>
    </span>
  )
}
