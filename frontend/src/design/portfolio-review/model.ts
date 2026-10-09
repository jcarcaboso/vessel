// Synthetic design fixtures only. No account, venue or production API reads.
export const DAY = 86_400_000
export const AS_OF = Date.parse('2026-10-08T18:00:00Z')
export const portfolios = [
  { id: 'swing', name: 'Core swing' },
  { id: 'intraday', name: 'Intraday' },
  { id: 'systematic', name: 'Systematic' },
]
export const accounts = [
  { id: 'core', name: 'Main account', venue: 'Hyperliquid', portfolio: 'swing', winRate: .63 },
  { id: 'satellite', name: 'Satellite', venue: 'RISEx', portfolio: 'swing', winRate: .57 },
  { id: 'active', name: 'Active trading', venue: 'Hyperliquid', portfolio: 'intraday', winRate: .43 },
  { id: 'trend', name: 'Trend following', venue: 'Manual', portfolio: 'systematic', winRate: .48 },
  { id: 'lab', name: 'Research account', venue: 'Hyperliquid', portfolio: 'unassigned', winRate: .44 },
]
export const assets = ['BTC', 'ETH', 'SOL', 'HYPE']
export const periods = [
  { id: 'day', label: '1D', title: 'Last 24 hours', days: 1 },
  { id: 'week', label: '7D', title: 'Last 7 days', days: 7 },
  { id: 'month', label: 'Month', title: 'Last 30 days', days: 30 },
  { id: 'year', label: 'Year', title: 'Last 365 days', days: 365 },
  { id: 'all', label: 'All', title: 'All recorded', days: Infinity },
] as const
export type Period = typeof periods[number]['id']
export type Source = 'all' | 'planned' | 'imported'
export type Group = 'portfolio' | 'account' | 'asset'
export type Filters = { portfolio: string; account: string; asset: string; source: Source }
export const defaultFilters: Filters = { portfolio: 'all', account: 'all', asset: 'all', source: 'all' }
export type ReviewPlay = {
  id: string
  account: string
  asset: string
  source: 'planned' | 'imported'
  // Close time for closed plays, observation time for excluded records.
  at: number
  durationHours: number
  netCents: number
  entryNotionalCents: number
  riskCents: number | null
  feesCents: number
  reviewed: boolean
  status: 'closed' | 'open' | 'unresolved'
  feesComplete: boolean
}

