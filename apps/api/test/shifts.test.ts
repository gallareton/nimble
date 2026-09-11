import { eq } from 'drizzle-orm'
import { afterAll, expect, it } from 'vitest'
import { chainTransaction, charge, paymentSession } from '../src/db/schema'
import { insertCharge } from '../src/services/charges'
import { monitorTick } from '../src/services/monitor'
import { SessionEvents } from '../src/services/events'
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

/**
 * Materializes a CONFIRMED sale directly (no monitor run needed — these
 * tests only care about how a sale shows up in a report, not how a payment
 * reaches CONFIRMED; that path is covered by confirmFiatSale above and by
 * monitor.test.ts), stamped to whatever shift the caller wants (or none).
 */
async function confirmedSaleFor(receiver: { id: string; walletAddress: string },
  shiftId: string | null, amountLuna: bigint) {
  const payer = await makeUser(db, `NQ58 ${crypto.randomUUID().slice(0, 8)}`)
  const [session] = await db.insert(paymentSession).values({
    payerUserId: payer.id, receiverUserId: receiver.id, codeHash: crypto.randomUUID(),
    status: 'CONFIRMED', expiresAt: new Date(Date.now() + 120_000),
  }).returning()
  const c = await insertCharge(db, {
    sessionId: session.id, amountAtomic: amountLuna, recipientAddress: receiver.walletAddress,
    reference: 'Sale', shiftId,
  })
  await db.insert(chainTransaction).values({
    chargeId: c.id, sender: payer.walletAddress, recipient: c.recipientAddress,
    amountAtomic: amountLuna, hash: crypto.randomUUID(), status: 'CONFIRMED',
  })
  return { payer, session, charge: c }
}

const postRefund = (chargeId: string, t: string, payload: object = {}) =>
  app.inject({ method: 'POST', url: `/v1/charges/${chargeId}/refunds`, payload,
    headers: { authorization: `Bearer ${t}`, 'idempotency-key': crypto.randomUUID() } })

/** Confirms a refund session directly — the route leaves it AWAITING_PAYER_APPROVAL, and these tests care about the report, not the signing flow covered by refund.test.ts. */
async function confirmSession(sessionId: string) {
  await db.update(paymentSession).set({ status: 'CONFIRMED' }).where(eq(paymentSession.id, sessionId))
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
  // occurredAt comes from the receipt snapshot written when the monitor
  // confirms the transaction, not from the charge's createdAt.
  expect(entry.occurredAt).not.toBeNull()
})

