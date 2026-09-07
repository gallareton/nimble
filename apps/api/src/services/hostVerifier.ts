/**
 * Host-agnostic identity boundary.
 *
 * `SignatureVerifier` (see nimiqAuth.ts) bakes in the assumption that a host
 * proves identity with an Ed25519 signature over a message. That's true for
 * a wallet signing a login message, but Telegram proves identity with an
 * HMAC over `initData` keyed by the bot secret — there is no `publicKey` and
 * no `signature` in our sense. `HostVerifier` sits one level up: it takes an
 * opaque credential shaped however the host shapes it, and returns an
 * identity or nothing.
 */

export interface HostCredential {
  scheme: string
  nonce: string
  payload: Record<string, string>
}

export interface HostIdentity {
  /** Stabilny klucz tożsamości, unikalny w obrębie schematu. */
  subject: string
  /** Adres, na który użytkownik przyjmuje płatności — null, gdy host go nie zna. */
  payoutAddress: string | null
}

export interface HostVerifier {
  readonly scheme: string
  /**
   * Returning `null` does NOT mean "no replay protection" — it means "this
   * scheme protects itself against replay and our nonce is not part of
   * that protection." Telegram's initData carries its own `auth_date`; our
   * nonce would be meaningless to it. The route treats a null challenge as
   * a signal to skip consuming a nonce for this scheme, so a verifier that
   * returns null here MUST supply its own replay defense inside `verify()`
   * — otherwise this opens a hole where a captured credential can be
   * replayed indefinitely.
   */
  challenge(nonce: string): string | null
  verify(credential: HostCredential): Promise<HostIdentity | null>
}
