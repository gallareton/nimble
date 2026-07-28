import { createHmac, randomInt } from 'node:crypto'

export function generateCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, '0')
}
export function hashCode(code: string, pepper: string): string {
  return createHmac('sha256', pepper).update(code).digest('hex')
}
