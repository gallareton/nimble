import { describe, expect, it } from 'vitest'
import { Hash, KeyPair } from '@nimiq/core'
import { nimiqVerifier } from '../src/services/nimiqAuth'

// Keyguard/Hub "Nimiq Signed Message" format: the wallet signs
// sha256('\x16Nimiq Signed Message:\n' + byteLength + message)
function signedMessageDigest(message: string): Uint8Array {
  const body = new TextEncoder().encode(message)
  const prefix = new TextEncoder().encode(`\x16Nimiq Signed Message:\n${body.length}`)
  const data = new Uint8Array(prefix.length + body.length)
  data.set(prefix)
  data.set(body, prefix.length)
  return Hash.computeSha256(data)
}

describe('nimiqVerifier', () => {
  const msg = 'NIMble login dcf6750ed9a9e74b4850d4ade9b6a5f9'

  it('accepts a Keyguard-style prefixed+hashed signature (Nimiq Pay)', async () => {
    const kp = KeyPair.generate()
    const sig = kp.sign(signedMessageDigest(msg))
    const res = await nimiqVerifier.verify(msg, kp.publicKey.toHex(), sig.toHex())
    expect(res.valid).toBe(true)
    expect(res.address).toBe(kp.toAddress().toUserFriendlyAddress())
  })

  it('still accepts a signature over raw utf-8 bytes', async () => {
    const kp = KeyPair.generate()
    const sig = kp.sign(new TextEncoder().encode(msg))
    const res = await nimiqVerifier.verify(msg, kp.publicKey.toHex(), sig.toHex())
    expect(res.valid).toBe(true)
  })

  it('rejects a signature made over a different message', async () => {
    const kp = KeyPair.generate()
    const sig = kp.sign(signedMessageDigest('some other message'))
    const res = await nimiqVerifier.verify(msg, kp.publicKey.toHex(), sig.toHex())
    expect(res.valid).toBe(false)
    expect(res.address).toBeNull()
  })
})
