import { afterAll, expect, it } from 'vitest'
import { buildApp } from '../src/app'
import { freshDb } from './helpers/db'

const { db, close } = await freshDb()
const okVerifier = { verify: async () => ({ valid: true, address: 'NQ52 TEST ADDR' }) }
const badVerifier = { verify: async () => ({ valid: false, address: null }) }
afterAll(close)

it('challenge → verify issues JWT and creates profile', async () => {
  const app = buildApp({ db, verifier: okVerifier })
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
  const app = buildApp({ db, verifier: badVerifier })
  const { nonce } = (await app.inject({ method: 'POST', url: '/v1/auth/challenge' })).json()
  const v = await app.inject({ method: 'POST', url: '/v1/auth/verify',
    payload: { nonce, publicKey: 'aa', signature: 'bb' } })
  expect(v.statusCode).toBe(401)

  const app2 = buildApp({ db, verifier: okVerifier })
  const { nonce: n2 } = (await app2.inject({ method: 'POST', url: '/v1/auth/challenge' })).json()
  await app2.inject({ method: 'POST', url: '/v1/auth/verify', payload: { nonce: n2, publicKey: 'a', signature: 'b' } })
  const replay = await app2.inject({ method: 'POST', url: '/v1/auth/verify', payload: { nonce: n2, publicKey: 'a', signature: 'b' } })
  expect(replay.statusCode).toBe(401)
})

it('protected route rejects missing token', async () => {
  const app = buildApp({ db, verifier: okVerifier })
  app.get('/protected', { preHandler: app.authenticate }, async req => req.user)
  const r = await app.inject({ url: '/protected' })
  expect(r.statusCode).toBe(401)
})
