import { expect, it } from 'vitest'
import { MockWalletProvider } from '../src/wallet/mockProvider'

it('mock provider round-trips', async () => {
  const w = new MockWalletProvider()
  expect((await w.connect()).address).toMatch(/^NQ07/)
  expect((await w.signMessage('x')).publicKey).toMatch(/^mock-pk:NQ07/)
  const { hash } = await w.sendTransaction({ recipient: 'NQ99', valueLuna: 100n })
  expect(hash).toMatch(/^mock-/)
})
