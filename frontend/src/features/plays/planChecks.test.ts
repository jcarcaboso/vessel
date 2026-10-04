import { describe, expect, it } from 'vitest'
import { createEntry, type DraftEntry } from './draft'
import { planFixes, planIssues } from './planChecks'

const entry = (price: string, stop: string, target: string, unit: 'price' | 'percent' = 'price'): DraftEntry => {
  const base = createEntry(0)
  return { ...base, price, stops: [{ ...base.stops[0]!, unit, value: stop }], targets: [{ ...base.targets[0]!, unit, value: target }] }
}

describe('plan checks', () => {
  it('flags price levels on the wrong side or at the entry, never percent levels or unpriced entries', () => {
    expect(planIssues([entry('100', '95', '110')], 'long')).toEqual([])
    expect(planIssues([entry('100', '100', '110')], 'long').map(issue => issue.message))
      .toEqual(['Entry 1 stop is at the entry price; a long stop goes below it.'])
    expect(planIssues([entry('100', '95', '110')], 'short').map(issue => issue.kind)).toEqual(['stop', 'target'])
    expect(planIssues([entry('100', '5', '10', 'percent')], 'short')).toEqual([])
    expect(planIssues([entry('', '105', '90')], 'long')).toEqual([])
  })

  it('offers only the corrections that clear every issue', () => {
    const reversed = entry('100', '105', '90')
    const fixes = planFixes({ direction: 'long', entries: [reversed] })
    expect(fixes.reversed).toBe('short')
    expect(fixes.swapped?.[0]).toMatchObject({ stops: reversed.targets, targets: reversed.stops })
    // A stop above the entry with a target also above it: neither swapping nor switching fixes both.
    expect(planFixes({ direction: 'long', entries: [entry('100', '105', '110')] })).toEqual({ swapped: null, reversed: null })
    expect(planFixes({ direction: 'long', entries: [entry('100', '95', '110')] })).toEqual({ swapped: null, reversed: null })
  })
})
