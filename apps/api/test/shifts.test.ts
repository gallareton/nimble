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

it('exports RFC 4180 CSV with a BOM, CRLF and the rate columns', async () => {
  const { t } = await vendor()
  const { id } = (await app.inject({ method: 'POST', url: '/v1/shifts',
    payload: { operatorLabel: 'Ana, "the boss"' }, headers: auth(t) })).json()
  await app.inject({ method: 'POST', url: `/v1/shifts/${id}/close`, headers: auth(t) })

  const res = await app.inject({ url: `/v1/shifts/${id}/export`, headers: auth(t) })
  expect(res.statusCode).toBe(200)
  expect(res.headers['content-type']).toContain('text/csv')
  expect(res.headers['content-disposition']).toContain('attachment; filename="nimble-shift-')
  expect(res.body.startsWith('﻿')).toBe(true)
  const [header] = res.body.slice(1).split('\r\n')
  expect(header).toBe('local_number,occurred_at_utc,status,amount_fiat_minor,fiat_currency,' +
    'amount_crypto,asset,network,tx_hash,fx_rate,fx_rate_at,fx_source,reference,operator,shift_id')

  const json = await app.inject({ url: `/v1/shifts/${id}/export?format=json`, headers: auth(t) })
  expect(json.json().shift.operatorLabel).toBe('Ana, "the boss"')
})

it('open shifts get -open suffix in export filename, closed shifts do not', async () => {
  const { t } = await vendor()
  const { id } = (await app.inject({ method: 'POST', url: '/v1/shifts',
    payload: { operatorLabel: 'Bob' }, headers: auth(t) })).json()

  // Export while still open
  const openRes = await app.inject({ url: `/v1/shifts/${id}/export`, headers: auth(t) })
  expect(openRes.statusCode).toBe(200)
  expect(openRes.headers['content-disposition']).toContain('-open.csv')

  // Close the shift
  await app.inject({ method: 'POST', url: `/v1/shifts/${id}/close`, headers: auth(t) })

  // Export after closing
  const closedRes = await app.inject({ url: `/v1/shifts/${id}/export`, headers: auth(t) })
  expect(closedRes.statusCode).toBe(200)
  expect(closedRes.headers['content-disposition']).not.toContain('-open')
})
