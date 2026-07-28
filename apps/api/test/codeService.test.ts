import { expect, it } from 'vitest'
import { generateCode, hashCode } from '../src/services/codeService'

it('generates exactly 6 digits, uniform-ish', () => {
  for (let i = 0; i < 1000; i++) expect(generateCode()).toMatch(/^\d{6}$/)
  const many = new Set(Array.from({ length: 1000 }, generateCode))
  expect(many.size).toBeGreaterThan(900)
})
it('hash is deterministic, pepper-dependent, never the code', () => {
  expect(hashCode('482731', 'p')).toBe(hashCode('482731', 'p'))
  expect(hashCode('482731', 'p')).not.toBe(hashCode('482731', 'q'))
  expect(hashCode('482731', 'p')).not.toContain('482731')
})
