import { useState } from 'react'
import { render, renderHook, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { SizingDocument } from '@/api/sizing'
import { ApiError } from '@/api/system'
import type { WorkspaceApi } from '@/api/workspace'
import { accountFixture, portfolioFixture, sizingFixture } from '@/test/workspace-fixture'
import { createDraft, createExit, type DraftExit, type PlayDraft } from './draft'
import { PlayWorkspace } from './PlayWorkspace'
import { PositionEditor } from './PositionEditor'
import { TrackRecord } from './Suggestions'
import { useSizing } from './useSizing'

const units = { quote: 'USDC', base: 'BTC', quantityDecimals: 5 }
const exit = (value: string, unit: DraftExit['unit'] = 'price'): DraftExit => ({ ...createExit('100'), value, unit })

/** One long entry at 100 with a stop at 95 and a target at 120 (R:R 1:4). */
function plan(changes: Partial<PlayDraft> = {}, stop = exit('95'), target = exit('120')) {
  const draft = createDraft()
  draft.entries = [{ ...draft.entries[0]!, price: '100', stops: [stop], targets: [target] }]
  return { ...draft, ...changes }
}

const reduced: SizingDocument = {
  ...sizingFixture,
  exposure: { level: 'half', multiplier: '0.5', reason: 'Three losses in a row.', lossStreak: 3, winsSinceStepDown: 0 },
  limits: { ...sizingFixture.limits, effectiveRiskPercent: '0.625' },
}

function Editor({ initial, sizing = sizingFixture, balance = '10000', available = null, maxLeverage = 50, onDraft }: {
  initial: PlayDraft
  sizing?: SizingDocument | null
  balance?: string | null
  available?: string | null
  maxLeverage?: number | null
  onDraft?: (draft: PlayDraft) => void
}) {
  const [draft, setDraft] = useState(initial)
  return <PositionEditor draft={draft} onChange={next => { onDraft?.(next); setDraft(next) }} selectedId={draft.entries[0]!.id} onSelect={() => {}}
    maxLeverage={maxLeverage} units={units} availableBudget={available} sizing={sizing} balance={balance} onRiskChange={() => Promise.resolve()} />
}

const field = (name: string) => screen.getByRole('spinbutton', { name })

describe('size suggestion', () => {
  it('suggests the risk-based margin and applies it only on Accept', async () => {
    const user = userEvent.setup()
    const onDraft = vi.fn<(draft: PlayDraft) => void>()
    render(<Editor initial={plan()} onDraft={onDraft} />)
    // 10,000 × 1.25% = 125 at risk over a 5 stop: 25 BTC, 2,500 USDC at 1×.
    const line = screen.getByTestId('size-suggestion')
    expect(line).toHaveTextContent(/Size for 125 USDC risk: 2,500 USDC/)
    expect(onDraft).not.toHaveBeenCalled()
    await user.click(within(line).getByRole('button', { name: 'Accept suggested size' }))
    expect(onDraft.mock.lastCall?.[0]).toMatchObject({ size: '2500', leverage: '1' })
    expect(field('Whole-position margin (USDC)')).toHaveValue(2500)
    expect(screen.queryByTestId('size-suggestion')).not.toBeInTheDocument()
  })

  it('suggests a quantity in quantity mode and shows reduced exposure', async () => {
    render(<Editor initial={plan({ sizingMode: 'quantity' })} sizing={reduced} />)
    // 62.5 at risk over 5: 12.5 BTC.
    expect(screen.getByTestId('size-suggestion')).toHaveTextContent(/62\.5 USDC risk · 50% exposure: 12\.5 BTC/)
    await userEvent.click(screen.getByRole('button', { name: 'Accept suggested size' }))
    expect(field('Whole-position quantity (BTC)')).toHaveValue(12.5)
  })

  it('needs the account balance and the sizing record', () => {
    const { rerender } = render(<Editor initial={plan()} balance={null} />)
    expect(screen.queryByTestId('size-suggestion')).not.toBeInTheDocument()
    // The record is still there, so the stop and target suggestions keep working.
    expect(screen.getByTestId('track-record')).toBeInTheDocument()
    rerender(<Editor initial={plan()} sizing={null} />)
    expect(screen.queryByTestId('track-record')).not.toBeInTheDocument()
  })

  it('points to leverage instead when the margin would not fit the budget', async () => {
    const user = userEvent.setup()
    const onDraft = vi.fn<(draft: PlayDraft) => void>()
    render(<Editor initial={plan()} available="1000" onDraft={onDraft} />)
    const line = screen.getByTestId('size-suggestion')
    expect(line).toHaveTextContent(/needs 2,500 USDC margin, above the budget; raise leverage/)
    expect(within(line).queryByRole('button')).not.toBeInTheDocument()
    // 2,500 notional in a 1,000 budget: 3×, with liquidation near 67 below the 95 stop.
    const leverage = screen.getByTestId('leverage-suggestion')
    expect(leverage).toHaveTextContent('Leverage 3× fits the budget')
    await user.click(within(leverage).getByRole('button', { name: 'Accept suggested leverage' }))
    expect(onDraft.mock.lastCall?.[0]).toMatchObject({ leverage: '3', size: '' })
    expect(screen.queryByTestId('leverage-suggestion')).not.toBeInTheDocument()
    // At 3× the same risk needs 833.33 margin, which fits.
    expect(screen.getByTestId('size-suggestion')).toHaveTextContent(/833\.33 USDC/)
  })

  it('asks about percent levels before a suggested leverage applies', async () => {
    const user = userEvent.setup()
    render(<Editor initial={plan({}, exit('95'), exit('20', 'percent'))} available="1000" />)
    await user.click(screen.getByRole('button', { name: 'Accept suggested leverage' }))
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
  })

  it('does not raise leverage while exposure is reduced', () => {
    render(<Editor initial={plan()} available="1000" sizing={reduced} />)
    // 1,250 notional would need 2×, above the current 1×.
    expect(screen.queryByTestId('leverage-suggestion')).not.toBeInTheDocument()
    expect(screen.getByTestId('size-suggestion')).toHaveTextContent(/above the budget at 1×/)
  })
})

describe('stop and target suggestions', () => {
  it('suggests the maximum stop under the stop row and keeps its unit', async () => {
    const user = userEvent.setup()
    render(<Editor initial={plan({ leverage: '10' }, exit('150', 'percent'))} />)
    const line = screen.getByTestId('max-stop-suggestion')
    expect(line).toHaveTextContent('Max stop 10%: 100% (≈ 90)')
    expect(within(screen.getByRole('group', { name: 'Entry 1 stop' })).getByTestId('max-stop-suggestion')).toBe(line)
    await user.click(within(line).getByRole('button', { name: 'Accept suggested Entry 1 stop' }))
    expect(field('Entry 1 planned stop return at 10× leverage (%)')).toHaveValue(100)
    expect(screen.queryByTestId('max-stop-suggestion')).not.toBeInTheDocument()
  })

  it('suggests the minimum target under the targets', async () => {
    const user = userEvent.setup()
    render(<Editor initial={plan({}, exit('95'), exit('105'))} />)
    const line = screen.getByTestId('min-target-suggestion')
    expect(line).toHaveTextContent('1:2 needs target 1 at 110')
    await user.click(within(line).getByRole('button', { name: 'Accept suggested Entry 1 target 1' }))
    expect(field('Entry 1 planned target 1 price (quote units)')).toHaveValue(110)
    expect(screen.queryByTestId('min-target-suggestion')).not.toBeInTheDocument()
  })

  it('shows them in the expanded entry editor too', async () => {
    const user = userEvent.setup()
    render(<Editor initial={plan({}, exit('80'), exit('105'))} />)
    await user.click(screen.getByRole('button', { name: 'Expand selected entry' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByTestId('max-stop-suggestion')).toHaveTextContent('Max stop 10%: 90')
    expect(within(dialog).getByTestId('min-target-suggestion')).toBeInTheDocument()
  })
})

describe('track record', () => {
  it('says when there are no closed plays and shows the risk', () => {
    render(<TrackRecord sizing={sizingFixture} onRiskChange={vi.fn()} />)
    expect(screen.getByTestId('track-record')).toHaveTextContent('No closed plays yet')
    expect(screen.getByRole('button', { name: 'Risk per trade 1.25%. Edit' })).toHaveTextContent('risk 1.25%')
  })

  it('shows batting average, win/loss ratio and reduced exposure with the details in a tooltip', () => {
    const sizing: SizingDocument = { ...reduced, record: { ...reduced.record, closedPlays: 12, decidedPlays: 11, wins: 6, losses: 5, scratches: 1,
      battingAverage: '0.5454', winLossRatio: '2.1', averageGainPercent: '8.4', averageLossPercent: '4' } }
    render(<TrackRecord sizing={sizing} onRiskChange={vi.fn()} />)
    const summary = screen.getByText(/Wins 54\.54% · W\/L 2\.1/)
    expect(summary).toHaveTextContent('50% exposure')
    expect(summary.getAttribute('title')).toMatch(/Three losses in a row\.[\s\S]*6 wins, 5 losses, 1 scratches[\s\S]*Average gain 8\.4%, average loss 4%/)
  })

  it('edits the risk in place, warns above 2.5% and refuses values outside 0.1 to 5%', async () => {
    const user = userEvent.setup()
    const onRiskChange = vi.fn<(risk: string) => Promise<void>>().mockResolvedValue()
    render(<TrackRecord sizing={sizingFixture} onRiskChange={onRiskChange} />)
    await user.click(screen.getByRole('button', { name: /Risk per trade/ }))
    const input = screen.getByRole('spinbutton', { name: 'Risk per trade (%)' })
    await user.clear(input)
    await user.type(input, '3')
    expect(screen.getByText('Above 2.5%')).toBeInTheDocument()
    await user.clear(input)
    await user.type(input, '6{Enter}')
    expect(screen.getByRole('alert')).toHaveTextContent('0.1 to 5%')
    expect(onRiskChange).not.toHaveBeenCalled()
    await user.clear(input)
    await user.type(input, '1.5{Enter}')
    expect(onRiskChange).toHaveBeenCalledWith('1.5')
    await waitFor(() => expect(screen.queryByRole('spinbutton', { name: 'Risk per trade (%)' })).not.toBeInTheDocument())
  })

  it('keeps the editor open with the reason when saving fails', async () => {
    const user = userEvent.setup()
    const onRiskChange = vi.fn().mockRejectedValue(new ApiError('http', 'Risk per trade must be between 0.1% and 5%.', 400))
    render(<TrackRecord sizing={sizingFixture} onRiskChange={onRiskChange} />)
    await user.click(screen.getByRole('button', { name: /Risk per trade/ }))
    await user.type(screen.getByRole('spinbutton', { name: 'Risk per trade (%)' }), '{Backspace}{Enter}')
    expect(await screen.findByRole('alert')).toHaveTextContent('between 0.1% and 5%')
    expect(onRiskChange).toHaveBeenCalledWith('1.2')
  })
})

describe('sizing in the workspace', () => {
  const api = { instruments: () => new Promise(() => {}) } as unknown as WorkspaceApi
  const account = { ...accountFixture, balanceUsd: '10000' }

  it('uses the play account balance on editable plays only', () => {
    const draft = { ...plan(), accountId: account.id }
    const { rerender } = render(<PlayWorkspace accounts={[account]} portfolios={[portfolioFixture]} api={api} draft={draft} onChange={() => {}}
      sizing={sizingFixture} onRiskChange={() => Promise.resolve()} />)
    expect(screen.getByTestId('size-suggestion')).toHaveTextContent(/Size for 125 quote units risk/)
    expect(screen.getByTestId('track-record')).toBeInTheDocument()
    rerender(<PlayWorkspace accounts={[account]} portfolios={[portfolioFixture]} api={api} draft={{ ...draft, entries: plan({}, exit('80'), exit('105')).entries }}
      onChange={() => {}} readOnly status="closed" sizing={sizingFixture} onRiskChange={() => Promise.resolve()} />)
    expect(screen.queryByTestId('size-suggestion')).not.toBeInTheDocument()
    expect(screen.queryByTestId('max-stop-suggestion')).not.toBeInTheDocument()
    expect(screen.queryByTestId('track-record')).not.toBeInTheDocument()
  })
})

describe('sizing document', () => {
  it('loads once and takes the document returned by a risk change', async () => {
    const updated = { ...sizingFixture, settings: { riskPercent: '1.5' } }
    const api = { sizing: vi.fn().mockResolvedValue(sizingFixture), updateSizingSettings: vi.fn().mockResolvedValue(updated) } as unknown as WorkspaceApi
    const { result, rerender } = renderHook(() => useSizing(api))
    await waitFor(() => expect(result.current.sizing).toEqual(sizingFixture))
    rerender()
    expect(api.sizing).toHaveBeenCalledOnce()
    await result.current.updateRisk('1.5')
    await waitFor(() => expect(result.current.sizing).toEqual(updated))
    expect(api.updateSizingSettings).toHaveBeenCalledWith({ riskPercent: '1.5' })
  })

  it('stays empty when the record cannot load', async () => {
    const api = { sizing: vi.fn().mockRejectedValue(new ApiError('unavailable', 'Down.')) } as unknown as WorkspaceApi
    const { result } = renderHook(() => useSizing(api))
    await waitFor(() => expect(api.sizing).toHaveBeenCalled())
    expect(result.current.sizing).toBeNull()
  })
})
