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
