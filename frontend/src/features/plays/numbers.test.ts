import { describe, expect, it } from 'vitest'
import { createDraft, createEntry, createExit } from './draft'
import { levelPrice, leverageOf } from './levels'
import { planIssues } from './planChecks'
import { positionRiskSummary } from './position-risk-summary'
import { positionSize } from './sizing'
import { lossPerUnit } from './suggestions'
import { finitePlanNumber, planNumber, planShare, positiveFinitePlanNumber, positivePlanNumber } from './numbers'

describe('draft plan number profiles', () => {
  it.each(['', ' ', '.5', '1.', '+1', '-1', '-0', '1e2', '0x10', 'Infinity', 'NaN', '1 2'])('rejects %j in every plain-decimal profile', value => {
    for (const parse of [planNumber, finitePlanNumber, positivePlanNumber, positiveFinitePlanNumber, planShare]) {
      expect(parse(value)).toBeNull()
    }
  })
  it.each(['1', '01.25', ' 1.25 ', '\t1.25\n'])('retains surrounding whitespace and leading zero acceptance for %j', value => {
    for (const parse of [planNumber, finitePlanNumber, positivePlanNumber, positiveFinitePlanNumber, planShare]) {
      expect(parse(value)).toBe(Number(value))
    }
  })
  it('keeps zero, underflow, share boundaries and overflow differences explicit', () => {
    const underflow = `0.${'0'.repeat(324)}1`
    for (const zero of ['0', '00.000', underflow]) {
      expect(planNumber(zero)).toBe(0)
      expect(finitePlanNumber(zero)).toBe(0)
      expect(planShare(zero)).toBe(0)
      expect(positivePlanNumber(zero)).toBeNull()
      expect(positiveFinitePlanNumber(zero)).toBeNull()
    }
    expect(planShare('100')).toBe(100)
    expect(planShare('100.01')).toBeNull()
    const overflow = '9'.repeat(309)
    expect(planNumber(overflow)).toBe(Infinity)
    expect(positivePlanNumber(overflow)).toBe(Infinity)
    expect(finitePlanNumber(overflow)).toBeNull()
    expect(positiveFinitePlanNumber(overflow)).toBeNull()
    expect(planShare(overflow)).toBeNull()
  })
  it('uses the matching profiles in levels, sizing, suggestions, checks and full-position estimates', () => {
    const entry = { ...createEntry(0), price: ' 100 ', stops: [{ ...createExit('100'), value: ' 95 ' }] }
    const draft = { ...createDraft(), size: ' 2 ', sizingMode: 'quantity' as const, entries: [entry] }
    expect(levelPrice(100, entry.stops[0]!, 'stop', 'long')).toBe(95)
    expect(positionSize(draft, 1).quantity).toBe(2)
    expect(lossPerUnit(draft.entries, 'long', 1)).toBe(5)
    expect(planIssues(draft.entries, 'long')).toEqual([])
    expect(positionRiskSummary(draft).stops.totalAmount).toBe(10)

    const overflow = '9'.repeat(309)
    expect(positionSize({ ...draft, size: overflow }, 1).quantity).toBe(Infinity)
    expect(positionRiskSummary({ ...draft, size: overflow }).quantity).toBeNull()
    expect(levelPrice(100, { ...entry.stops[0]!, value: overflow }, 'stop', 'long')).toBeNull()
    expect(planIssues([{ ...entry, price: overflow }], 'short')).toHaveLength(1)
    expect(lossPerUnit([{ ...entry, price: overflow }], 'long', 1)).toBe(Infinity)
  })
  it('leaves the existing whole-number leverage profile separate', () => {
    expect(leverageOf('1e2')).toBe(100)
    expect(leverageOf(' 2 ')).toBe(2)
    expect(leverageOf('2.5')).toBe(1)
    expect(positionRiskSummary({ ...createDraft(), leverage: '1e2', size: '1', sizingMode: 'quantity' }).quantity).toBeNull()
  })
})
