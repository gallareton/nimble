import { describe, expect, it } from 'vitest'
import { lunaToNim, nimToLuna, parseLunaString } from '../src/luna'

describe('nimToLuna', () => {
  it('converts whole NIM', () => expect(nimToLuna('1')).toBe(100_000n))
  it('converts 5 decimals', () => expect(nimToLuna('0.00001')).toBe(1n))
  it('converts mixed', () => expect(nimToLuna('12.34567')).toBe(1_234_567n))
  it('rejects 6 decimals', () => expect(() => nimToLuna('0.000001')).toThrow(RangeError))
  it('rejects negatives', () => expect(() => nimToLuna('-1')).toThrow(RangeError))
  it('rejects junk', () => expect(() => nimToLuna('1e5')).toThrow(RangeError))
})
describe('lunaToNim', () => {
  it('renders trimmed', () => expect(lunaToNim(150_000n)).toBe('1.5'))
  it('renders whole', () => expect(lunaToNim(100_000n)).toBe('1'))
  it('renders sub-NIM', () => expect(lunaToNim(1n)).toBe('0.00001'))
})
describe('parseLunaString', () => {
  it('parses', () => expect(parseLunaString('1234567890123')).toBe(1_234_567_890_123n))
  it('rejects decimals', () => expect(() => parseLunaString('1.5')).toThrow(RangeError))
  it('rejects negative', () => expect(() => parseLunaString('-3')).toThrow(RangeError))
})
