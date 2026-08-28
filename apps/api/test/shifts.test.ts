import { eq } from 'drizzle-orm'
import { afterAll, expect, it } from 'vitest'
import { chainTransaction, charge } from '../src/db/schema'
import { monitorTick } from '../src/services/monitor'
import { SessionEvents } from '../src/services/events'
import { FX_BUFFER_BPS } from '../src/services/pricing'
import { freshDb } from './helpers/db'
import { authedApp, makeUser } from './helpers/actors'

const { db, close } = await freshDb()
const { app, tokenFor } = authedApp(db)
// A working quote so fiat-priced charges have something to freeze — the
// reproducibility and reconciliation tests below need a CONFIRMED, fiat-priced
// sale, which needs a rate.
app.deps.rates = {
  getUsdPerNim: async () => 0.004,
  quoteUsdPerNim: async () => ({ value: 0.004, at: new Date().toISOString(), source: 'test-fixture' }),
}
afterAll(close)

async function vendor() {
  const u = await makeUser(db, `NQ50 ${crypto.randomUUID().slice(0, 8)}`)
  return { u, t: await tokenFor(u) }
}
const auth = (t: string) => ({ authorization: `Bearer ${t}` })

/**
 * Drives a fiat-priced charge to CONFIRMED the way the chain actually does it
 * (there is no /confirm route): register a chain transaction directly, then
 * run the monitor with a stub chain client through inclusion and finality,
 * same approach as monitor.test.ts.
 */
async function confirmFiatSale(shiftId: string, rt: string, fiatAmountMinor: number) {
  const payer = await makeUser(db, `NQ55 ${crypto.randomUUID().slice(0, 8)}`)
  const pt = await tokenFor(payer)
  const { code, sessionId } = (await app.inject({ method: 'POST', url: '/v1/sessions',
    headers: { authorization: `Bearer ${pt}`, 'idempotency-key': crypto.randomUUID() } })).json()
  await app.inject({ method: 'POST', url: '/v1/sessions/claim', payload: { code },
    headers: { authorization: `Bearer ${rt}`, 'idempotency-key': crypto.randomUUID() } })
  const chargeRes = await app.inject({ method: 'POST', url: `/v1/sessions/${sessionId}/charges`,
    payload: { fiatAmountMinor, fiatCurrency: 'USD', reference: 'Coffee' },
    headers: { authorization: `Bearer ${rt}`, 'idempotency-key': crypto.randomUUID() } })
  expect(chargeRes.statusCode).toBe(201)

  const [c] = await db.select().from(charge).where(eq(charge.sessionId, sessionId))
  expect(c.shiftId).toBe(shiftId)
  const [tx] = await db.insert(chainTransaction).values({ chargeId: c.id, sender: payer.walletAddress,
    recipient: c.recipientAddress, amountAtomic: c.amountAtomic, hash: crypto.randomUUID() }).returning()

  const events = new SessionEvents()
  let macro = 90
  const chain = {
    findIncomingByData: async () => null,
    getTransaction: async () => ({ includedAtHeight: 100, expired: false }),
    getLastMacroHeight: async () => macro,
  }
  await monitorTick(db, events, chain) // SUBMITTED → CONFIRMING
  macro = 120
  await monitorTick(db, events, chain) // CONFIRMING → CONFIRMED, receipts written

  return { sessionId, chargeId: c.id, txHash: tx.hash }
}

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

it('a closed shift with a confirmed fiat sale reports the same non-zero numbers every time it is asked', async () => {
  const { t } = await vendor()
  const { id } = (await app.inject({ method: 'POST', url: '/v1/shifts',
    payload: { operatorLabel: 'Ana' }, headers: auth(t) })).json()

  await confirmFiatSale(id, t, 1234)

  await app.inject({ method: 'POST', url: `/v1/shifts/${id}/close`, headers: auth(t) })
  const a = (await app.inject({ url: `/v1/shifts/${id}/report`, headers: auth(t) })).json()
  const b = (await app.inject({ url: `/v1/shifts/${id}/report`, headers: auth(t) })).json()
  expect(a).toEqual(b)

  expect(a.totals.confirmed).toBe(1)
  expect(a.totals.grossFiatMinor).toBe(1234)
  expect(Number(a.totals.grossNim)).toBeGreaterThan(0)

  const [entry] = a.entries
  expect(entry.status).toBe('CONFIRMED')
  expect(entry.amountFiatMinor).toBe(1234)
  expect(entry.fiatCurrency).toBe('USD')
  expect(entry.fxRate).toBe('0.004')
  expect(entry.fxRateAt).not.toBeNull()
  expect(entry.fxSource).toBe('test-fixture')
  expect(entry.fxBufferBps).toBe(FX_BUFFER_BPS)
  // occurredAt comes from the receipt snapshot written when the monitor
  // confirms the transaction, not from the charge's createdAt.
  expect(entry.occurredAt).not.toBeNull()
})

