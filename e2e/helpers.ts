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
  await payer.getByRole('button', { name: /generate code/i }).click()
  const code = (await payer.getByTestId('code').innerText()).replace(/\s/g, '')

  await receiver.getByRole('button', { name: /charge/i }).click()
  return { payer, receiver, code }
}

// BLIK-style single step: amount + reference + code on one form.
export async function submitCharge(receiver: Page, code: string, amount: string, reference?: string) {
  await receiver.getByLabel(/amount/i).fill(amount)
  if (reference) await receiver.getByLabel(/reference/i).fill(reference)
  await receiver.getByLabel(/code/i).fill(code)
  await receiver.getByRole('button', { name: /request payment/i }).click()
}
