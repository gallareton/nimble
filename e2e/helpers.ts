import type { Browser, Page } from '@playwright/test'

let n = 0

export async function newUserPage(browser: Browser): Promise<Page> {
  const ctx = await browser.newContext()
  const address = `NQ${String(10 + n++).padStart(2, '0')} E2EU ${crypto.randomUUID().slice(0, 4).toUpperCase()}`
  await ctx.addInitScript(addr => localStorage.setItem('nimble.mockAddress', addr), address)
  return ctx.newPage()
}

export async function connect(page: Page) {
  await page.goto('/')
  await page.getByRole('button', { name: /connect/i }).click()
  await page.getByRole('button', { name: /^pay$/i }).waitFor()
}

export async function pairAndClaim(browser: Browser) {
  const payer = await newUserPage(browser)
  const receiver = await newUserPage(browser)
  await connect(payer)
  await connect(receiver)

  await payer.getByRole('button', { name: /^pay$/i }).click()
  // the code generates automatically on entering Pay
  await payer.getByTestId('code').waitFor()
  const code = (await payer.getByTestId('code').innerText()).replace(/\s/g, '')

  await receiver.getByRole('button', { name: /charge/i }).click()
  return { payer, receiver, code }
}

// BLIK-style single step: amount + reference + code on one form.
/**
 * @param unit which pricing unit to charge in. The Charge screen defaults to
 * USD (a till prices goods in money, not in NIM), so a test that means NIM has
 * to say so — this helper silently produced USD-priced charges for a while
 * after the vendor POS work landed, and the suite went red unnoticed.
 */
export async function submitCharge(receiver: Page, code: string, amount: string,
  reference?: string, unit: 'USD' | 'NIM' = 'NIM') {
  // Two-step till (R7): amount and unit on step 1, payer code on step 2.
  await receiver.getByRole('button', { name: new RegExp(`^${unit}$`) }).click()
  await receiver.getByLabel(/amount/i).fill(amount)
  await receiver.getByRole('button', { name: 'Continue' }).click()
  if (reference) await receiver.getByLabel(/reference/i).fill(reference)
  await receiver.getByLabel(/code/i).fill(code)
  await receiver.getByRole('button', { name: /request payment/i }).click()
}
