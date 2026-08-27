import { afterAll, expect, it } from 'vitest'
import { freshDb } from './helpers/db'
import { authedApp, makeUser } from './helpers/actors'

const { db, close } = await freshDb()
const { app, tokenFor } = authedApp(db)
afterAll(close)

async function vendor() {
  const u = await makeUser(db, `NQ50 ${crypto.randomUUID().slice(0, 8)}`)
  return { u, t: await tokenFor(u) }
}
const auth = (t: string) => ({ authorization: `Bearer ${t}` })

it('opens one shift, refuses a second, closes it and reports', async () => {
  const { t } = await vendor()
  const open = await app.inject({ method: 'POST', url: '/v1/shifts',
    payload: { operatorLabel: 'Ana' }, headers: auth(t) })
  expect(open.statusCode).toBe(201)
  expect(open.json().operatorLabel).toBe('Ana')
  expect(open.json().closedAt).toBeNull()

  const second = await app.inject({ method: 'POST', url: '/v1/shifts',
    payload: { operatorLabel: 'Bo' }, headers: auth(t) })
  expect(second.statusCode).toBe(409)
  expect(second.json().error.code).toBe('SHIFT_OPEN')

  const current = await app.inject({ url: '/v1/shifts/current', headers: auth(t) })
  expect(current.json().id).toBe(open.json().id)

  const closed = await app.inject({ method: 'POST', url: `/v1/shifts/${open.json().id}/close`,
    headers: auth(t) })
  expect(closed.statusCode).toBe(200)
  expect(closed.json().shift.closedAt).not.toBeNull()
  expect(closed.json().totals.count).toBe(0)

  expect((await app.inject({ url: '/v1/shifts/current', headers: auth(t) })).statusCode).toBe(404)
})

it('a closed shift reports the same numbers every time it is asked', async () => {
  const { t } = await vendor()
  const { id } = (await app.inject({ method: 'POST', url: '/v1/shifts',
    payload: { operatorLabel: 'Ana' }, headers: auth(t) })).json()
  await app.inject({ method: 'POST', url: `/v1/shifts/${id}/close`, headers: auth(t) })
  const a = (await app.inject({ url: `/v1/shifts/${id}/report`, headers: auth(t) })).json()
  const b = (await app.inject({ url: `/v1/shifts/${id}/report`, headers: auth(t) })).json()
  expect(a).toEqual(b)
})

it('a vendor cannot read another vendor shift', async () => {
  const a = await vendor(); const b = await vendor()
  const { id } = (await app.inject({ method: 'POST', url: '/v1/shifts',
    payload: { operatorLabel: 'Ana' }, headers: auth(a.t) })).json()
  expect((await app.inject({ url: `/v1/shifts/${id}/report`, headers: auth(b.t) })).statusCode).toBe(404)
})
