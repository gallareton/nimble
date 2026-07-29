import { describe, expect, it, vi } from 'vitest'
import { uuid } from '../src/lib/uuid'

const V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

describe('uuid', () => {
  it('returns a v4 uuid when crypto.randomUUID exists', () => {
    expect(uuid()).toMatch(V4)
  })

  it('falls back to getRandomValues when randomUUID is missing (insecure context)', () => {
    const spy = vi.spyOn(crypto, 'randomUUID' as never).mockImplementation((() => {
      throw new Error('should not be called')
    }) as never)
    Object.defineProperty(crypto, 'randomUUID', { value: undefined, configurable: true })
    try {
      const ids = new Set([uuid(), uuid(), uuid()])
      for (const id of ids) expect(id).toMatch(V4)
      expect(ids.size).toBe(3)
    } finally {
      spy.mockRestore()
    }
  })
})
