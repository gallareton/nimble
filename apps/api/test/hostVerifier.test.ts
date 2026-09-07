import { describe, expect, it } from 'vitest'
import { Hash, KeyPair } from '@nimiq/core'
import { nimiqHostVerifier } from '../src/services/nimiqAuth'
import { env } from '../src/env'

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

describe('nimiqHostVerifier', () => {
  const nonce = 'dcf6750ed9a9e74b4850d4ade9b6a5f9'

  it('accepts a correct signature and returns the wallet address as subject and payoutAddress', async () => {
    const kp = KeyPair.generate()
    const message = nimiqHostVerifier.challenge(nonce)!
    const sig = kp.sign(signedMessageDigest(message))
    const identity = await nimiqHostVerifier.verify({
      scheme: nimiqHostVerifier.scheme,
      nonce,
      payload: { publicKey: kp.publicKey.toHex(), signature: sig.toHex() },
    })
    const address = kp.toAddress().toUserFriendlyAddress()
    expect(identity).toEqual({ subject: address, payoutAddress: address })
  })

  it('rejects a bad signature', async () => {
    const kp = KeyPair.generate()
    const sig = kp.sign(signedMessageDigest('some other message'))
    const identity = await nimiqHostVerifier.verify({
      scheme: nimiqHostVerifier.scheme,
      nonce,
      payload: { publicKey: kp.publicKey.toHex(), signature: sig.toHex() },
    })
    expect(identity).toBeNull()
  })

  it('challenge names the origin, the nonce, and that signing moves no funds', () => {
    const message = nimiqHostVerifier.challenge(nonce)!
    expect(message).toContain(env.appOrigin)
    expect(message).toContain(nonce)
    expect(message).toMatch(/moves no funds/i)
  })
})
