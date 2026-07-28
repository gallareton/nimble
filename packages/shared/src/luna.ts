const NIM_RE = /^(\d+)(?:\.(\d{1,5}))?$/
export const LUNA_PER_NIM = 100_000n

export function nimToLuna(nim: string): bigint {
  const m = NIM_RE.exec(nim.trim())
  if (!m) throw new RangeError(`invalid NIM amount: ${nim}`)
  const whole = BigInt(m[1])
  const frac = BigInt((m[2] ?? '').padEnd(5, '0') || '0')
  return whole * LUNA_PER_NIM + frac
}

export function lunaToNim(luna: bigint): string {
  if (luna < 0n) throw new RangeError('negative luna')
  const whole = luna / LUNA_PER_NIM
  const frac = (luna % LUNA_PER_NIM).toString().padStart(5, '0').replace(/0+$/, '')
  return frac ? `${whole}.${frac}` : whole.toString()
}

export function parseLunaString(s: string): bigint {
  if (!/^\d+$/.test(s.trim())) throw new RangeError(`invalid luna string: ${s}`)
  return BigInt(s.trim())
}
