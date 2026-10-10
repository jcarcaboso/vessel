import { describe, expect, it } from 'vitest'
import {
  AS_OF, DAY, breakdown, dailyResults, defaultFilters, eligible, inPeriod, inScope,
  mockPlays, money, periods, summarize, type ReviewPlay,
} from './model'

const play = (overrides: Partial<ReviewPlay> = {}): ReviewPlay => ({
  id: 'test', account: 'core', asset: 'BTC', source: 'planned', at: AS_OF - 100,
  durationHours: 4, netCents: 10000, entryNotionalCents: 500000, riskCents: 5000,
  feesCents: 100, reviewed: false, status: 'closed', feesComplete: true, ...overrides,
})

describe('portfolio review proposal arithmetic', () => {
  it('distinguishes return payoff, dollar profit factor and per-Play expectancy', () => {
    const stats = summarize([
      play({ netCents: 10000, entryNotionalCents: 500000 }),
      play({ netCents: 30000, entryNotionalCents: 1000000 }),
      play({ netCents: -10000, entryNotionalCents: 1000000 }),
      play({ netCents: 0 }),
    ])
    expect(stats).toMatchObject({
      count: 4, wins: 2, losses: 1, scratches: 1, net: 30000,
      averageGain: 2.5, averageLoss: 1, payoff: 2.5, profitFactor: 4, expectancy: 7500,
    })
    expect(stats.batting).toBeCloseTo(2 / 3)
  })

  it('does not score open, unresolved or fee-incomplete records', () => {
    expect(summarize([
      play(), play({ status: 'open' }), play({ status: 'unresolved' }),
      play({ feesComplete: false }), play({ entryNotionalCents: 0 }),
    ])).toMatchObject({ count: 1, net: 10000 })
  })

  it('keeps missing denominators unknown rather than implying zero or infinity', () => {
    expect(summarize([])).toMatchObject({ count: 0, batting: null, payoff: null, profitFactor: null, expectancy: null, drawdown: null, averageR: null })
    expect(summarize([play()])).toMatchObject({ batting: 1, payoff: null, profitFactor: null })
    expect(summarize([play({ netCents: -10000 })])).toMatchObject({ batting: 0, payoff: null, profitFactor: 0 })
    expect(summarize([play({ netCents: 0 })])).toMatchObject({ batting: null, scratches: 1, profitFactor: null, expectancy: 0 })
    expect(money(null)).toBe('N/A')
    expect(money(0)).toBe('$0')
  })

  it('uses known risk only, without making up a risk for imported history', () => {
    const stats = summarize([play(), play({ source: 'imported', riskCents: null }), play({ riskCents: 0 })])
    expect(stats.averageR).toBe(2)
    expect(stats.riskCount).toBe(1)
    expect(stats.count).toBe(3)
  })

  it('walks chronological closes for drawdown and ignores scratches in streaks', () => {
    const rows = [10000, -3000, 0, -4000, 8000, 2000].map((netCents, i) => play({ id: String(i), at: AS_OF - (6 - i) * DAY, netCents }))
    const stats = summarize(rows.reverse())
    expect(stats).toMatchObject({ net: 13000, drawdown: 7000, maxWins: 2, maxLosses: 2, streak: 2 })
  })

  it('sums already-net mock results without subtracting execution fees again', () => {
    expect(summarize([play({ netCents: 1234, feesCents: 80 })])).toMatchObject({ net: 1234, fees: 80 })
  })
})

describe('portfolio review scope and periods', () => {
  it('includes unassigned accounts exactly once in the aggregate', () => {
    const rows = [play(), play({ account: 'lab', netCents: -5000 }), play({ account: 'active' })]
    expect(inScope(rows, defaultFilters)).toHaveLength(3)
    expect(inScope(rows, { ...defaultFilters, portfolio: 'swing' })).toHaveLength(1)
    expect(inScope(rows, { ...defaultFilters, portfolio: 'unassigned' })).toHaveLength(1)
    const groups = breakdown(rows, 'portfolio')
    expect(groups.reduce((n, row) => n + row.net, 0)).toBe(summarize(rows).net)
    expect(groups.find(row => row.id === 'unassigned')?.name).toBe('Unassigned')
  })

  it('pools the plays rather than averaging group batting percentages', () => {
    const rows = [play(), ...Array.from({ length: 3 }, (_, i) => play({ id: String(i), account: 'active', netCents: -100 })) ]
    expect(summarize(rows).batting).toBe(.25)
    expect(breakdown(rows, 'account').map(row => row.batting)).toEqual([1, 0])
  })

  it('intersects account, portfolio, asset and source filters', () => {
    const filters = { portfolio: 'swing', account: 'satellite', asset: 'ETH', source: 'imported' as const }
    const rows = inScope(mockPlays, filters)
    expect(rows.length).toBeGreaterThan(0)
    expect(rows.every(row => row.account === 'satellite' && row.asset === 'ETH' && row.source === 'imported')).toBe(true)
    expect(inScope(mockPlays, { ...filters, portfolio: 'intraday' })).toEqual([])
  })

  it.each(periods.filter(p => p.id !== 'all'))('uses exact rolling UTC bounds for $id', period => {
    const start = AS_OF - period.days * DAY
    const rows = [play({ at: start }), play({ at: start + 1 }), play({ at: AS_OF }), play({ at: AS_OF + 1 })]
    expect(inPeriod(rows, period.id).map(row => row.at)).toEqual([start + 1, AS_OF])
  })

  it('all recorded includes older history, but never future results', () => {
    const old = play({ at: AS_OF - 500 * DAY })
    expect(inPeriod([old, play({ at: AS_OF + 1 })], 'all')).toEqual([old])
  })

  it.each(periods)('keeps chart, breakdown and scorecard totals equal for $id', period => {
    const rows = inPeriod(mockPlays, period.id)
    const stats = summarize(rows)
    const chart = dailyResults(rows, period.id)
    expect(chart.at(-1)?.cumulative).toBe(stats.net)
    expect(chart.reduce((n, point) => n + point.count, 0)).toBe(stats.count)
    for (const group of ['portfolio', 'account', 'asset'] as const) {
      expect(breakdown(rows, group).reduce((n, row) => n + row.net, 0)).toBe(stats.net)
    }
  })

  it('includes many synthetic records without duplicate identities or invented imported risk', () => {
    expect(mockPlays.filter(eligible).length).toBeGreaterThan(700)
    expect(new Set(mockPlays.map(row => row.id)).size).toBe(mockPlays.length)
    expect(mockPlays.filter(row => row.source === 'imported').every(row => row.riskCents === null)).toBe(true)
  })
})
