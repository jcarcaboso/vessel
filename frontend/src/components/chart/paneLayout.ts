import type { IndicatorPaneId, PaneSize } from './indicators'

/**
 * Pixel layout of the price pane and the indicator panes below it. Pure, so the rules can be tested
 * without a canvas; the renderer applies the heights and reports the result.
 */

/** A minimized pane: only its control bar. */
export const barHeight = 26
/** Smallest open indicator pane: its bar, value margins and a readable plot. */
export const minOpenHeight = 72
/** Smallest price pane while indicator panes are open. */
export const minPriceHeight = 120

/** Shares of the space left after minimized bars; the price pane weighs 1. */
const weights: Record<IndicatorPaneId, Record<Exclude<PaneSize, 'minimized'>, number>> = {
  volume: { normal: 0.18, maximized: 2.4 },
  rsi: { normal: 0.24, maximized: 2.4 },
}
/** When the chart is too short, Volume gives way before RSI, and a maximized pane last. */
const compactOrder: readonly IndicatorPaneId[] = ['volume', 'rsi']

export interface PaneRequest {
  id: IndicatorPaneId
  /** The size the owner chose. */
  size: PaneSize
}

export interface SolvedPane {
  id: IndicatorPaneId
  height: number
  /** What is shown: the chosen size, or minimized when the chart is too short to plot the pane. */
  effectiveSize: PaneSize
  /** True when the pane is minimized only for lack of room. */
  compacted: boolean
}

export interface SolvedLayout {
  price: number
  panes: SolvedPane[]
}

/**
 * Divides `available` pixels between the price pane and the indicator panes. Minimized panes get
 * their bar; the rest is shared by weight (or by `preferred` heights, e.g. after a separator drag),
 * with floors for the price pane and open indicator panes. Panes that cannot fit at their floor are
 * shown minimized, Volume first, then RSI, keeping a maximized pane open longest.
 */
/** Smallest price pane kept when every indicator pane is shown as a bar. */
const minPriceSliver = 20

/** Returns null when the chart is too short even for the bars and a sliver of price. */
export function solvePaneLayout(available: number, requests: readonly PaneRequest[], preferred?: readonly number[] | null): SolvedLayout | null {
  if (!(available >= requests.length * barHeight + minPriceSliver)) return requests.length ? null : { price: Math.max(0, available), panes: [] }
  const effective = requests.map(request => request.size)
  const open = (index: number) => effective[index] !== 'minimized'
  const needed = () => minPriceHeight + effective.reduce((sum, size) => sum + (size === 'minimized' ? barHeight : minOpenHeight), 0)
  const order = [...requests.keys()].sort((a, b) =>
    Number(requests[a]!.size === 'maximized') - Number(requests[b]!.size === 'maximized')
    || compactOrder.indexOf(requests[a]!.id) - compactOrder.indexOf(requests[b]!.id))
  for (const index of order) {
    if (requests.length === 0 || needed() <= available) break
    if (open(index)) effective[index] = 'minimized'
  }

  const bars = effective.filter(size => size === 'minimized').length * barHeight
  const room = Math.max(0, available - bars)
  // Index 0 is the price pane; indicator i is index i + 1.
  const usePreferred = preferred?.length === requests.length + 1 && preferred.every(value => Number.isFinite(value) && value >= 0)
  const weight = (index: number) => {
    if (usePreferred) return Math.max(preferred[index]!, 1)
    if (index === 0) return 1
    const size = effective[index - 1]!
    return size === 'minimized' ? 0 : weights[requests[index - 1]!.id][size]
  }
  const floor = (index: number) => index === 0 ? Math.min(minPriceHeight, room) : minOpenHeight
  const flexible = [0, ...requests.map((_, index) => index + 1).filter(index => open(index - 1))]
  const heights = new Array<number>(requests.length + 1).fill(barHeight)
  // Share by weight; any pane under its floor is pinned there and the rest is shared again.
  const pinned = new Set<number>()
  for (;;) {
    const free = flexible.filter(index => !pinned.has(index))
    const left = room - [...pinned].reduce((sum, index) => sum + floor(index), 0)
    const total = free.reduce((sum, index) => sum + weight(index), 0)
    for (const index of pinned) heights[index] = floor(index)
    for (const index of free) heights[index] = total > 0 ? left * weight(index) / total : 0
    const short = free.filter(index => heights[index]! < floor(index))
    if (!short.length || short.length === free.length) break
    for (const index of short) pinned.add(index)
  }
  // Rounding and pinning leftovers go to the price pane, so the heights always fill the room.
  const used = heights.reduce((sum, height, index) => sum + (index === 0 ? 0 : height), 0)
  heights[0] = Math.max(0, available - used)

  return {
    price: heights[0]!,
    panes: requests.map((request, index) => ({
      id: request.id,
      height: heights[index + 1]!,
      effectiveSize: effective[index]!,
      compacted: request.size !== 'minimized' && effective[index] === 'minimized',
    })),
  }
}
