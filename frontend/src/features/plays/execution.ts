import type { ExecutionFill, ExecutionOrder, LinkOrder, OrderLink } from '@/api/plays'
import type { DraftEntry } from './draft'

export function describeOrder(order: ExecutionOrder) {
  const side = order.side === 'B' ? 'Buy' : 'Sell'
  const price = order.triggerPrice ? `trigger ${order.triggerPrice}` : `at ${order.limitPrice}`
  const size = order.isPositionTpsl ? 'whole position' : order.originalSize
  return `${side} ${order.orderType.toLowerCase()} ${price} · ${size}`
}

/** Readable name of a plan level, e.g. "Entry 1 target 2". */
export function levelName(entries: readonly DraftEntry[], link: Pick<OrderLink, 'role' | 'entryId' | 'targetId'>) {
  if (link.role === 'exit') return 'Unplanned exit'
  const entry = entries.find(item => item.id === link.entryId)
  const name = entry?.name ?? 'Removed entry'
  if (link.role === 'entry') return name
  if (link.role === 'stop') return `${name} stop`
  const index = entry?.targets.findIndex(target => target.id === link.targetId) ?? -1
  return index >= 0 ? `${name} target ${index + 1}` : `${name} removed target`
}

export function levelOptions(entries: readonly DraftEntry[], open: boolean) {
  const options: Array<{ value: string; label: string; request: Omit<LinkOrder, 'orderId'> }> = []
  for (const entry of entries) {
    options.push({ value: `entry|${entry.id}`, label: entry.name, request: { role: 'entry', entryId: entry.id } })
    options.push({ value: `stop|${entry.id}`, label: `${entry.name} stop`, request: { role: 'stop', entryId: entry.id } })
    entry.targets.forEach((target, index) => options.push({ value: `target|${entry.id}|${target.id}`, label: `${entry.name} target ${index + 1}`,
      request: { role: 'target', entryId: entry.id, targetId: target.id } }))
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
