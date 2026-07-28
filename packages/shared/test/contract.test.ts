import { describe, expect, it } from 'vitest'
import { ClaimRequest, CreateChargeRequest, LunaString } from '../src/contract'

describe('contract', () => {
  it('LunaString accepts digits only', () => {
    expect(LunaString.safeParse('123').success).toBe(true)
    expect(LunaString.safeParse('1.5').success).toBe(false)
    expect(LunaString.safeParse('-1').success).toBe(false)
  })
  it('ClaimRequest requires exactly 6 digits', () => {
    expect(ClaimRequest.safeParse({ code: '482731' }).success).toBe(true)
    expect(ClaimRequest.safeParse({ code: '48273' }).success).toBe(false)
    expect(ClaimRequest.safeParse({ code: '48273a' }).success).toBe(false)
  })
  it('CreateChargeRequest bounds reference and requires positive amount', () => {
    expect(CreateChargeRequest.safeParse({ amountLuna: '100000', reference: 'Soda' }).success).toBe(true)
    expect(CreateChargeRequest.safeParse({ amountLuna: '0' }).success).toBe(false)
    expect(CreateChargeRequest.safeParse({ amountLuna: '1', reference: 'x'.repeat(101) }).success).toBe(false)
  })
})
