import { afterAll, expect, it } from 'vitest'
import { freshDb } from './helpers/db'
import { authedApp, makeUser } from './helpers/actors'

const { db, close } = await freshDb()
const { app, tokenFor } = authedApp(db)
afterAll(close)

it('GET /v1/me returns the saved profile', async () => {
  const u = await makeUser(db, `NQ40 ${crypto.randomUUID().slice(0, 8)}`)
  const t = await tokenFor(u)

  let r = await app.inject({ url: '/v1/me', headers: { authorization: `Bearer ${t}` } })
  expect(r.statusCode).toBe(200)
  expect(r.json()).toEqual({ walletAddress: u.walletAddress, displayName: null })

  await app.inject({ method: 'PATCH', url: '/v1/me', payload: { displayName: 'Gall' },
    headers: { authorization: `Bearer ${t}` } })
  r = await app.inject({ url: '/v1/me', headers: { authorization: `Bearer ${t}` } })
  expect(r.json()).toEqual({ walletAddress: u.walletAddress, displayName: 'Gall' })
})

it('GET /v1/me requires auth', async () => {
  const r = await app.inject({ url: '/v1/me' })
  expect(r.statusCode).toBe(401)
})

it('login issues a refresh token; refresh rotates it and returns a fresh JWT', async () => {
  const addr = `NQ42 ${crypto.randomUUID().slice(0, 8)}`
  const rApp = authedApp(db, addr)
  const c = (await rApp.app.inject({ method: 'POST', url: '/v1/auth/challenge' })).json()
  const v = await rApp.app.inject({ method: 'POST', url: '/v1/auth/verify',
    payload: { nonce: c.nonce, publicKey: 'aa'.repeat(32), signature: 'bb'.repeat(64) } })
  expect(v.statusCode).toBe(200)
  const { token, refreshToken } = v.json()
  expect(refreshToken).toBeTruthy()

  const r1 = await rApp.app.inject({ method: 'POST', url: '/v1/auth/refresh',
    payload: { refreshToken } })
  expect(r1.statusCode).toBe(200)
  const next = r1.json()
  expect(next.token).toBeTruthy()
  expect(next.refreshToken).not.toBe(refreshToken)
  // new JWT works against an authenticated route
  const me = await rApp.app.inject({ url: '/v1/me',
    headers: { authorization: `Bearer ${next.token}` } })
  expect(me.statusCode).toBe(200)
  // rotation: the consumed refresh token is dead
  const r2 = await rApp.app.inject({ method: 'POST', url: '/v1/auth/refresh',
    payload: { refreshToken } })
  expect(r2.statusCode).toBe(401)
  void token
})

it('POST /v1/auth/refresh rejects an unknown refresh token', async () => {
  const r = await app.inject({ method: 'POST', url: '/v1/auth/refresh',
    payload: { refreshToken: 'ff'.repeat(32) } })
  expect(r.statusCode).toBe(401)
})
