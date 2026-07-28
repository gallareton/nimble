import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { expect, it, vi } from 'vitest'
import { CodeDisplay } from '../src/components/CodeDisplay'
import { StatusBadge } from '../src/components/StatusBadge'
import { Approval } from '../src/screens/Approval'

it('CodeDisplay groups digits and is screen-reader friendly', () => {
  render(<CodeDisplay code="482731" />)
  expect(screen.getByText('482 731')).toBeTruthy()
  expect(screen.getByLabelText(/4 8 2 7 3 1/)).toBeTruthy()
})

it('StatusBadge renders text labels, only CONFIRMED is success', () => {
  render(<StatusBadge status="SUBMITTED" />)
  expect(screen.getByText(/submitted/i)).toBeTruthy()
  expect(screen.queryByText(/paid/i)).toBeNull()
})

it('Approval shows all mandatory fields and drives intent→send→register on confirm', async () => {
  const api = {
    getSession: vi.fn(async () => ({ sessionId: 's1', status: 'AWAITING_PAYER_APPROVAL', role: 'payer',
      expiresAt: new Date().toISOString(),
      counterpart: { displayName: 'Kiosk', verificationStatus: 'unverified', addressTail: 'XY12' },
      charge: { chargeId: 'c1', version: 1, amountLuna: '250000', asset: 'NIM', network: 'nimiq',
        reference: 'Soda', recipientAddress: 'NQ99 RECV' } })),
    intent: vi.fn(async () => ({ reconciliationToken: 'ab'.repeat(16), recipientAddress: 'NQ99 RECV',
      amountLuna: '250000', validUntil: new Date().toISOString() })),
    registerTx: vi.fn(async () => {}),
    reject: vi.fn(async () => {}),
    openEvents: vi.fn(async () => () => {}),
  }
  const wallet = { sendTransaction: vi.fn(async () => ({ hash: 'deadbeef' })) }
  render(
    <MemoryRouter initialEntries={['/session/s1']}>
      <Routes>
        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
        <Route path="/session/:id" element={<Approval api={api as any} wallet={wallet as any} />} />
      </Routes>
    </MemoryRouter>,
  )

  await screen.findByText('Kiosk')
  expect(screen.getByText(/unverified profile/i)).toBeTruthy()
  expect(screen.getByText('2.5 NIM')).toBeTruthy()
  expect(screen.getByText(/XY12/)).toBeTruthy()
  expect(screen.getByText('Soda')).toBeTruthy()

  fireEvent.click(screen.getByRole('button', { name: /confirm/i }))
  await waitFor(() => expect(api.registerTx).toHaveBeenCalledWith('c1', 'deadbeef', expect.any(String)))
  expect(wallet.sendTransaction).toHaveBeenCalledWith(
    expect.objectContaining({ recipient: 'NQ99 RECV', valueLuna: 250000n, data: 'ab'.repeat(16) }))
})