it('the fx buffer is its own column: (amount_fiat_minor / fx_rate) * (1 + fx_buffer_bps/10000) reconciles to amount_crypto', async () => {
  const { t } = await vendor()
  const { id } = (await app.inject({ method: 'POST', url: '/v1/shifts',
    payload: { operatorLabel: 'Ana' }, headers: auth(t) })).json()

  // 1234 minor units at a 0.004 quote: naive division gives 3085 NIM, but the
  // 50 bps merchant buffer means 3100.425 NIM was actually charged. Both
  // numbers have to be recoverable from the exported columns.
  await confirmFiatSale(id, t, 1234)
  await app.inject({ method: 'POST', url: `/v1/shifts/${id}/close`, headers: auth(t) })

  const res = await app.inject({ url: `/v1/shifts/${id}/export`, headers: auth(t) })
  expect(res.statusCode).toBe(200)
  const [header, dataRow] = res.body.slice(1).split('\r\n')
  const cols = header.split(',')
  const cells = dataRow.split(',')
  const cell = (name: string) => cells[cols.indexOf(name)]

  const amountFiatMinor = Number(cell('amount_fiat_minor'))
  const fxRate = Number(cell('fx_rate'))
  const fxBufferBps = Number(cell('fx_buffer_bps'))
  const amountCrypto = Number(cell('amount_crypto'))

  expect(amountFiatMinor).toBe(1234)
  expect(fxRate).toBe(0.004)
  expect(fxBufferBps).toBe(FX_BUFFER_BPS)

  // The buffer is padding on TOP of the raw quote (the merchant demands more
  // NIM per fiat unit to absorb FX risk), so it multiplies rather than
  // divides — see priceInLuna in src/services/pricing.ts.
  const expectedNim = (amountFiatMinor / 100 / fxRate) * (1 + fxBufferBps / 10_000)
  expect(Math.abs(amountCrypto - expectedNim)).toBeLessThan(0.0001) // ceil-rounding tolerance
  expect(amountCrypto).toBeCloseTo(3100.425, 3)
})

it('a vendor cannot read another vendor shift', async () => {
  const a = await vendor(); const b = await vendor()
  const { id } = (await app.inject({ method: 'POST', url: '/v1/shifts',
    payload: { operatorLabel: 'Ana' }, headers: auth(a.t) })).json()
  expect((await app.inject({ url: `/v1/shifts/${id}/report`, headers: auth(b.t) })).statusCode).toBe(404)
})

it('lists the caller\'s shifts newest first, with totals, honouring the cap', async () => {
  const { t } = await vendor()
  const ids: string[] = []
  for (const label of ['Ana', 'Bo', 'Cy']) {
    const { id } = (await app.inject({ method: 'POST', url: '/v1/shifts',
      payload: { operatorLabel: label }, headers: auth(t) })).json()
    await confirmFiatSale(id, t, 500)
    await app.inject({ method: 'POST', url: `/v1/shifts/${id}/close`, headers: auth(t) })
    ids.push(id)
  }

  const res = await app.inject({ url: '/v1/shifts', headers: auth(t) })
  expect(res.statusCode).toBe(200)
  const list = res.json()
  expect(list.map((s: { id: string }) => s.id)).toEqual([...ids].reverse())
  expect(list[0].operatorLabel).toBe('Cy')
  expect(list[0].confirmed).toBe(1)
  expect(Number(list[0].grossNim)).toBeGreaterThan(0)
  expect(list[0].closedAt).not.toBeNull()

  const capped = await app.inject({ url: '/v1/shifts?limit=2', headers: auth(t) })
  expect(capped.json().length).toBe(2)

  const overCap = await app.inject({ url: '/v1/shifts?limit=1000', headers: auth(t) })
  expect(overCap.json().length).toBeLessThanOrEqual(100)
  expect(overCap.json().length).toBe(3)
})

it('the shift list never includes another vendor\'s shifts', async () => {
  const a = await vendor(); const b = await vendor()
  const { id: idA } = (await app.inject({ method: 'POST', url: '/v1/shifts',
    payload: { operatorLabel: 'Ana' }, headers: auth(a.t) })).json()
  const { id: idB } = (await app.inject({ method: 'POST', url: '/v1/shifts',
    payload: { operatorLabel: 'Bo' }, headers: auth(b.t) })).json()
  await app.inject({ method: 'POST', url: `/v1/shifts/${idA}/close`, headers: auth(a.t) })
  await app.inject({ method: 'POST', url: `/v1/shifts/${idB}/close`, headers: auth(b.t) })

  const listA = (await app.inject({ url: '/v1/shifts', headers: auth(a.t) })).json()
  expect(listA.length).toBe(1)
  expect(listA[0].operatorLabel).toBe('Ana')
})

