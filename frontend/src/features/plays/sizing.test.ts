import { describe, expect, it } from 'vitest'
import { createEntry, type DraftEntry } from './draft'
import { entryResults, estimatedLiquidation, formatResult, marginOverBudget, rewardToRisk, sizeForBudget } from './sizing'

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

describe('entry results', () => {
  const units = { quote: 'USDC', base: 'SOL', quantityDecimals: 2 }
  const levels = (base: DraftEntry, stop: string, targets: Array<[string, string]>): DraftEntry => ({
    ...base, stops: [{ ...base.stops[0]!, value: stop }],
    targets: targets.map(([value, share], index) => ({ ...base.targets[0]!, id: `t${index}`, value, share })),
  })

  it('gives each level its share of the entry quantity at the price move', () => {
    // 100 margin at 10× on one entry at 100: 10 units.
    const planned = levels(entry('100'), '95', [['110', '50'], ['120', '50']])
    const results = entryResults({ size: '100', sizingMode: 'margin', direction: 'long', entries: [planned] }, 10, planned)
    expect(results.stops).toBeCloseTo(-50, 6)
    expect(results.targets).toBeCloseTo(50 + 100, 6)
    expect(Object.values(results.levels).map(value => Math.round(value))).toEqual([-50, 50, 100])
    expect(formatResult(results.stops!, units)).toBe('−50 USDC')
    expect(formatResult(results.targets!, units)).toBe('+150 USDC')
  })

  it('splits the position by entry share and follows the direction', () => {
    const first = levels(entry('100', '50'), '105', [['90', '100']])
    const second = levels(entry('110', '50'), '115', [['90', '100']])
    // Quantity 1000 ÷ 105 average; each entry holds half.
    const draft = { size: '100', sizingMode: 'margin' as const, direction: 'short' as const, entries: [first, second] }
    const quantity = 1000 / 105 / 2
    expect(entryResults(draft, 10, first).stops).toBeCloseTo(-5 * quantity, 6)
    expect(entryResults(draft, 10, second).targets).toBeCloseTo(20 * quantity, 6)
  })

  it('is unknown until the position is sized', () => {
    const planned = levels(entry('100'), '95', [['110', '100']])
    expect(entryResults({ size: '', sizingMode: 'margin', direction: 'long', entries: [planned] }, 10, planned)).toEqual({ levels: {}, stops: null, targets: null })
  })
})
