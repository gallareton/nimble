import { expect, test } from '@playwright/test'
import { connect, newUserPage, pairAndClaim, submitCharge } from './helpers'

test('payer reject shows role-specific copy on both sides', async ({ browser }) => {
  const { payer, receiver } = await pairAndClaim(browser)
  await submitCharge(receiver, '1')
  await expect(payer.getByRole('button', { name: /reject/i })).toBeVisible({ timeout: 10_000 })
  await payer.getByRole('button', { name: /reject/i }).click()
  await expect(payer.getByText(/payment cancelled/i).first()).toBeVisible()
  await expect(receiver.getByText(/cancelled/i).first()).toBeVisible({ timeout: 10_000 })
})

test('used and invalid codes give the same generic error', async ({ browser }) => {
  const { code } = await pairAndClaim(browser) // code already claimed here
  const other = await newUserPage(browser)
  await connect(other)
  await other.getByRole('button', { name: /charge/i }).click()
  await other.getByLabel(/code/i).fill(code)
  await other.getByRole('button', { name: /claim/i }).click()
  await expect(other.getByText(/code unavailable/i)).toBeVisible()
  await other.getByLabel(/code/i).fill('000000')
  await other.getByRole('button', { name: /claim/i }).click()
  await expect(other.getByText(/code unavailable/i)).toBeVisible()
})

test('receiver can cancel before payer approval', async ({ browser }) => {
  const { payer, receiver } = await pairAndClaim(browser)
  await submitCharge(receiver, '1')
  await expect(receiver.getByRole('button', { name: /cancel/i })).toBeVisible({ timeout: 10_000 })
  await receiver.getByRole('button', { name: /cancel/i }).click()
  await expect(receiver.getByText(/🚫 Cancelled/).first()).toBeVisible({ timeout: 10_000 })
  await expect(payer.getByText(/🚫 Cancelled/).first()).toBeVisible({ timeout: 10_000 })
})
