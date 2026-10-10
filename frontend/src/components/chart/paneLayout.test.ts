import { describe, expect, it } from 'vitest'
import { barHeight, minOpenHeight, minPriceHeight, solvePaneLayout, type PaneRequest } from './paneLayout'

/** Solves a layout that is expected to fit. */
const solve = (...args: Parameters<typeof solvePaneLayout>) => solvePaneLayout(...args)!
const both = (volume: PaneRequest['size'] = 'normal', rsi: PaneRequest['size'] = 'normal'): PaneRequest[] => [{ id: 'volume', size: volume }, { id: 'rsi', size: rsi }]
const sum = (layout: NonNullable<ReturnType<typeof solvePaneLayout>>) => layout.price + layout.panes.reduce((total, pane) => total + pane.height, 0)
const summary = (layout: ReturnType<typeof solvePaneLayout>) => !layout ? null : [Math.round(layout.price), ...layout.panes.map(pane => `${pane.id}:${Math.round(pane.height)}:${pane.effectiveSize}${pane.compacted ? '*' : ''}`)]

describe('pane layout', () => {
  it('keeps the price pane about 70% with both panes open on desktop heights', () => {
    for (const available of [470, 536, 736]) {
      const layout = solve(available, both())
      expect(sum(layout)).toBeCloseTo(available)
      expect(layout.price / available).toBeGreaterThan(0.6)
      for (const pane of layout.panes) expect(pane.height).toBeGreaterThanOrEqual(minOpenHeight)
    }
    expect(summary(solve(736, both()))).toEqual([518, 'volume:93:normal', 'rsi:124:normal'])
  })

  it('gives a minimized pane exactly its bar', () => {
    const layout = solve(536, both('minimized'))
    expect(layout.panes[0]).toEqual({ id: 'volume', height: barHeight, effectiveSize: 'minimized', compacted: false })
    expect(sum(layout)).toBeCloseTo(536)
  })

  it('keeps the other pane and the price pane at their floors when one is maximized', () => {
    for (const id of ['volume', 'rsi'] as const) {
      const layout = solve(400, both(id === 'volume' ? 'maximized' : 'normal', id === 'rsi' ? 'maximized' : 'normal'))
      const other = layout.panes.find(pane => pane.id !== id)!
      expect(other.height).toBeGreaterThanOrEqual(minOpenHeight)
      expect(layout.price).toBeGreaterThanOrEqual(minPriceHeight)
      expect(layout.panes.find(pane => pane.id === id)!.height).toBeGreaterThan(other.height)
      expect(sum(layout)).toBeCloseTo(400)
    }
  })

  it('compacts Volume first, then RSI, when the chart is too short, without changing the request', () => {
    // Both open need 120 + 72 + 72 = 264; one open and one bar need 218.
    expect(summary(solve(264, both()))).toEqual([120, 'volume:72:normal', 'rsi:72:normal'])
    expect(summary(solve(263, both()))).toEqual([165, 'volume:26:minimized*', 'rsi:72:normal'])
    expect(summary(solve(218, both()))).toEqual([120, 'volume:26:minimized*', 'rsi:72:normal'])
    expect(summary(solve(190, both()))).toEqual([138, 'volume:26:minimized*', 'rsi:26:minimized*'])
  })

  it('keeps a maximized pane open longest', () => {
    expect(summary(solve(230, both('maximized')))).toEqual([120, 'volume:84:maximized', 'rsi:26:minimized*'])
  })

  it('reopens compacted panes when the chart grows again', () => {
    expect(solve(190, both()).panes.every(pane => pane.compacted)).toBe(true)
    expect(solve(536, both()).panes.some(pane => pane.compacted)).toBe(false)
  })

  it('follows dragged proportions and clamps them to the floors', () => {
    const dragged = solve(536, both(), [300, 200, 36])
    expect(Math.round(dragged.panes[0]!.height)).toBeGreaterThan(150)
    expect(dragged.panes[1]!.height).toBe(minOpenHeight)
    expect(sum(dragged)).toBeCloseTo(536)
    // The same proportions on a shorter chart scale down but keep the floors.
    const shorter = solve(400, both(), [300, 200, 36])
    expect(shorter.panes[1]!.height).toBe(minOpenHeight)
    expect(shorter.price).toBeGreaterThanOrEqual(minPriceHeight)
    // Mismatched proportions are ignored.
    expect(solve(536, both(), [1, 2])).toEqual(solve(536, both()))
  })

  it('reports no layout when even the bars do not fit, and handles no indicator panes', () => {
    for (const available of [-20, 0, 20, 71]) expect(solvePaneLayout(available, both())).toBeNull()
    const tiny = solve(72, both())
    expect(sum(tiny)).toBeCloseTo(72)
    expect(tiny.panes.every(pane => pane.height === barHeight && pane.compacted)).toBe(true)
    expect(solve(300, [])).toEqual({ price: 300, panes: [] })
  })
})