it('the export reconciles: amount_fiat_minor / fx_rate equals amount_crypto, with nothing added', async () => {
  const { t } = await vendor()
  const { id } = (await app.inject({ method: 'POST', url: '/v1/shifts',
    payload: { operatorLabel: 'Ana' }, headers: auth(t) })).json()

  // 1234 minor units at a 0.004 quote is exactly 3085 NIM. There is no
  // merchant buffer: what the vendor typed is what the payer is charged.
  // This is the regression guard for "entered 2.50, history showed 2.51".
  await confirmFiatSale(id, t, 1234)
  await app.inject({ method: 'POST', url: `/v1/shifts/${id}/close`, headers: auth(t) })

  const res = await app.inject({ url: `/v1/shifts/${id}/export`, headers: auth(t) })
  expect(res.statusCode).toBe(200)
  const [header, dataRow] = res.body.slice(1).split('\r\n')
  const cols = header.split(',')
  const cells = dataRow.split(',')
  const cell = (name: string) => cells[cols.indexOf(name)]

  expect(cols).not.toContain('fx_buffer_bps')

  const amountFiatMinor = Number(cell('amount_fiat_minor'))
  const fxRate = Number(cell('fx_rate'))
  const amountCrypto = Number(cell('amount_crypto'))

  expect(amountFiatMinor).toBe(1234)
  expect(fxRate).toBe(0.004)

  const expectedNim = amountFiatMinor / 100 / fxRate
  expect(Math.abs(amountCrypto - expectedNim)).toBeLessThan(0.0001) // ceil-rounding tolerance
  expect(amountCrypto).toBeCloseTo(3085, 3)
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
    'amount_crypto,asset,network,tx_hash,fx_rate,fx_rate_at,fx_source,reference,operator,shift_id,refund_of,' +
    'payment_method,sale_id')

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

it('a report with a sale and its partial refund shows both entries, the refund negative', async () => {
  const { u, t } = await vendor()
  const { id } = (await app.inject({ method: 'POST', url: '/v1/shifts',
    payload: { operatorLabel: 'Ana' }, headers: auth(t) })).json()

  const { charge: origCharge } = await confirmedSaleFor(u, id, 1_000_000n) // 10 NIM
  const refundRes = await postRefund(origCharge.id, t, { amountLuna: '400000' }) // 4 NIM
  expect(refundRes.statusCode).toBe(201)
  await confirmSession(refundRes.json().sessionId)

  await app.inject({ method: 'POST', url: `/v1/shifts/${id}/close`, headers: auth(t) })
  const report = (await app.inject({ url: `/v1/shifts/${id}/report`, headers: auth(t) })).json()

  expect(report.entries.length).toBe(2)
  const [sale, refundEntry] = report.entries

  expect(sale.amountNim).toBe('10')
  expect(sale.refundOfLocalNumber).toBeNull()
  expect(sale.refundOfOccurredAt).toBeNull()

  expect(refundEntry.amountNim).toBe('-4')
  expect(refundEntry.refundOfLocalNumber).toBe(sale.localNumber)
  expect(refundEntry.refundOfOccurredAt).toBe(sale.occurredAt)

  // grossNim is sales minus confirmed refunds.
  expect(report.totals.grossNim).toBe('6')
  // confirmed counts only the sale, refunded counts only the refund.
  expect(report.totals.confirmed).toBe(1)
  expect(report.totals.refunded).toBe(1)
})

it('averageTicketNim is computed from sales only, not from the net-of-refunds amount', async () => {
  const { u, t } = await vendor()
  const { id } = (await app.inject({ method: 'POST', url: '/v1/shifts',
    payload: { operatorLabel: 'Ana' }, headers: auth(t) })).json()

  // Two sales, 10 NIM and 20 NIM: average of the sales alone is 15 NIM.
  await confirmedSaleFor(u, id, 1_000_000n)
  const { charge: bigSale } = await confirmedSaleFor(u, id, 2_000_000n)

  // Refund 5 NIM off the second sale. Net proceeds are 25 NIM over 2 sales
  // (12.5 average) — a wrong implementation dividing net by sale count would
  // report 12.5 here instead of the correct 15.
  const refundRes = await postRefund(bigSale.id, t, { amountLuna: '500000' })
  expect(refundRes.statusCode).toBe(201)
  await confirmSession(refundRes.json().sessionId)

  await app.inject({ method: 'POST', url: `/v1/shifts/${id}/close`, headers: auth(t) })
  const report = (await app.inject({ url: `/v1/shifts/${id}/report`, headers: auth(t) })).json()

  expect(report.totals.confirmed).toBe(2)
  expect(report.totals.refunded).toBe(1)
  expect(report.totals.grossNim).toBe('25')
  expect(report.totals.averageTicketNim).toBe('15')
  expect(report.totals.averageTicketNim).not.toBe('12.5')
})

it('a refund of a sale from a different shift has refundOfLocalNumber null but refundOfOccurredAt filled', async () => {
  const { u, t } = await vendor()

  const { id: shift1 } = (await app.inject({ method: 'POST', url: '/v1/shifts',
    payload: { operatorLabel: 'Morning' }, headers: auth(t) })).json()
  const { charge: origCharge } = await confirmedSaleFor(u, shift1, 800_000n)
  await app.inject({ method: 'POST', url: `/v1/shifts/${shift1}/close`, headers: auth(t) })

  const { id: shift2 } = (await app.inject({ method: 'POST', url: '/v1/shifts',
    payload: { operatorLabel: 'Evening' }, headers: auth(t) })).json()
  const refundRes = await postRefund(origCharge.id, t)
  expect(refundRes.statusCode).toBe(201)
  await confirmSession(refundRes.json().sessionId)

  await app.inject({ method: 'POST', url: `/v1/shifts/${shift2}/close`, headers: auth(t) })
  const report2 = (await app.inject({ url: `/v1/shifts/${shift2}/report`, headers: auth(t) })).json()

  expect(report2.entries.length).toBe(1)
  const [refundEntry] = report2.entries
  expect(refundEntry.refundOfLocalNumber).toBeNull()
  expect(refundEntry.refundOfOccurredAt).not.toBeNull()
})

it('the CSV export carries the refund reference in a new column appended at the end', async () => {
  const { u, t } = await vendor()
  const { id } = (await app.inject({ method: 'POST', url: '/v1/shifts',
    payload: { operatorLabel: 'Ana' }, headers: auth(t) })).json()

  const { charge: origCharge } = await confirmedSaleFor(u, id, 1_000_000n)
  const refundRes = await postRefund(origCharge.id, t, { amountLuna: '250000' })
  await confirmSession(refundRes.json().sessionId)

  await app.inject({ method: 'POST', url: `/v1/shifts/${id}/close`, headers: auth(t) })
  const res = await app.inject({ url: `/v1/shifts/${id}/export`, headers: auth(t) })
  expect(res.statusCode).toBe(200)

  const lines = res.body.slice(1).split('\r\n')
  const header = lines[0]
  expect(header.split(',')).toEqual([
    'local_number', 'occurred_at_utc', 'status', 'amount_fiat_minor', 'fiat_currency',
    'amount_crypto', 'asset', 'network', 'tx_hash', 'fx_rate', 'fx_rate_at',
    'fx_source', 'reference', 'operator', 'shift_id', 'refund_of',
    'payment_method', 'sale_id',
  ])
  const cols = header.split(',')
  const idx = cols.indexOf('refund_of')

  const saleRow = lines[1].split(',')
  const refundRow = lines[2].split(',')
  expect(saleRow[idx]).toBe('')
  expect(refundRow[idx]).toBe('1') // the sale's local_number
  expect(refundRow[cols.indexOf('amount_crypto')]).toBe('-2.5')
})

const auth2 = auth
const createSale = (t: string, payload: object) =>
  app.inject({ method: 'POST', url: '/v1/sales', payload,
    headers: { authorization: `Bearer ${t}`, 'idempotency-key': crypto.randomUUID() } })

it('byProduct sums quantities across two sales of the same product; cash joins grossFiatMinor and cashSales, not confirmed', async () => {
  const { t } = await vendor()
  const { id } = (await app.inject({ method: 'POST', url: '/v1/shifts',
    payload: { operatorLabel: 'Ana' }, headers: auth2(t) })).json()

  const cash1 = await createSale(t, { items: [{ name: 'Coffee', unitPriceMinor: 350, quantity: 2 }], paymentMethod: 'cash' })
  expect(cash1.statusCode).toBe(201)
  const cash2 = await createSale(t, { items: [{ name: 'Coffee', unitPriceMinor: 350, quantity: 1 }], paymentMethod: 'cash' })
  expect(cash2.statusCode).toBe(201)

  await app.inject({ method: 'POST', url: `/v1/shifts/${id}/close`, headers: auth2(t) })
  const report = (await app.inject({ url: `/v1/shifts/${id}/report`, headers: auth2(t) })).json()

  expect(report.byProduct).toEqual([{ name: 'Coffee', quantity: 3, totalMinor: 1050 }])
  expect(report.totals.cashSales).toBe(2)
  expect(report.totals.confirmed).toBe(0) // confirmed stays NIM-charge-only
  expect(report.totals.grossFiatMinor).toBe(1050)
  expect(report.totals.byPaymentMethod.cash).toEqual({ count: 2, fiatMinor: 1050 })
  expect(report.totals.byPaymentMethod.nim).toEqual({ count: 0, fiatMinor: 0 })
  expect(report.cashEntries.length).toBe(2)
  expect(report.cashEntries[0].amountFiatMinor).toBe(700)
  // From the rate frozen onto the sale (0.004 USD/NIM): 7.00 USD = 1750 NIM.
  expect(report.cashEntries[0].amountNim).toBe('1750')
  expect(report.cashEntries[1].amountNim).toBe('875')
})

it('the CSV export carries payment_method and sale_id as the last two columns, cash rows after nim rows', async () => {
  const { t } = await vendor()
  const { id } = (await app.inject({ method: 'POST', url: '/v1/shifts',
    payload: { operatorLabel: 'Ana' }, headers: auth2(t) })).json()

  await confirmFiatSale(id, t, 500)
  const cashRes = await createSale(t, { items: [{ name: 'Tea', unitPriceMinor: 200, quantity: 1 }], paymentMethod: 'cash' })
  const cashSaleId = cashRes.json().id

  await app.inject({ method: 'POST', url: `/v1/shifts/${id}/close`, headers: auth2(t) })
  const res = await app.inject({ url: `/v1/shifts/${id}/export`, headers: auth2(t) })
  expect(res.statusCode).toBe(200)

  const lines = res.body.slice(1).split('\r\n')
  const header = lines[0]
  expect(header).toBe('local_number,occurred_at_utc,status,amount_fiat_minor,fiat_currency,' +
    'amount_crypto,asset,network,tx_hash,fx_rate,fx_rate_at,fx_source,reference,operator,shift_id,' +
    'refund_of,payment_method,sale_id')
  const cols = header.split(',')

  const nimRow = lines[1].split(',')
  expect(nimRow[cols.indexOf('payment_method')]).toBe('nim')
  expect(nimRow[cols.indexOf('sale_id')]).toBe('')

  const cashRow = lines[2].split(',')
  expect(cashRow[cols.indexOf('status')]).toBe('PAID_CASH')
  expect(cashRow[cols.indexOf('payment_method')]).toBe('cash')
  expect(cashRow[cols.indexOf('sale_id')]).toBe(cashSaleId)
  expect(cashRow[cols.indexOf('amount_fiat_minor')]).toBe('200')
})

it('the past-shifts list subtracts refunds, agreeing with the report it summarises', async () => {
  // A list that disagrees with the report it summarises is the same class of
  // bug as a sale entered at 2.50 showing as 2.51 — only in a place nobody
  // reads twice, so it survives longer.
  const { u, t } = await vendor()
  const { id } = (await app.inject({ method: 'POST', url: '/v1/shifts',
    payload: { operatorLabel: 'Ana' }, headers: auth(t) })).json()

  const { charge: origCharge } = await confirmedSaleFor(u, id, 1_000_000n) // 10 NIM
  const refundRes = await postRefund(origCharge.id, t, { amountLuna: '400000' }) // 4 NIM
  await confirmSession(refundRes.json().sessionId)

  const report = (await app.inject({ url: `/v1/shifts/${id}/report`, headers: auth(t) })).json()
  await app.inject({ method: 'POST', url: `/v1/shifts/${id}/close`, headers: auth(t) })
  const listed = (await app.inject({ url: '/v1/shifts', headers: auth(t) })).json()
    .find((x: { id: string }) => x.id === id)

  expect(listed.grossNim).toBe(report.totals.grossNim)   // 6, not 14
  expect(listed.confirmed).toBe(report.totals.confirmed) // 1 sale, not 2
})
