export function CodeDisplay({ code }: { code: string }) {
  const grouped = `${code.slice(0, 3)} ${code.slice(3)}`
  const spoken = code.split('').join(' ')
  return (
    <div data-testid="code" className="code-display" aria-label={`code ${spoken}`}>
      {grouped}
    </div>
  )
}
