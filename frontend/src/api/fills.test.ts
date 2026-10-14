import { describe, expect, it } from 'vitest'
import { isImportedFill } from './fills'

const fill = {
  id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', accountId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', contractId: 'BTC', side: 'buy',
  direction: 'Open Long', price: '100.123456789123456789', quantity: '1', fee: '0', feeToken: 'USDC', closedPnlUsd: '-0.5',
  occurredAtUtc: '2026-10-01T10:00:00Z', orderId: '1', sourceFillId: '1', transactionHash: '', positionEffect: 'open',
  feeBasis: 'reported', pnlBasis: 'gross', playId: null,
}

describe('isImportedFill', () => {
  it.each([
    ['an unassigned fill', fill], ['a linked fill', { ...fill, playId: '11111111-2222-3333-4444-555555555555' }],
    ['a fee-free net-of-fee flip', { ...fill, side: 'sell', positionEffect: 'flip', feeBasis: 'standard-account-free', pnlBasis: 'net-of-fee' }],
  ])('accepts %s', (_name, value) => expect(isImportedFill(value)).toBe(true))
  it.each([
    ['an array', [fill]], ['a numeric price', { ...fill, price: 100 }], ['an exponent', { ...fill, quantity: '1e3' }],
    ['an unknown side', { ...fill, side: 'long' }], ['an unknown effect', { ...fill, positionEffect: 'increase' }],
    ['an unknown fee basis', { ...fill, feeBasis: 'estimated' }], ['an unknown P&L basis', { ...fill, pnlBasis: 'net' }],
    ['an invalid account', { ...fill, accountId: 'other' }], ['an invalid Play link', { ...fill, playId: 'play' }],
    ['a missing Play link', { ...fill, playId: undefined }], ['an unreadable time', { ...fill, occurredAtUtc: 'yesterday' }],
    ['a missing hash', { ...fill, transactionHash: null }],
  ])('rejects %s', (_name, value) => expect(isImportedFill(value)).toBe(false))
})