function fixtures(): ReviewPlay[] {
  let seed = 491
  const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296)
  const rows: ReviewPlay[] = []
  for (let day = 420; day >= 0; day--) {
    accounts.forEach((account, accountIndex) => {
      if (random() > (account.id === 'lab' ? .16 : .49)) return
      const available = account.id === 'satellite' ? assets.slice(0, 3) : assets
      const asset = available[Math.floor(random() * available.length)]!
      const source = random() > .30 ? 'planned' : 'imported'
      const wins = random() < account.winRate - (asset === 'HYPE' ? .22 : 0)
      const scratch = random() < .035
      const entryNotionalCents = Math.round((account.id === 'lab' ? 150_000 : 700_000) + random() * 1_100_000)
      const move = (wins ? .009 + random() * .035 : -.006 - random() * .012) * (account.id === 'active' ? .65 : 1)
      const at = AS_OF - day * DAY - (accountIndex * 2 + 1) * 3_600_000
      rows.push({
        id: `P-${String(rows.length + 1).padStart(4, '0')}`, account: account.id, asset, source, at,
        durationHours: account.id === 'active' ? 1 + random() * 10 : 12 + random() * 120,
        netCents: scratch ? 0 : Math.round(entryNotionalCents * move), entryNotionalCents,
        riskCents: source === 'imported' ? null : Math.round(entryNotionalCents * .012),
        feesCents: Math.round(entryNotionalCents * .0004), reviewed: random() > .24,
        status: 'closed', feesComplete: true,
      })
    })
  }
  // Explicit gaps demonstrate why fills and incomplete imports are not scored.
  for (let i = 0; i < 9; i++) {
    rows.push({
      id: `pending-${i}`, account: accounts[i % accounts.length]!.id, asset: assets[i % assets.length]!,
      source: 'imported', at: AS_OF - (i + .5) * DAY, durationHours: 0, netCents: 0,
      entryNotionalCents: 0, riskCents: null, feesCents: 0, reviewed: false,
      status: i < 4 ? 'unresolved' : i < 7 ? 'open' : 'closed', feesComplete: i < 7,
    })
  }
  return rows.sort((a, b) => a.at - b.at || a.id.localeCompare(b.id))
}
export const mockPlays = fixtures()
export const eligible = (play: ReviewPlay) => play.status === 'closed' && play.feesComplete && play.entryNotionalCents > 0
export function inScope(rows: ReviewPlay[], filters: Filters): ReviewPlay[] {
  return rows.filter(row => {
    const account = accounts.find(a => a.id === row.account)
    return account && (filters.portfolio === 'all' || account.portfolio === filters.portfolio)
      && (filters.account === 'all' || row.account === filters.account)
      && (filters.asset === 'all' || row.asset === filters.asset)
      && (filters.source === 'all' || row.source === filters.source)
  })
}
export function inPeriod(rows: ReviewPlay[], period: Period): ReviewPlay[] {
  const start = AS_OF - periods.find(p => p.id === period)!.days * DAY
  return rows.filter(row => row.at > start && row.at <= AS_OF)
}
const mean = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null
const ratio = (top: number | null, bottom: number | null) => top !== null && bottom !== null && bottom > 0 ? top / bottom : null
export function summarize(input: ReviewPlay[]) {
  const rows = input.filter(eligible).sort((a, b) => a.at - b.at || a.id.localeCompare(b.id))
  const wins = rows.filter(p => p.netCents > 0)
  const losses = rows.filter(p => p.netCents < 0)
  const sum = (plays: ReviewPlay[]) => plays.reduce((n, p) => n + p.netCents, 0)
  const net = sum(rows)
  const averageGain = mean(wins.map(p => p.netCents / p.entryNotionalCents * 100))
  const averageLoss = mean(losses.map(p => -p.netCents / p.entryNotionalCents * 100))
  let cumulative = 0, peak = 0, drawdown = 0, streak = 0, maxWins = 0, maxLosses = 0
  for (const row of rows) {
    cumulative += row.netCents
    peak = Math.max(peak, cumulative)
    drawdown = Math.max(drawdown, peak - cumulative)
    if (row.netCents === 0) continue
    streak = row.netCents > 0 ? Math.max(0, streak) + 1 : Math.min(0, streak) - 1
    maxWins = Math.max(maxWins, streak)
    maxLosses = Math.max(maxLosses, -streak)
  }
  const knownRisk = rows.filter(p => p.riskCents !== null && p.riskCents > 0)
  return {
    count: rows.length, wins: wins.length, losses: losses.length, scratches: rows.length - wins.length - losses.length,
    net, batting: ratio(wins.length, wins.length + losses.length),
    averageGain, averageLoss, payoff: ratio(averageGain, averageLoss),
    profitFactor: ratio(sum(wins), -sum(losses)),
    averageWin: mean(wins.map(p => p.netCents)), averageLossCents: mean(losses.map(p => -p.netCents)),
    expectancy: rows.length ? net / rows.length : null,
    averageR: mean(knownRisk.map(p => p.netCents / p.riskCents!)), riskCount: knownRisk.length,
    fees: rows.reduce((n, p) => n + p.feesCents, 0),
    reviewed: rows.filter(p => p.reviewed).length, durationHours: mean(rows.map(p => p.durationHours)),
    drawdown: rows.length ? drawdown : null, maxWins, maxLosses, streak,
  }
}
export function breakdown(rows: ReviewPlay[], group: Group) {
  const groups = new Map<string, ReviewPlay[]>()
  rows.filter(eligible).forEach(row => {
    const account = accounts.find(a => a.id === row.account)!
    const key = group === 'asset' ? row.asset : group === 'account' ? account.id : account.portfolio
    groups.set(key, [...(groups.get(key) ?? []), row])
  })
  return [...groups].map(([id, plays]) => ({
    id,
    name: group === 'asset' ? id : group === 'account' ? accounts.find(a => a.id === id)!.name : portfolios.find(p => p.id === id)?.name ?? 'Unassigned',
    detail: group === 'asset' ? 'Perpetual' : group === 'account' ? accounts.find(a => a.id === id)!.venue : `${new Set(plays.map(p => p.account)).size} account${new Set(plays.map(p => p.account)).size === 1 ? '' : 's'}`,
    ...summarize(plays),
  })).sort((a, b) => b.net - a.net)
}
export function dailyResults(rows: ReviewPlay[], period: Period) {
  const accepted = rows.filter(eligible)
  const days = periods.find(p => p.id === period)!.days
  const start = Number.isFinite(days) ? AS_OF - days * DAY + 1 : Math.min(...accepted.map(p => p.at), AS_OF)
  const totals = new Map<string, { net: number; count: number }>()
  accepted.forEach(row => {
    const key = new Date(row.at).toISOString().slice(0, 10)
    const previous = totals.get(key) ?? { net: 0, count: 0 }
    totals.set(key, { net: previous.net + row.netCents, count: previous.count + 1 })
  })
  const series: { date: string; net: number; cumulative: number; count: number; drawdown: number }[] = []
  let cumulative = 0, peak = 0
  for (let at = Math.floor(start / DAY) * DAY; at <= AS_OF; at += DAY) {
    const date = new Date(at).toISOString().slice(0, 10)
    const result = totals.get(date) ?? { net: 0, count: 0 }
    cumulative += result.net
    peak = Math.max(peak, cumulative)
    series.push({ date, ...result, cumulative, drawdown: cumulative - peak })
  }
  return series
}
export function money(cents: number | null, signed = false) {
  return cents === null ? 'N/A' : new Intl.NumberFormat('en-US', {
    style: 'currency', currency: 'USD', maximumFractionDigits: 0,
    signDisplay: signed ? 'exceptZero' : 'auto',
  }).format(cents === 0 ? 0 : cents / 100)
}
export const percent = (value: number | null) => value === null ? 'N/A' : `${value.toFixed(1)}%`
export const multiple = (value: number | null) => value === null ? 'N/A' : `${value.toFixed(2)}×`
export const shortDate = (at: number | string) => new Date(at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })
