import type { ExecutionFill, ExecutionOrder, LinkOrder, OrderLink } from '@/api/plays'
import type { DraftEntry } from './draft'

export function describeOrder(order: ExecutionOrder) {
  const side = order.side === 'B' ? 'Buy' : 'Sell'
  const price = order.triggerPrice ? `trigger ${order.triggerPrice}` : `at ${order.limitPrice}`
  const size = order.isPositionTpsl ? 'whole position' : order.originalSize
  return `${side} ${order.orderType.toLowerCase()} ${price} · ${size}`
}

/** Targets are always numbered; a single stop is just "stop", like the chart tags. */
const exitName = (entry: DraftEntry, kind: 'stop' | 'target', index: number) =>
  kind === 'target' || entry.stops.length > 1 ? `${entry.name} ${kind} ${index + 1}` : `${entry.name} ${kind}`

/** Readable name of a plan level, e.g. "Entry 1 target 2". */
export function levelName(entries: readonly DraftEntry[], link: Pick<OrderLink, 'role' | 'entryId' | 'levelId'>) {
  if (link.role === 'exit') return 'Unplanned exit'
  const entry = entries.find(item => item.id === link.entryId)
  if (link.role === 'entry') return entry?.name ?? 'Removed entry'
  const index = (link.role === 'stop' ? entry?.stops : entry?.targets)?.findIndex(exit => exit.id === link.levelId) ?? -1
  return entry && index >= 0 ? exitName(entry, link.role, index) : `${entry?.name ?? 'Removed entry'} removed ${link.role}`
}

export function levelOptions(entries: readonly DraftEntry[], open: boolean) {
  const options: Array<{ value: string; label: string; request: Omit<LinkOrder, 'orderId'> }> = []
  for (const entry of entries) {
    options.push({ value: `entry|${entry.id}`, label: entry.name, request: { role: 'entry', entryId: entry.id } })
    for (const kind of ['stop', 'target'] as const) (kind === 'stop' ? entry.stops : entry.targets).forEach((exit, index) => options.push({
      value: `${kind}|${entry.id}|${exit.id}`, label: exitName(entry, kind, index), request: { role: kind, entryId: entry.id, levelId: exit.id },
    }))
  }
  if (open) options.push({ value: 'exit', label: 'Unplanned exit', request: { role: 'exit' } })
  return options
}

/** "Open Long · 3 fills, average 84541". The average is weighted by quantity and only for display. */
export function fillSummary(fills: readonly ExecutionFill[]) {
  if (fills.length === 1) return `${fills[0]!.direction} ${fills[0]!.quantity} at ${fills[0]!.price}`
  const quantity = fills.reduce((sum, fill) => sum + Number(fill.quantity), 0)
  const average = fills.reduce((sum, fill) => sum + Number(fill.price) * Number(fill.quantity), 0) / quantity
  const directions = [...new Set(fills.map(fill => fill.direction))].join(', ')
  return `${directions} · ${fills.length} fills, average ${Number(average.toPrecision(8))}`
}
