import { describe, expect, it } from 'vitest'
import { createEntry, type DraftEntry } from './draft'
import { estimatedLiquidation, marginOverBudget, rewardToRisk, sizeForBudget } from './sizing'

const entry = (price: string, share = '100'): DraftEntry => ({ ...createEntry(0), price, share })

describe('estimated liquidation', () => {
  it('is where the isolated margin falls to the maintenance margin', () => {
    // 10× on a 20× contract: 10% margin, 2.5% maintenance.
    expect(estimatedLiquidation([entry('121.54')], 'long', 10, 20)).toBeCloseTo(121.54 * 0.9 / 0.975, 6)
    expect(estimatedLiquidation([entry('121.54')], 'short', 10, 20)).toBeCloseTo(121.54 * 1.1 / 1.025, 6)
  })

  it('uses the share-weighted average entry of the whole plan', () => {
    const entries = [entry('100', '50'), entry('90', '50')]
    expect(estimatedLiquidation(entries, 'long', 5, 50)).toBeCloseTo(95 * 0.8 / 0.99, 6)
  })

  it('is unknown without a price or venue maximum, and absent for a 1× long', () => {
    expect(estimatedLiquidation([entry('')], 'long', 10, 20)).toBeNull()
    expect(estimatedLiquidation([entry('100')], 'long', 10, null)).toBeNull()
    expect(estimatedLiquidation([entry('100')], 'long', 1, 20)).toBeNull()
    expect(estimatedLiquidation([entry('100')], 'short', 1, 20)).toBeCloseTo(200 / 1.025, 6)
  })
})

describe('margin budget', () => {
  const draft = { size: '263', sizingMode: 'margin' as const, entries: [entry('121.54')], budgetOverride: null }

  it('flags margin above the available amount or a manual budget', () => {
    expect(marginOverBudget(draft, 10, '151.77')).toMatchObject({ margin: 263, budget: { amount: 151.77, source: 'available' } })
    expect(marginOverBudget({ ...draft, budgetOverride: '300' }, 10, '151.77')).toBeNull()
    expect(marginOverBudget({ ...draft, budgetOverride: '200' }, 10, '500')).toMatchObject({ budget: { source: 'manual' } })
    expect(marginOverBudget(draft, 10, null)).toBeNull()
  })

  it('checks the margin a quantity needs at the leverage', () => {
    const quantity = { ...draft, sizingMode: 'quantity' as const, size: '20' }
    expect(marginOverBudget(quantity, 10, '200')?.margin).toBeCloseTo(243.08, 2)
    expect(marginOverBudget(quantity, 20, '200')).toBeNull()
    expect(sizeForBudget(quantity, 10, '200', { quote: 'USDC', base: 'SOL', quantityDecimals: 2 })).toBe('16.45')
  })
})

describe('reward to risk', () => {
  it('compares percent levels by the price move they stand for', () => {
    const base = createEntry(0)
    const planned: DraftEntry = { ...base, price: '100',
      stops: [{ ...base.stops[0]!, unit: 'percent', value: '10' }], targets: [{ ...base.targets[0]!, unit: 'percent', value: '25' }] }
    expect(rewardToRisk(planned, 'short', 5)).toBeCloseTo(2.5, 6)
  })
})
