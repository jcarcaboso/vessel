import { describe, expect, it } from 'vitest'
import { createEntry, type DraftEntry, type DraftExit } from './draft'
import { estimatedLiquidation, exitEstimate, marginOverBudget, positionSize, rewardToRisk, sizeForBudget } from './sizing'

const entry = (price: string, share = '100'): DraftEntry => ({ ...createEntry(0), price, share })

describe('exit estimates', () => {
  const planned = entry('3.75')
  const exit: DraftExit = { ...planned.stops[0]!, unit: 'percent', value: '10', share: '100' }
  const sized = positionSize({ size: '130', sizingMode: 'margin', entries: [planned] }, 3)

  it.each([
    ['long', 'stop', '10', 3.625, 13],
    ['long', 'target', '50', 4.375, 65],
    ['short', 'stop', '10', 3.875, 13],
    ['short', 'target', '50', 3.125, 65],
  ] as const)('separates a %s %s price move from its leveraged return without applying leverage twice', (direction, kind, value, price, amount) => {
    const estimate = exitEstimate(planned, { ...exit, value }, kind, direction, 3, sized.quantity)!
    expect(estimate.price).toBeCloseTo(price)
    expect(estimate.move).toBeCloseTo(Number(value) / 3)
    expect(estimate.returnPercent).toBeCloseTo(Number(value))
    expect(estimate.amount).toBeCloseTo(amount)
  })

  it('resolves price levels and respects both entry and exit quantity shares without normalizing them', () => {
    const estimate = exitEstimate({ ...planned, share: '40' }, { ...exit, unit: 'price', value: '3.375', share: '50' }, 'stop', 'long', 3, sized.quantity)!
    expect(estimate.move).toBeCloseTo(10)
    expect(estimate.returnPercent).toBeCloseTo(30)
    expect(estimate.amount).toBeCloseTo(7.8)
    expect(exitEstimate(planned, { ...exit, share: '0' }, 'stop', 'long', 3, sized.quantity)?.amount).toBe(0)
  })

  it('uses quantity sizing and 1× without adding another leverage multiplier', () => {
    const quantity = positionSize({ size: '104', sizingMode: 'quantity', entries: [planned] }, 3).quantity
    expect(exitEstimate(planned, exit, 'stop', 'long', 3, quantity)?.amount).toBeCloseTo(13)
    const unlevered = positionSize({ size: '130', sizingMode: 'margin', entries: [planned] }, 1).quantity
    expect(exitEstimate(planned, exit, 'stop', 'long', 1, unlevered)).toMatchObject({ price: 3.375, move: 10, returnPercent: 10 })
    expect(exitEstimate(planned, exit, 'stop', 'long', 1, unlevered)?.amount).toBeCloseTo(13)
  })

  it('does not invent amounts from missing or invalid size and shares, or outcomes for invalid prices', () => {
    expect(exitEstimate(planned, exit, 'stop', 'long', 3, null)?.amount).toBeNull()
    expect(exitEstimate(planned, exit, 'stop', 'long', 3, Infinity)?.amount).toBeNull()
    expect(exitEstimate(entry('10000000000'), exit, 'stop', 'long', 3, 1e308)?.amount).toBeNull()
    for (const share of ['', '-1', '101', 'invalid']) {
      expect(exitEstimate({ ...planned, share }, exit, 'stop', 'long', 3, 104)?.amount).toBeNull()
      expect(exitEstimate(planned, { ...exit, share }, 'stop', 'long', 3, 104)?.amount).toBeNull()
    }
    expect(exitEstimate(entry(''), exit, 'stop', 'long', 3, 104)).toBeNull()
    expect(exitEstimate(planned, { ...exit, unit: 'price', value: '4' }, 'stop', 'long', 3, 104)).toBeNull()
    expect(exitEstimate(planned, { ...exit, value: '400' }, 'stop', 'long', 3, 104)).toBeNull()
  })
})

describe('estimated liquidation', () => {
  it('is where the isolated margin falls to the maintenance margin', () => {
    // 10× on a 20× contract: 10% margin, 2.5% maintenance.
    expect(estimatedLiquidation([entry('121.54')], 'long', 10, 20)).toBeCloseTo(121.54 * 0.9 / 0.975, 6)
    expect(estimatedLiquidation([entry('121.54')], 'short', 10, 20)).toBeCloseTo(121.54 * 1.1 / 1.025, 6)
  })

  it('uses the maintenance margin the venue states for the contract over the assumed one', () => {
    expect(estimatedLiquidation([entry('100')], 'long', 10, 20, 0.05)).toBeCloseTo(100 * 0.9 / 0.95, 6)
    expect(estimatedLiquidation([entry('100')], 'short', 10, null, 0.05)).toBeCloseTo(100 * 1.1 / 1.05, 6)
    expect(estimatedLiquidation([entry('100')], 'long', 10, 20, 1)).toBeCloseTo(100 * 0.9 / 0.975, 6)
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
