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

it('replays a deterministic 4xx from the handler', async () => {
  let calls = 0
  const run = () => withIdempotency(db, 'test', 'k3', 'req-a', async () => {
    calls++
    return { code: 409, body: { error: { code: 'CONFLICT', message: 'nope' } } }
  })
  const first = await run()
  const second = await run()
  expect(calls).toBe(1)
  expect(first).toMatchObject({ code: 409, replayed: false })
  expect(second).toMatchObject({ code: 409, replayed: true })
  expect(second.body).toEqual(first.body)
})

it('does not persist a 5xx — the same key gets a fresh attempt, not a permanent replay', async () => {
  let calls = 0
  type Body = { error?: { code: string; message: string }; chargeId?: string }
  const run = () => withIdempotency<Body>(db, 'test', 'k4', 'req-a', async () => {
    calls++
    // first call fails transiently (e.g. a rate provider outage); second
    // call, same key, succeeds once the dependency recovers
    if (calls === 1) return { code: 503, body: { error: { code: 'NO_RATE', message: 'no rate' } } }
    return { code: 201, body: { chargeId: 'c1' } }
  })
  const first = await run()
  expect(first).toMatchObject({ code: 503, replayed: false })

  const second = await run()
  expect(second).toMatchObject({ code: 201, body: { chargeId: 'c1' }, replayed: false })
  expect(calls).toBe(2) // the 503 was not replayed — the handler ran again

  // and now that a 2xx is stored, a further retry with the same key replays it
  const third = await run()
  expect(third).toMatchObject({ code: 201, body: { chargeId: 'c1' }, replayed: true })
  expect(calls).toBe(2)
})
