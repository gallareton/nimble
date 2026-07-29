import { expect, test } from '@playwright/test'
import { connect, newUserPage, pairAndClaim, submitCharge } from './helpers'

test('payer reject shows role-specific copy on both sides', async ({ browser }) => {
  const { payer, receiver, code } = await pairAndClaim(browser)
  await submitCharge(receiver, code, '1')
  await expect(payer.getByRole('button', { name: /reject/i })).toBeVisible({ timeout: 10_000 })
  await payer.getByRole('button', { name: /reject/i }).click()
  await expect(payer.getByText(/payment cancelled/i).first()).toBeVisible()
  await expect(receiver.getByText(/cancelled/i).first()).toBeVisible({ timeout: 10_000 })
})

test('used and invalid codes give the same generic error', async ({ browser }) => {
  const { receiver, code } = await pairAndClaim(browser)
  await submitCharge(receiver, code, '1') // code is consumed here
  const other = await newUserPage(browser)
  await connect(other)
  await other.getByRole('button', { name: /charge/i }).click()
  await submitCharge(other, code, '1')
  await expect(other.getByText(/code unavailable/i)).toBeVisible()
  await submitCharge(other, '000000', '1')
  await expect(other.getByText(/code unavailable/i)).toBeVisible()
})

test('receiver can cancel before payer approval', async ({ browser }) => {
  const { payer, receiver, code } = await pairAndClaim(browser)
  await submitCharge(receiver, code, '1')
  await expect(receiver.getByRole('button', { name: /cancel/i })).toBeVisible({ timeout: 10_000 })
  await receiver.getByRole('button', { name: /cancel/i }).click()
  await expect(receiver.getByText(/🚫 Cancelled/).first()).toBeVisible({ timeout: 10_000 })
  await expect(payer.getByText(/🚫 Cancelled/).first()).toBeVisible({ timeout: 10_000 })
})
