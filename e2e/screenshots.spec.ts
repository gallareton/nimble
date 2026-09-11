import { test, type Page } from '@playwright/test'
import { connect, newUserPage, pairAndClaim, submitCharge } from './helpers'
const API_URL = 'http://localhost:3100'

// Self-audit tool, not a test: walks every screen at a phone viewport and
// drops a screenshot per state into SHOTS_DIR. Run with
//   SHOTS_DIR=/path pnpm --filter nimble-e2e exec playwright test screenshots.spec.ts
const DIR = process.env.SHOTS_DIR ?? 'shots'
test.use({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true })

let n = 0
async function shot(page: Page, name: string) {
  await page.waitForTimeout(400)
  await page.screenshot({ path: `${DIR}/${String(++n).padStart(2, '0')}-${name}.png`, fullPage: false })
}

async function api(page: Page, method: string, path: string, body?: unknown) {
  return page.evaluate(async ({ method, path, body, API_URL }) => {
    const token = Object.keys(localStorage).filter(k => k.startsWith('nimble.jwt')).map(k => localStorage.getItem(k))[0]
    const r = await fetch(`${API_URL}${path}`, {
      method,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`,
        'idempotency-key': crypto.randomUUID() },
      body: body ? JSON.stringify(body) : undefined,
    })
    return { status: r.status, body: await r.json().catch(() => null) }
  }, { method, path, body, API_URL })
}

test('screenshots of every screen', async ({ browser, request }) => {
  test.setTimeout(240_000)
  await request.post(`${API_URL}/__test/chain/advance`, { data: { reset: true } })

  // A fresh receiver with no catalog first — the bare till.
  const bare = await newUserPage(browser)
  await bare.goto('/')
  await shot(bare, 'connect')
  await connect(bare)
  await shot(bare, 'home-first-run')
  await bare.getByRole('button', { name: /got it/i }).click()
  await shot(bare, 'home-empty')
  await bare.getByRole('button', { name: /charge/i }).click()
  await shot(bare, 'charge-nocatalog-step1')
  await bare.getByRole('button', { name: /^NIM$/ }).click()
  await bare.getByLabel(/amount/i).fill('50000')
  await bare.getByLabel(/amount/i).focus()
  await shot(bare, 'charge-nocatalog-nim-focused')
  await bare.getByRole('button', { name: 'Continue' }).click()
  await shot(bare, 'charge-nocatalog-step2')

  // The main pair: payer + receiver with a catalog, a shift, sales.
  const { payer, receiver, code } = await pairAndClaim(browser)
  await shot(payer, 'pay-code')
  await receiver.goto('/')
  await api(receiver, 'PATCH', '/v1/me', { displayName: 'Bar Nimiq', businessName: 'Bar Nimiq', businessAddress: 'Rynek 1, Kraków', taxId: 'PL1234567890' })
  await api(receiver, 'POST', '/v1/products', { name: 'Soda', priceMinor: 250, category: 'Drinks' })
  await api(receiver, 'POST', '/v1/products', { name: 'Coffee', priceMinor: 400, category: 'Drinks' })
  await api(receiver, 'POST', '/v1/products', { name: 'Sandwich', priceMinor: 1250 })
  await api(receiver, 'POST', '/v1/shifts', { operatorLabel: 'Andrzej' })
  await receiver.goto('/charge')
  await shot(receiver, 'charge-catalog-step1-empty')
  await receiver.getByRole('button', { name: /Soda/ }).click()
  await receiver.getByRole('button', { name: /Soda/ }).click()
  await receiver.getByRole('button', { name: /Sandwich/ }).click()
  await shot(receiver, 'charge-catalog-cart')
  await receiver.getByRole('button', { name: 'Continue' }).click()
  await shot(receiver, 'charge-step2-nim')
  await receiver.getByRole('button', { name: /^Cash$/ }).click()
  await shot(receiver, 'charge-step2-cash')
  await receiver.getByRole('button', { name: /record cash sale/i }).click()
  await shot(receiver, 'charge-after-cash')

  // A NIM payment all the way to a receipt.
  await submitCharge(receiver, code, '2.5', 'Soda')
  await shot(receiver, 'session-receiver-waiting')
  await shot(payer, 'approval-payer')
  await payer.getByRole('button', { name: /^confirm$/i }).click()
  await request.post(`${API_URL}/__test/chain/advance`, { data: { blocks: 1 } })
  await receiver.getByText(/Paid — finalizing/).first().waitFor({ timeout: 10_000 })
  await shot(receiver, 'session-receiver-finalizing')
  await request.post(`${API_URL}/__test/chain/advance`, { data: { macro: true } })
  await receiver.getByText(/Confirmed — final/).first().waitFor({ timeout: 10_000 })
  await shot(receiver, 'session-receiver-confirmed')
  await shot(payer, 'session-payer-confirmed')

  await receiver.goto('/')
  await shot(receiver, 'home-with-recent')
  await receiver.goto('/shift')
  await shot(receiver, 'shift-open-with-sales')
  await receiver.getByRole('button', { name: 'Close the shift' }).click()
  await shot(receiver, 'shift-close-sheet')
  await receiver.getByRole('dialog').getByRole('button', { name: 'Close the shift' }).click()
  await shot(receiver, 'shift-closed-report')
  await receiver.getByRole('button', { name: /^Export$/ }).click()
  await shot(receiver, 'shift-export-open')
  await receiver.goto('/shift')
  await shot(receiver, 'shift-open-form')
  await receiver.goto('/history')
  await shot(receiver, 'history')
  await receiver.getByRole('button', { name: /filters/i }).click()
  await shot(receiver, 'history-filters-open')
  await receiver.getByRole('tab', { name: /shifts/i }).click()
  await shot(receiver, 'history-shifts')
  await receiver.getByRole('link', { name: /Andrzej/ }).first().click()
  await shot(receiver, 'history-past-shift')
  await receiver.goto('/history')
  await receiver.getByRole('tab', { name: /transactions/i }).click()
  await receiver.getByRole('link', { name: /Soda/ }).first().click()
  await shot(receiver, 'receipt')
  await receiver.goto('/dashboard')
  await shot(receiver, 'dashboard')
  await receiver.goto('/products')
  await shot(receiver, 'products')
  await receiver.goto('/charge/remote')
  await shot(receiver, 'remote-bill-form')
  await receiver.goto('/settings')
  await shot(receiver, 'settings-top')
  await receiver.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
  await shot(receiver, 'settings-bottom')
  await receiver.goto('/guide')
  await shot(receiver, 'guide')
  await receiver.goto('/')
  await receiver.getByRole('button', { name: 'More' }).click()
  await shot(receiver, 'more-sheet')
})
