import { expect, test } from '@playwright/test'
import { pairAndClaim, submitCharge } from './helpers'

test('soda purchase end-to-end across two users', async ({ browser, request }) => {
  await request.post('http://localhost:3100/__test/chain/advance', { data: { reset: true } })
  const { payer, receiver, code } = await pairAndClaim(browser)
  await submitCharge(receiver, code, '2.5', 'Soda')

  await expect(payer.getByText('Soda')).toBeVisible({ timeout: 10_000 })
  await expect(payer.getByText(/unverified profile/i)).toBeVisible()
  await expect(payer.getByText('2.5 NIM')).toBeVisible()
  await payer.getByRole('button', { name: /^confirm$/i }).click()

  // before any fake block: hash registered but not included → SUBMITTED
  await expect(receiver.getByText(/submitted/i)).toBeVisible({ timeout: 10_000 })
  await request.post('http://localhost:3100/__test/chain/advance', { data: { blocks: 1 } })
  // included in a micro block, macro not final yet → CONFIRMING
  await expect(receiver.getByText(/confirming/i)).toBeVisible({ timeout: 10_000 })
  await request.post('http://localhost:3100/__test/chain/advance', { data: { macro: true } })
  await expect(receiver.getByText(/^✅ Confirmed|Confirmed$/).first()).toBeVisible({ timeout: 10_000 })
  await expect(payer.getByText(/Confirmed/).first()).toBeVisible({ timeout: 10_000 })
})
