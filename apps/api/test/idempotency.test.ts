import { afterAll, expect, it } from 'vitest'
import { withIdempotency } from '../src/plugins/idempotency'
import { freshDb } from './helpers/db'

const { db, close } = await freshDb()
afterAll(close)

it('executes once and replays stored response', async () => {
  let calls = 0
  const run = () => withIdempotency(db, 'test', 'k1', 'req-a', async () => {
    calls++
    return { code: 201, body: { ok: calls } }
  })
  const first = await run()
  const second = await run()
  expect(calls).toBe(1)
  expect(first.replayed).toBe(false)
  expect(second).toMatchObject({ code: 201, body: { ok: 1 }, replayed: true })
})

it('rejects key reuse with different payload', async () => {
  await withIdempotency(db, 'test', 'k2', 'req-a', async () => ({ code: 200, body: {} }))
  const res = await withIdempotency(db, 'test', 'k2', 'req-B', async () => ({ code: 200, body: {} }))
  expect(res.code).toBe(409)
})
