import { describe, expect, it } from 'vitest'
import { createEntry, createTarget, type DraftEntry } from './draft'
import {
  addChartStop, addChartTarget, applyEntryEdit, applyLevelDrag, averageEntryPrice, averageOverlayId, formatDraggedPrice, levelPrice,
  overlayPrice, parseOverlayId, planOverlays, removeTarget, setTargetShare,
} from './levels'

function entry(index: number, patch: Partial<DraftEntry> = {}): DraftEntry {
  return { ...createEntry(index), ...patch }
}

describe('planned level overlays', () => {
  it('plots entry, stop and targets, resolving percentage distances by direction', () => {
    const first = entry(0, {
      price: '100', stop: { id: 's', unit: 'percent', value: '5' },
      targets: [{ ...createTarget('50'), unit: 'price', value: '120' }, { ...createTarget('50'), unit: 'percent', value: '10' }],
    })
    const long = planOverlays([first], first.id, 'aggregate', 'long')
    expect(long.map(o => [o.label, o.kind, o.price])).toEqual([
      ['E1', 'entry', 100], ['E1 SL', 'stop', 95], ['E1 TP1', 'target', 120], ['E1 TP2', 'target', 110.00000000000001],
    ])
    const short = planOverlays([first], first.id, 'aggregate', 'short')
    expect(short.find(o => o.kind === 'stop')!.price).toBeCloseTo(105)
    expect(long.every(o => o.draggable && o.emphasis === 'selected' && o.accent === first.color)).toBe(true)
    expect(long.map(o => o.color)).toEqual([first.color, 'var(--negative)', 'var(--positive)', 'var(--positive)'])
  })

  it('omits blank or invalid values and percentages without an entry price', () => {
    const blank = entry(0, { price: '', stop: { id: 's', unit: 'percent', value: '5' } })
    const invalid = entry(1, { price: '-3', stop: { id: 't', unit: 'price', value: 'abc' } })
    expect(planOverlays([blank, invalid], blank.id, 'aggregate', 'long')).toEqual([])
    expect(levelPrice(100, { id: 'x', unit: 'percent', value: '150' }, 'stop', 'long')).toBeNull()
  })

  it('keeps other entries in aggregate and hides them in the selected view', () => {
    const first = entry(0, { price: '100' })
    const second = entry(1, { price: '90' })
    const aggregate = planOverlays([first, second], second.id, 'aggregate', 'long')
    expect(aggregate.map(o => [o.label, o.emphasis, o.draggable])).toEqual([['E1', 'normal', true], ['E2', 'selected', true]])
    expect(planOverlays([first, second], second.id, 'selected', 'long').map(o => o.label)).toEqual(['E2'])
  })
})

describe('dragging planned levels', () => {
  it('writes prices with five significant figures and no exponent', () => {
    expect(formatDraggedPrice(65432.123)).toBe('65432')
    expect(formatDraggedPrice(123456.7)).toBe('123457')
    expect(formatDraggedPrice(1.234567)).toBe('1.2346')
    expect(formatDraggedPrice(0.0000123456)).toBe('0.00001235')
  })

  it('keeps each level in its own unit and leaves other entries untouched', () => {
    const first = entry(0, {
      price: '100', stop: { id: 's', unit: 'percent', value: '5' },
      targets: [{ ...createTarget('100'), id: 't1', unit: 'price', value: '120' }],
    })
    const other = entry(1, { price: '80' })
    const overlays = planOverlays([first, other], first.id, 'aggregate', 'long')
    const stopId = overlays.find(o => o.kind === 'stop' && o.label === 'E1 SL')!.id
    const targetId = overlays.find(o => o.kind === 'target')!.id
    const entryId = overlays.find(o => o.label === 'E1')!.id

    let entries = applyLevelDrag([first, other], stopId, 92.5, 'long')
    expect(entries[0]!.stop).toEqual({ id: 's', unit: 'percent', value: '7.5' })
    expect(entries[1]).toBe(other)
    entries = applyLevelDrag(entries, targetId, 131.234, 'long')
    expect(entries[0]!.targets[0]!.value).toBe('131.23')
    entries = applyLevelDrag(entries, entryId, 101.11, 'long')
    expect(entries[0]!.price).toBe('101.11')
    expect(entries[0]!.stop.value).toBe('7.5')
  })

  it('clamps percentage levels at the entry instead of flipping sides', () => {
    const first = entry(0, { price: '100', stop: { id: 's', unit: 'percent', value: '5' } })
    const stopId = planOverlays([first], first.id, 'aggregate', 'short').find(o => o.kind === 'stop')!.id
    expect(applyLevelDrag([first], stopId, 98, 'short')[0]!.stop.value).toBe('0')
    expect(applyLevelDrag([first], stopId, 110, 'short')[0]!.stop.value).toBe('10')
  })

  it('ignores unknown ids and invalid prices', () => {
    const first = entry(0, { price: '100' })
    expect(parseOverlayId('nonsense')).toBeNull()
    expect(applyLevelDrag([first], 'nonsense', 10, 'long')[0]).toBe(first)
    expect(applyLevelDrag([first], `${first.id}|entry`, Number.NaN, 'long')[0]).toBe(first)
  })
})

