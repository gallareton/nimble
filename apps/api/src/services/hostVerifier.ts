/**
 * Host-agnostic identity boundary.
 *
 * The interface this replaced took (message, publicKey, signature), which
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
  /** Stable identity key, unique within its scheme. */
  subject: string
  /** Where this user takes payment, or null when the host does not know one. */
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

// What this boundary does NOT yet make possible, so nobody reads "adapter
// done" and walks into a wall. Adding a second scheme needs, in this order:
//
//   1. An identity key of (scheme, subject). Today user_profile.wallet_address
//      is the key — not null, unique, with no scheme column — so two schemes
//      could produce colliding subjects.
//   2. A storable `payoutAddress: null`. wallet_address is NOT NULL, so a host
//      that cannot name an address has nowhere to live; routes/auth.ts refuses
//      that case loudly on purpose.
//   3. A registry keyed by scheme. AppDeps holds exactly one verifier, and the
//      wire format still carries Nimiq's shape (see the note in routes/auth.ts
//      on why generalising it early costs users a 400 for no benefit).
//
// Full reasoning: private/docs/specs/2026-09-07-host-adapter-boundary.md §4.1.
