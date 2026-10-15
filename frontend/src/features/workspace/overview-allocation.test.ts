import { describe, expect, it } from 'vitest'
import type { BrokerAccount, Portfolio } from '@/api/workspace'
import { portfolioAllocations, sumDecimals, totalAllocation } from './overview-allocation'

const portfolio = (id: string, name: string): Portfolio => ({ id, name, accountCount: 0, totalValueUsd: null, valueCoverage: 'unavailable', icon: 'folder' })
const account = (id: string, portfolioId: string | null, balanceUsd: string | null, isEnabled = true): BrokerAccount => ({
  id, portfolioId, name: id, venueId: 'manual', address: null, accountValueUsd: balanceUsd, lastSyncedAtUtc: null,
  syncStatus: 'manual', lastSyncError: null, positionCount: 0, historyNotice: null, isEnabled, balanceUsd,
})

describe('overview allocation', () => {
  it('sums exact decimals without floating-point drift', () => {
    expect(sumDecimals(['0.1', '0.2'])).toBe('0.3')
    expect(sumDecimals(['1250.123456', '-250.123456'])).toBe('1000')
  })

  it('shares each enabled account within its portfolio and leaves missing balances out', () => {
    const [swing, unassigned] = portfolioAllocations([
      account('a', 'p', '750'), account('b', 'p', '250'), account('c', 'p', null), account('d', 'p', '999', false), account('e', null, '100'),
    ], [portfolio('p', 'Swing')])
    expect(swing!.slices.map(s => [s.name, s.share])).toEqual([['a', '75.00%'], ['b', '25.00%']])
    expect(swing!.missingCount).toBe(1)
    expect(swing!.totalUsd).toBe('1000')
    expect(unassigned!.name).toBe('Unassigned')
    const total = totalAllocation([swing!, unassigned!])
    expect(total.slices.map(s => [s.name, s.share])).toEqual([['Swing', '90.91%'], ['Unassigned', '9.09%']])
    expect(total.missingCount).toBe(1)
  })

  it('folds past six slices into Other and keeps colours on the entity, not its size', () => {
    const accounts = ['10', '20', '30', '40', '50', '60', '70'].map((v, i) => account(`x${i}`, 'p', v))
    const [group] = portfolioAllocations(accounts, [portfolio('p', 'Many')])
    expect(group!.slices).toHaveLength(6)
    expect(group!.slices.at(-1)).toMatchObject({ name: 'Other (2)', balanceUsd: '30', slot: null, scope: null })
    // x2 is the first kept account in stable order, so it keeps slot 1 although it is the smallest kept slice.
    expect(group!.slices.find(s => s.id === 'x2')!.slot).toBe(1)
  })

  it('does not draw zero or negative balances', () => {
    const [group] = portfolioAllocations([account('a', 'p', '100'), account('b', 'p', '-20'), account('c', 'p', '0')], [portfolio('p', 'P')])
    expect(group!.slices.map(s => s.share)).toEqual(['100.00%'])
    expect(group!.notDrawn.map(n => n.name)).toEqual(['b', 'c'])
  })
})
