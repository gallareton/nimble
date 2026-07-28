export interface SignatureVerifier {
  verify(message: string, publicKeyHex: string, signatureHex: string):
    Promise<{ valid: boolean; address: string | null }>
}

// Real implementation. Byte format assumption verified on device in Task 16.
export const nimiqVerifier: SignatureVerifier = {
  async verify(message, publicKeyHex, signatureHex) {
    try {
      const { PublicKey, Signature } = await import('@nimiq/core')
      const pk = PublicKey.fromHex(publicKeyHex)
      const sig = Signature.fromHex(signatureHex)
      const data = new TextEncoder().encode(message)
      const valid = pk.verify(sig, data)
      return { valid, address: valid ? pk.toAddress().toUserFriendlyAddress() : null }
    } catch { return { valid: false, address: null } }
  },
}