it('excludes the currently open shift from the list; it appears once closed', async () => {
  const { t } = await vendor()
  const { id } = (await app.inject({ method: 'POST', url: '/v1/shifts',
    payload: { operatorLabel: 'Ana' }, headers: auth(t) })).json()

  const openList = (await app.inject({ url: '/v1/shifts', headers: auth(t) })).json()
  expect(openList.find((s: { id: string }) => s.id === id)).toBeUndefined()

  await app.inject({ method: 'POST', url: `/v1/shifts/${id}/close`, headers: auth(t) })
  const closedList = (await app.inject({ url: '/v1/shifts', headers: auth(t) })).json()
  expect(closedList.find((s: { id: string }) => s.id === id)).toBeDefined()
})

it('the list\'s grossNim and confirmed agree with buildReport\'s totals for a mixed shift', async () => {
  const { t } = await vendor()
  const { id } = (await app.inject({ method: 'POST', url: '/v1/shifts',
    payload: { operatorLabel: 'Ana' }, headers: auth(t) })).json()

  // One CONFIRMED sale, driven to CONFIRMED the way the chain actually does it.
  await confirmFiatSale(id, t, 750)

  // A second sale that is created but never confirmed — status stays short of
  // CONFIRMED, so it must count toward totals.count but not totals.confirmed.
  const payer = await makeUser(db, `NQ60 ${crypto.randomUUID().slice(0, 8)}`)
  const pt = await tokenFor(payer)
  const { code, sessionId } = (await app.inject({ method: 'POST', url: '/v1/sessions',
    headers: { authorization: `Bearer ${pt}`, 'idempotency-key': crypto.randomUUID() } })).json()
  await app.inject({ method: 'POST', url: '/v1/sessions/claim', payload: { code },
    headers: { authorization: `Bearer ${t}`, 'idempotency-key': crypto.randomUUID() } })
  await app.inject({ method: 'POST', url: `/v1/sessions/${sessionId}/charges`,
    payload: { amountLuna: '100000', reference: 'Unconfirmed' },
    headers: { authorization: `Bearer ${t}`, 'idempotency-key': crypto.randomUUID() } })

  await app.inject({ method: 'POST', url: `/v1/shifts/${id}/close`, headers: auth(t) })

  const list = (await app.inject({ url: '/v1/shifts', headers: auth(t) })).json()
  const listRow = list.find((s: { id: string }) => s.id === id)
  const report = (await app.inject({ url: `/v1/shifts/${id}/report`, headers: auth(t) })).json()

  expect(report.totals.count).toBe(2)
  expect(report.totals.confirmed).toBe(1)
  expect(listRow.grossNim).toBe(report.totals.grossNim)
  expect(listRow.confirmed).toBe(report.totals.confirmed)
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
    'amount_crypto,asset,network,tx_hash,fx_rate,fx_rate_at,fx_source,fx_buffer_bps,reference,operator,shift_id')

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

it('neutralizes spreadsheet formula injection in reference and operator columns', async () => {
  const { t: operatorToken } = await vendor()
  const { t: customerToken } = await vendor() // Different user as customer
  const { id: shiftId } = (await app.inject({ method: 'POST', url: '/v1/shifts',
    payload: { operatorLabel: '=cmd|"/c calc"' }, headers: auth(operatorToken) })).json()

  // Create a session: payer (customer) creates, receiver (operator) claims
  const sessionRes = await app.inject({ method: 'POST', url: '/v1/sessions',
    headers: { authorization: `Bearer ${customerToken}`, 'idempotency-key': crypto.randomUUID() } })
  const { code, sessionId } = sessionRes.json()

  // Operator claims the session with code
  await app.inject({ method: 'POST', url: '/v1/sessions/claim', payload: { code },
    headers: { authorization: `Bearer ${operatorToken}`, 'idempotency-key': crypto.randomUUID() } })

  // Operator creates a charge with dangerous reference containing =, comma, and quote
  const chargeRef = '=cmd|"/c calc","inject'
  await app.inject({ method: 'POST', url: `/v1/sessions/${sessionId}/charges`,
    payload: { amountLuna: '100000', reference: chargeRef },
    headers: { authorization: `Bearer ${operatorToken}`, 'idempotency-key': crypto.randomUUID() } })

  // Close the shift to finalize it — buildReport includes every charge
  // stamped with the shift regardless of its status, so no route needs to
  // confirm the payment for it to appear in the export.
  await app.inject({ method: 'POST', url: `/v1/shifts/${shiftId}/close`, headers: auth(operatorToken) })

  // Export to CSV
  const res = await app.inject({ url: `/v1/shifts/${shiftId}/export`, headers: auth(operatorToken) })
  expect(res.statusCode).toBe(200)
  expect(res.headers['content-type']).toContain('text/csv')

  const lines = res.body.split('\r\n')
  expect(lines.length).toBeGreaterThan(2) // Header + at least one data row

  // Check the data row contains the neutralized reference and operator
  const dataRow = lines[1]
  // The dangerous reference should be prefixed with apostrophe and RFC 4180 quoted (inner quotes escaped)
  expect(dataRow).toContain(`"'=cmd|""/c calc"",""inject"`)
  // The dangerous operator should be prefixed with apostrophe and RFC 4180 quoted
  expect(dataRow).toContain(`"'=cmd|""/c calc"""`)
})
