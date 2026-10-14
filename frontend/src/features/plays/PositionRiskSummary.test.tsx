import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { createDraft, createEntry, type PlayDraft } from './draft'
import { PositionRiskSummary } from './PositionRiskSummary'
import type { SizeUnits } from './sizing'

const units: SizeUnits = { quote: 'USDC', base: 'ETH', quantityDecimals: 4 }
const reference = { name: 'Trading account balance', amount: '1000', quote: 'USDC' }
function plan(): PlayDraft {
  const item = { ...createEntry(0), price: '100', share: '50' }
  item.stops[0]!.value = '99'
  item.targets[0]!.value = '103'
  return { ...createDraft(), sizingMode: 'quantity', size: '1', leverage: '1',
    entries: [item, { ...item, id: 'second', name: 'Entry 2' }] }
}
const value = (label: string) => screen.getByText(label, { selector: 'dt' }).nextElementSibling!

describe('PositionRiskSummary', () => {
  it('renders whole-plan estimates, named risk share, separate coverage and exclusions', () => {
    render(<PositionRiskSummary draft={plan()} units={units} riskReference={reference} />)
    expect(screen.getByRole('group', { name: 'Planned position money summary' })).toBeInTheDocument()
    expect(value('All-stops planned loss')).toHaveTextContent(/^1 USDC$/)
    expect(value('All-targets planned gain')).toHaveTextContent(/^3 USDC$/)
    expect(value('Planned R:R')).toHaveTextContent(/^1:3$/)
    expect(value('Risk / Trading account balance')).toHaveTextContent(/^0.1%$/)
    expect(value('Priced quantity')).toHaveTextContent('1 ETH')
    for (const label of ['Entry allocation', 'Stop allocation', 'Target allocation', 'Stop coverage', 'Target coverage'])
      expect(value(label)).toHaveTextContent('100% · complete')
    expect(screen.getByText(/Fees, slippage and funding excluded/)).toHaveTextContent('separate scenarios')
    expect(screen.getByText(/Actual loss can exceed planned loss/)).toBeInTheDocument()
    expect(screen.queryByText(/max(imum)? loss|realized|initial risk|cross margin liquidates further/i)).not.toBeInTheDocument()
  })

  it('shows known loss plus an unknown-risk tranche, not a smaller all-stops total', () => {
    const draft = plan()
    draft.entries[1]!.stops = []
    render(<PositionRiskSummary draft={draft} units={units} riskReference={reference} />)
    expect(value('All-stops planned loss')).toHaveTextContent('Known 0.5 USDCTotal unknown')
    expect(value('All-stops planned loss')).toHaveAttribute('data-incomplete', 'true')
    expect(value('Stop coverage')).toHaveTextContent('50% · partial')
    expect(value('Priced quantity')).toHaveTextContent('100% of full position · complete')
    expect(value('All-targets planned gain')).toHaveTextContent(/^3 USDC$/)
    expect(value('Planned R:R')).toHaveTextContent('Unknown')
    expect(value('Risk / Trading account balance')).toHaveTextContent('Unknown')
  })

  it('updates every value when prices or direction change without retaining old estimates', () => {
    const draft = plan()
    const view = render(<PositionRiskSummary draft={draft} units={units} />)
    expect(value('All-stops planned loss')).toHaveTextContent(/^1 USDC$/)
    view.rerender(<PositionRiskSummary draft={{ ...draft, direction: 'short' }} units={units} />)
    expect(value('All-stops planned loss')).toHaveTextContent('Unknown')
    expect(value('Stop allocation')).toHaveTextContent('100% · complete')
    expect(value('Stop coverage')).toHaveTextContent('0% · partial')
    view.rerender(<PositionRiskSummary draft={{ ...draft, entries: draft.entries.map(item => ({
      ...item, stops: item.stops.map(level => ({ ...level, value: '98' })),
    })) }} units={units} />)
    expect(value('All-stops planned loss')).toHaveTextContent(/^2 USDC$/)
  })

  it('does not infer a risk reference from size or budget and hides invalid/mismatched references', () => {
    const draft = { ...plan(), budgetOverride: '1000' }
    const view = render(<PositionRiskSummary draft={draft} units={units} />)
    expect(value('Risk share')).toHaveTextContent('UnknownNeeds a named positive reference in USDC')
    for (const riskReference of [{ ...reference, amount: '0' }, { ...reference, name: '' }, { ...reference, quote: 'USD' }]) {
      view.rerender(<PositionRiskSummary draft={draft} units={units} riskReference={riskReference} />)
      expect(value('Risk share')).toHaveTextContent('Unknown')
      expect(screen.queryByText('Risk / Trading account balance')).not.toBeInTheDocument()
    }
  })

  it('uses generic size units when no venue units are supplied', () => {
    render(<PositionRiskSummary draft={plan()} />)
    expect(value('All-stops planned loss')).toHaveTextContent(/^1 quote units$/)
    expect(value('Priced quantity')).toHaveTextContent('1 units')
  })

  it('shows zero quantities without claiming a reward-to-risk ratio', () => {
    render(<PositionRiskSummary draft={{ ...plan(), size: '0' }} units={units} riskReference={reference} />)
    expect(value('All-stops planned loss')).toHaveTextContent(/^0 USDC$/)
    expect(value('All-targets planned gain')).toHaveTextContent(/^0 USDC$/)
    expect(value('Risk / Trading account balance')).toHaveTextContent(/^0%$/)
    expect(value('Planned R:R')).toHaveTextContent('Unknown')
  })

  it('marks overallocation as invalid instead of displaying a normalized total', () => {
    const draft = plan()
    draft.entries[0]!.share = '75'
    render(<PositionRiskSummary draft={draft} units={units} />)
    expect(value('Entry allocation')).toHaveTextContent('125% · invalid')
    expect(value('All-stops planned loss')).toHaveTextContent('UnknownInvalid allocation')
    expect(value('Priced quantity')).toHaveTextContent('Unknown')
  })

  it('never renders nonfinite values and does not round small nonzero losses to zero', () => {
    const draft = plan()
    const view = render(<PositionRiskSummary draft={{ ...draft, size: 'Infinity' }} units={units} />)
    expect(value('All-stops planned loss')).toHaveTextContent('Unknown')
    expect(screen.getByRole('group')).not.toHaveTextContent(/NaN|Infinity/)
    view.rerender(<PositionRiskSummary draft={{ ...draft, size: '0.001' }} units={units} riskReference={reference} />)
    expect(value('All-stops planned loss')).toHaveTextContent(/^< 0.01 USDC$/)
    expect(value('Risk / Trading account balance')).toHaveTextContent(/^< 0.01%$/)
  })
})
