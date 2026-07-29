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
