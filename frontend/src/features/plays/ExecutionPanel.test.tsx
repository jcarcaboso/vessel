import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { ExecutionOrder, PlayExecution } from '@/api/plays'
import { ExecutionPanel } from './ExecutionPanel'
import { createDraft } from './draft'
import { fillSummary } from './execution'

const entry = { ...createDraft().entries[0]!, id: 'e1', name: 'Entry 1', price: '100' }
const entries = [{ ...entry, stops: [{ ...entry.stops[0]!, id: 's1', value: '95' }], targets: [{ ...entry.targets[0]!, id: 't1', value: '110' }] }]
const order = (orderId: string, overrides: Partial<ExecutionOrder> = {}): ExecutionOrder => ({
  orderId, side: 'B', orderType: 'Limit', limitPrice: '100', triggerPrice: null, reduceOnly: false, isPositionTpsl: false,
  originalSize: '0.5', remainingSize: '0.5', placedAtUtc: '2026-10-03T10:00:00Z', status: 'open', venueStatus: 'open',
  statusAtUtc: '2026-10-03T10:00:00Z', ...overrides,
})
const execution: PlayExecution = {
  playId: '00000000-0000-4000-8000-000000000001', status: 'open', tracked: true, reason: null, checkedAtUtc: '2026-10-03T10:05:00Z',
  totals: { enteredQuantity: '0.5', exitedQuantity: '0', openQuantity: '0.5', closedPnlUsd: '0', fees: [{ token: 'USDC', amount: '0.02' }] },
  entries: [{ entryId: 'e1', filledQuantity: '0.5', averageFillPrice: '100', restingOrders: 0 }],
  links: [{ id: '00000000-0000-4000-8000-0000000000a1', role: 'entry', entryId: 'e1', levelId: null, state: 'linked', source: 'automatic',
    order: order('11', { status: 'filled' }), filledQuantity: '0.5',
    fills: [{ sourceFillId: 'f1', direction: 'Open Long', price: '100', quantity: '0.5', fee: '0.02', feeToken: 'USDC', closedPnlUsd: '0', occurredAtUtc: '2026-10-03T10:01:00Z' }] }],
  suggestions: [{ id: '00000000-0000-4000-8000-0000000000a2', role: 'stop', entryId: 'e1', levelId: 's1', state: 'suggested', source: 'automatic',
    order: order('12', { side: 'A', orderType: 'Stop Market', triggerPrice: '95', reduceOnly: true }), filledQuantity: '0', fills: [] }],
  unlinkedOrders: [order('13', { side: 'A', limitPrice: '110', reduceOnly: true })],
  notice: 'Orders and fills come from the venue.',
}

describe('execution panel', () => {
  it('shows linked fills, asks about ambiguous orders and links others by hand', async () => {
    const onLink = vi.fn()
    const onUnlink = vi.fn()
    const onCheck = vi.fn()
    const user = userEvent.setup()
    render(<ExecutionPanel execution={execution} error={null} busy={false} entries={entries} onCheck={onCheck} onLink={onLink} onUnlink={onUnlink} />)
    expect(screen.getByText('Still open').nextSibling).toHaveTextContent('0.5')
    expect(screen.getByText('0.02 USDC')).toBeInTheDocument()
    const linked = screen.getByRole('region', { name: 'Linked orders' })
    expect(within(linked).getByText('Entry 1')).toBeInTheDocument()
    expect(within(linked).getByText(/Buy limit at 100 · 0.5 · filled · filled 0.5 · linked automatically/)).toBeInTheDocument()
    expect(within(linked).getByText('Open Long 0.5 at 100')).toBeInTheDocument()
    expect(fillSummary([{ ...execution.links[0]!.fills[0]!, quantity: '1', price: '100' }, { ...execution.links[0]!.fills[0]!, quantity: '3', price: '104' }]))
      .toBe('Open Long · 2 fills, average 103')

    const confirm = screen.getByRole('region', { name: 'Orders to confirm' })
    expect(within(confirm).getByText('Entry 1 stop')).toBeInTheDocument()
    await user.click(within(confirm).getByRole('button', { name: /Link here/ }))
    expect(onLink).toHaveBeenCalledWith({ orderId: '12', role: 'stop', entryId: 'e1', levelId: 's1' })
    await user.click(within(confirm).getByRole('button', { name: 'Not this play' }))
    expect(onUnlink).toHaveBeenCalledWith('00000000-0000-4000-8000-0000000000a2')

    const other = screen.getByRole('region', { name: 'Other orders on this instrument' })
    const link = within(other).getByRole('button', { name: /Link/ })
    expect(link).toBeDisabled()
    const select = within(other).getByRole('combobox', { name: 'Level for order 13' })
    expect(within(select).getByRole('option', { name: 'Unplanned exit' })).toBeInTheDocument()
    await user.selectOptions(select, 'target|e1|t1')
    await user.click(link)
    expect(onLink).toHaveBeenLastCalledWith({ orderId: '13', role: 'target', entryId: 'e1', levelId: 't1' })

    await user.click(within(linked).getByRole('button', { name: 'Unlink Entry 1 order' }))
    expect(onUnlink).toHaveBeenLastCalledWith('00000000-0000-4000-8000-0000000000a1')
    await user.click(screen.getByRole('button', { name: 'Check venue' }))
    expect(onCheck).toHaveBeenCalledOnce()
  })

  it('explains untracked and closed plays without edit controls', () => {
    const view = render(<ExecutionPanel execution={{ ...execution, tracked: false, status: 'planned', reason: 'Manual instruments are not tracked at a venue.',
      links: [], suggestions: [], unlinkedOrders: [] }} error={null} busy={false} entries={entries} onCheck={vi.fn()} onLink={vi.fn()} onUnlink={vi.fn()} />)
    expect(screen.getByText('Manual instruments are not tracked at a venue.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Check venue' })).not.toBeInTheDocument()
    view.rerender(<ExecutionPanel execution={{ ...execution, status: 'closed' }} error={null} busy={false} entries={entries} onCheck={vi.fn()} onLink={vi.fn()} onUnlink={vi.fn()} />)
    expect(screen.queryByRole('button', { name: /Unlink/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Other orders on this instrument' })).not.toBeInTheDocument()
  })
})
