// The official `spinner` icon from nimiq-icons (MIT), rotating via CSS.
export function Spinner({ size = 22 }: { size?: number }) {
  return (
    <svg className="spinner" viewBox="0 0 12 12" width={size} height={size} aria-hidden>
      <g fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.667">
        <path d="M6 1a5 5 0 015 5" />
        <path d="M3.038 2A4.96 4.96 0 001 6.014 4.985 4.985 0 005.986 11c1.652 0 3.11-.804 4.014-2.038" opacity=".3" />
      </g>
    </svg>
  )
}