describe('average planned entry', () => {
  it('weights entry prices by quantity share in the aggregate view only', () => {
    const first = entry(0, { price: '100', share: '60' })
    const second = entry(1, { price: '90', share: '40' })
    expect(averageEntryPrice([first, second])).toBeCloseTo(96)
    const average = planOverlays([first, second], first.id, 'aggregate', 'long').find(o => o.id === averageOverlayId)!
    expect(average).toMatchObject({ label: 'AVG', kind: 'reference', draggable: false })
    expect(average.price).toBeCloseTo(96)
    expect(parseOverlayId(average.id)).toBeNull()
    expect(planOverlays([first, second], first.id, 'selected', 'long').some(o => o.id === averageOverlayId)).toBe(false)
  })

  it('normalizes over contributing entries and needs at least two', () => {
    const priced = entry(0, { price: '100', share: '30' })
    const other = entry(1, { price: '80', share: '10' })
    const unpriced = entry(2, { price: '', share: '60' })
    const unshared = entry(3, { price: '50', share: '' })
    expect(averageEntryPrice([priced, other, unpriced, unshared])).toBeCloseTo(95)
    expect(averageEntryPrice([priced, unpriced])).toBeNull()
    expect(averageEntryPrice([priced, entry(1, { price: '90', share: '0' })])).toBeNull()
  })
})

describe('chart level editing helpers', () => {
  it('adds targets beyond the entry and a stop on the risk side, as prices', () => {
    const base = entry(0, { price: '100', stop: { id: 's', unit: 'percent', value: '' }, targets: [] })
    expect(addChartTarget(base, 'long')!.targets[0]).toMatchObject({ unit: 'price', value: '102', share: '' })
    expect(addChartTarget(base, 'short')!.targets[0]!.value).toBe('98')
    expect(addChartStop(base, 'long')!.stop).toEqual({ id: 's', unit: 'price', value: '98' })
    expect(addChartStop(base, 'short')!.stop.value).toBe('102')
    expect(addChartTarget({ ...base, price: '' }, 'long')).toBeNull()
  })

  it('removes and re-shares targets and reports plotted prices', () => {
    const first = entry(0, { price: '100', targets: [{ ...createTarget('50'), id: 'a', value: '110' }, { ...createTarget('50'), id: 'b', unit: 'percent', value: '5' }] })
    expect(removeTarget(first, 'a').targets.map(t => t.id)).toEqual(['b'])
    expect(setTargetShare(first, 'b', '70').targets[1]!.share).toBe('70')
    expect(overlayPrice(first, `${first.id}|target|b`, 'long')).toBeCloseTo(105)
    expect(overlayPrice(first, `${first.id}|entry`, 'long')).toBe(100)
    expect(overlayPrice(first, 'other|entry', 'long')).toBeNull()
  })

  it('reapplies only the fields an edit changed', () => {
    const before = entry(0, { price: '100', share: '50' })
    const after = { ...before, price: '101' }
    const sideEdited = { ...after, share: '70' }
    expect(applyEntryEdit(sideEdited, after, before)).toEqual({ ...sideEdited, price: '100' })
    expect(applyEntryEdit({ ...before, share: '70' }, before, after)).toEqual({ ...before, share: '70', price: '101' })
  })

  it('reverts one chart target edit without touching sibling targets edited later', () => {
    const tp1 = { ...createTarget('50'), id: 'tp1', value: '90000' }
    const tp2 = { ...createTarget('50'), id: 'tp2', value: '92000' }
    const before = entry(0, { price: '85000', targets: [tp1, tp2] })
    const chartEdit = { ...before, targets: [{ ...tp1, value: '91000' }, tp2] }
    const sidebar = { ...chartEdit, targets: [chartEdit.targets[0]!, { ...tp2, value: '93000' }] }
    const undone = applyEntryEdit(sidebar, chartEdit, before)
    expect(undone.targets.map(t => t.value)).toEqual(['90000', '93000'])
    const redone = applyEntryEdit(undone, before, chartEdit)
    expect(redone.targets.map(t => t.value)).toEqual(['91000', '93000'])
  })

  it('undoes target additions and removals by ID and keeps targets added elsewhere', () => {
    const tp1 = { ...createTarget('100'), id: 'tp1', value: '110' }
    const before = entry(0, { price: '100', targets: [tp1] })
    const added = { ...before, targets: [tp1, { ...createTarget(), id: 'tp2', value: '104' }] }
    const sideAdded = { ...added, targets: [...added.targets, { ...createTarget(), id: 'tp3', value: '120' }] }
    expect(applyEntryEdit(sideAdded, added, before).targets.map(t => t.id)).toEqual(['tp1', 'tp3'])
    const removed = { ...before, targets: [] }
    const sideAfterRemove = { ...removed, targets: [{ ...createTarget(), id: 'tp9', value: '130' }] }
    expect(applyEntryEdit(sideAfterRemove, removed, before).targets.map(t => t.id)).toEqual(['tp1', 'tp9'])
  })

  it('reverts only the changed stop sub-field', () => {
    const before = entry(0, { price: '100', stop: { id: 's', unit: 'price', value: '95' } })
    const chartEdit = { ...before, stop: { ...before.stop, value: '94' } }
    const sideUnit = { ...chartEdit, share: '40' }
    expect(applyEntryEdit(sideUnit, chartEdit, before)).toEqual({ ...sideUnit, stop: { id: 's', unit: 'price', value: '95' } })
  })
})
