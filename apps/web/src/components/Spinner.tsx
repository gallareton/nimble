// Nimiq hexagon, gently spinning — shown while a payment is in flight.
export function Spinner() {
  return (
    <svg className="spinner" viewBox="0 0 32 32" aria-hidden>
      <path
        d="M29.6 13.9 23.4 3.1A4.2 4.2 0 0 0 19.7 1h-12.4a4.2 4.2 0 0 0-3.6 2.1L1.4 13.9a4.2 4.2 0 0 0 0 4.2l6.2 10.8a4.2 4.2 0 0 0 3.6 2.1h12.4a4.2 4.2 0 0 0 3.6-2.1l6.2-10.8a4.2 4.2 0 0 0 .2-4.2z"
        fill="none" stroke="#0582ca" stroke-width="3" stroke-linejoin="round" transform="translate(0.5 0)" />
    </svg>
  )
}
