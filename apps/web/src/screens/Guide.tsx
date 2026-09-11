import { Intro } from '../components/Intro'

/**
 * The guide on its own screen (More → How it works, and the row on Home).
 * Same content as the first-run card, minus the "Got it" dismissal — there
 * is nothing to dismiss when you came here on purpose.
 */
export function Guide() {
  return (
    <main>
      <Intro />
    </main>
  )
}
