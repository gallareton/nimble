import { env } from '../env'
import type { HostCredential, HostIdentity, HostVerifier } from './hostVerifier'

export interface SignatureVerifier {
  verify(message: string, publicKeyHex: string, signatureHex: string):
    Promise<{ valid: boolean; address: string | null }>
}

// Real implementation. Byte format verified on device (Task 16): Nimiq Pay
// signs the Keyguard "Signed Message" digest, not the raw message bytes:
//   sha256('\x16Nimiq Signed Message:\n' + byteLength + message)
// Raw utf-8 is kept as a fallback candidate for other wallet implementations.
export const nimiqVerifier: SignatureVerifier = {
  async verify(message, publicKeyHex, signatureHex) {
    try {
      const { Hash, PublicKey, Signature } = await import('@nimiq/core')
      const pk = PublicKey.fromHex(publicKeyHex)
      const sig = Signature.fromHex(signatureHex)

      const body = new TextEncoder().encode(message)
      const prefix = new TextEncoder().encode(`\x16Nimiq Signed Message:\n${body.length}`)
      const prefixed = new Uint8Array(prefix.length + body.length)
      prefixed.set(prefix)
      prefixed.set(body, prefix.length)

      const candidates = [Hash.computeSha256(prefixed), body]
      const valid = candidates.some((data) => pk.verify(sig, data))
      return { valid, address: valid ? pk.toAddress().toUserFriendlyAddress() : null }
    } catch { return { valid: false, address: null } }
  },
}

/**
 * The exact bytes the wallet is asked to sign.
 *
 * Built in one place and used by both the challenge and the verification: the
 * two used to carry the same string literal written out twice, which is a
 * drift waiting to happen.
 *
 * The origin is named so a person signing this in some other Mini App can see
 * who is really asking. Without it the message was just "NIMble login <nonce>",
 * and an attacker could take a nonce from our challenge endpoint, get a victim
 * to sign that string somewhere else, and replay it here as a login. The
 * origin comes from configuration, never from a request header — the header is
 * the attacker's to set.
 */
export function loginMessage(nonce: string): string {
  return [
    `Sign in to ${env.appOrigin}`,
    '',
    'Signing proves you own this wallet. It moves no funds and approves no',
    'payment. If you did not just open this site, do not sign.',
    '',
    `Origin: ${env.appOrigin}`,
    `Nonce: ${nonce}`,
  ].join('\n')
}

// Adapter from the Nimiq wallet-signature world to the host-agnostic
// boundary: a signed login message is one instance of "prove identity",
// not the only shape a host can take.
export const nimiqHostVerifier: HostVerifier = {
  scheme: 'nimiq-signed-message',
  challenge(nonce) {
    return loginMessage(nonce)
  },
  async verify(credential: HostCredential): Promise<HostIdentity | null> {
    const { publicKey, signature } = credential.payload
    if (!publicKey || !signature) return null
    const { valid, address } = await nimiqVerifier.verify(
      loginMessage(credential.nonce), publicKey, signature)
    if (!valid || !address) return null
    return { subject: address, payoutAddress: address }
  },
}
