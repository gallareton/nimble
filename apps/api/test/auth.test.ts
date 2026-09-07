import { afterAll, expect, it } from 'vitest'
import { buildApp } from '../src/app'
import { SessionEvents } from '../src/services/events'
import { freshDb } from './helpers/db'
import { loginMessage } from '../src/services/nimiqAuth'
import { env } from '../src/env'

const { db, close } = await freshDb()
const okVerifier = { verify: async () => ({ valid: true, address: 'NQ52 TEST ADDR' }) }
const badVerifier = { verify: async () => ({ valid: false, address: null }) }
afterAll(close)

it('challenge → verify issues JWT and creates profile', async () => {
  const app = buildApp({ db, verifier: okVerifier, events: new SessionEvents() })
  const ch = await app.inject({ method: 'POST', url: '/v1/auth/challenge' })
  expect(ch.statusCode).toBe(200)
  const { nonce } = ch.json()
  const v = await app.inject({ method: 'POST', url: '/v1/auth/verify',
    payload: { nonce, publicKey: 'aa', signature: 'bb' } })
  expect(v.statusCode).toBe(200)
  expect(v.json().token).toBeTruthy()
  expect(v.json().address).toBe('NQ52 TEST ADDR')
})

it('rejects bad signature and reused nonce', async () => {
  const app = buildApp({ db, verifier: badVerifier, events: new SessionEvents() })
  const { nonce } = (await app.inject({ method: 'POST', url: '/v1/auth/challenge' })).json()
  const v = await app.inject({ method: 'POST', url: '/v1/auth/verify',
    payload: { nonce, publicKey: 'aa', signature: 'bb' } })
  expect(v.statusCode).toBe(401)

  const app2 = buildApp({ db, verifier: okVerifier, events: new SessionEvents() })
  const { nonce: n2 } = (await app2.inject({ method: 'POST', url: '/v1/auth/challenge' })).json()
  await app2.inject({ method: 'POST', url: '/v1/auth/verify', payload: { nonce: n2, publicKey: 'a', signature: 'b' } })
  const replay = await app2.inject({ method: 'POST', url: '/v1/auth/verify', payload: { nonce: n2, publicKey: 'a', signature: 'b' } })
  expect(replay.statusCode).toBe(401)
})

it('protected route rejects missing token', async () => {
  const app = buildApp({ db, verifier: okVerifier, events: new SessionEvents() })
  app.get('/protected', { preHandler: app.authenticate }, async req => req.user)
  const r = await app.inject({ url: '/protected' })
  expect(r.statusCode).toBe(401)
})

it('the signed message names the origin and is built once for both endpoints', async () => {
  // The attack this closes: with a bare "NIMble login <nonce>" an attacker
  // could take a nonce from our challenge endpoint, get the victim to sign
  // that string in some other Mini App, and replay it here.
  const app = buildApp({ db, verifier: okVerifier, events: new SessionEvents() })
  const res = await app.inject({ method: 'POST', url: '/v1/auth/challenge' })
  const { nonce, message } = res.json()

  expect(message).toContain(env.appOrigin)
  expect(message).toContain(nonce)
  // The wallet shows this to a human, so it has to say what signing does.
  expect(message).toMatch(/moves no funds/i)

  // Challenge and verification must derive the bytes from the same function:
  // if they ever drift, every real login breaks while a stale copy still
  // verifies. loginMessage() is that single source.
  expect(message).toBe(loginMessage(nonce))
})
