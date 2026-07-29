import { SignJWT } from 'jose'
import { buildApp } from '../../src/app'
import { userProfile } from '../../src/db/schema'
import { env } from '../../src/env'
import { SessionEvents } from '../../src/services/events'
import type { Db } from '../../src/db/client'

export async function makeUser(db: Db, address: string) {
  const [u] = await db.insert(userProfile).values({ walletAddress: address })
    .onConflictDoUpdate({ target: userProfile.walletAddress, set: { walletAddress: address } }).returning()
  return u
}
export function authedApp(db: Db, verifiedAddress = 'NQ00') {
  const app = buildApp({ db, verifier: { verify: async () => ({ valid: true, address: verifiedAddress }) },
    events: new SessionEvents() })
  const tokenFor = (u: { id: string; walletAddress: string }) =>
    new SignJWT({ addr: u.walletAddress }).setProtectedHeader({ alg: 'HS256' })
      .setSubject(u.id).setExpirationTime('1h').sign(new TextEncoder().encode(env.jwtSecret))
  return { app, tokenFor }
}
