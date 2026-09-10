import { afterAll, expect, it } from 'vitest'
import { freshDb } from './helpers/db'
import { authedApp, makeUser } from './helpers/actors'

const { db, close } = await freshDb()
const { app, tokenFor } = authedApp(db)
afterAll(close)

async function vendor() {
  const u = await makeUser(db, `NQ70 ${crypto.randomUUID().slice(0, 8)}`)
  return { u, t: await tokenFor(u) }
}
const auth = (t: string) => ({ authorization: `Bearer ${t}` })
const idem = (t: string) => ({ authorization: `Bearer ${t}`, 'idempotency-key': crypto.randomUUID() })

const create = (t: string, payload: object) =>
  app.inject({ method: 'POST', url: '/v1/products', payload, headers: idem(t) })
const list = (t: string) => app.inject({ url: '/v1/products', headers: auth(t) })
const patch = (t: string, id: string, payload: object) =>
  app.inject({ method: 'PATCH', url: `/v1/products/${id}`, payload, headers: auth(t) })

it('creates a product and lists it', async () => {
  const { t } = await vendor()
  const res = await create(t, { name: 'Coffee', priceMinor: 350 })
  expect(res.statusCode).toBe(201)
  expect(res.json()).toMatchObject({ name: 'Coffee', priceMinor: 350, pinned: false, active: true })

  const res2 = await list(t)
  expect(res2.statusCode).toBe(200)
  const items = res2.json()
  expect(items).toHaveLength(1)
  expect(items[0].id).toBe(res.json().id)
})

it('edits price and pinned', async () => {
  const { t } = await vendor()
  const created = (await create(t, { name: 'Tea', priceMinor: 250 })).json()
  const res = await patch(t, created.id, { priceMinor: 300, pinned: true })
  expect(res.statusCode).toBe(200)
  expect(res.json()).toMatchObject({ priceMinor: 300, pinned: true })
})

it('hides another vendor\'s product from PATCH but not from their own list', async () => {
  const a = await vendor()
  const b = await vendor()
  const created = (await create(a.t, { name: 'Cake', priceMinor: 500 })).json()

  const res = await patch(b.t, created.id, { priceMinor: 1 })
  expect(res.statusCode).toBe(404)

  const bList = await list(b.t)
  expect(bList.json()).toHaveLength(0)
  const aList = await list(a.t)
  expect(aList.json()).toHaveLength(1)
})

it('keeps a withdrawn product on the list with active=false', async () => {
  const { t } = await vendor()
  const created = (await create(t, { name: 'Muffin', priceMinor: 400 })).json()
  const res = await patch(t, created.id, { active: false })
  expect(res.statusCode).toBe(200)
  expect(res.json().active).toBe(false)

  const items = (await list(t)).json()
  expect(items).toHaveLength(1)
  expect(items[0].active).toBe(false)
})

it('rejects a negative price and a float price', async () => {
  const { t } = await vendor()
  const neg = await create(t, { name: 'Bad', priceMinor: -1 })
  expect(neg.statusCode).toBe(400)
  const float = await create(t, { name: 'Bad', priceMinor: 2.5 })
  expect(float.statusCode).toBe(400)
})

it('sorts pinned items first, then sortOrder, then name', async () => {
  const { t } = await vendor()
  await create(t, { name: 'Zebra', priceMinor: 100, sortOrder: 0 })
  await create(t, { name: 'Apple', priceMinor: 100, sortOrder: 1 })
  const pinned = (await create(t, { name: 'Mango', priceMinor: 100, sortOrder: 5 })).json()
  await patch(t, pinned.id, { pinned: true })

  const items = (await list(t)).json()
  expect(items.map((p: { name: string }) => p.name)).toEqual(['Mango', 'Zebra', 'Apple'])
})
