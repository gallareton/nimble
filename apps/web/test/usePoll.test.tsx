import { afterEach, expect, it, vi } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { usePoll } from '../src/lib/usePoll'

afterEach(() => { cleanup(); vi.useRealTimers() })

function Probe({ fn, ms, enabled }: { fn: () => void; ms: number; enabled: boolean }) {
  usePoll(fn, ms, enabled)
  return null
}

it('fires on the interval while enabled, and stops when disabled', () => {
  vi.useFakeTimers()
  const fn = vi.fn()
  const { rerender } = render(<Probe fn={fn} ms={1000} enabled />)

  vi.advanceTimersByTime(3000)
  expect(fn).toHaveBeenCalledTimes(3)

  rerender(<Probe fn={fn} ms={1000} enabled={false} />)
  vi.advanceTimersByTime(5000)
  expect(fn).toHaveBeenCalledTimes(3) // no further ticks
})

it('does not restart the timer when the callback identity changes', () => {
  // The regression this guards: a caller passing an inline closure re-renders
  // constantly, and a naive hook would clear and recreate the interval each
  // time — so it would never actually reach a full period and would either
  // never fire or fire far too often.
  vi.useFakeTimers()
  const fn = vi.fn()
  const { rerender } = render(<Probe fn={() => fn()} ms={1000} enabled />)

  vi.advanceTimersByTime(900)
  rerender(<Probe fn={() => fn()} ms={1000} enabled />) // new closure, same period
  vi.advanceTimersByTime(200)

  expect(fn).toHaveBeenCalledTimes(1) // the period completed despite the re-render
})

it('skips ticks while the app is off screen, and refreshes on return', () => {
  // A till phone sits on a counter with this open all day; a timer that keeps
  // firing in the background spends the vendor's battery on answers nobody is
  // looking at.
  vi.useFakeTimers()
  const fn = vi.fn()
  const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
  render(<Probe fn={fn} ms={1000} enabled />)

  vi.advanceTimersByTime(3000)
  expect(fn).not.toHaveBeenCalled()

  visibility.mockReturnValue('visible')
  document.dispatchEvent(new Event('visibilitychange'))
  expect(fn).toHaveBeenCalledTimes(1) // immediately, not after another full period

  visibility.mockRestore()
})
