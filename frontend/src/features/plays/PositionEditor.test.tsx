import { useState } from 'react'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { createDraft, createEntry, type PlayDraft } from './draft'
import { PositionEditor } from './PositionEditor'

function renderEditor(entryCount = 2) {
  const initial = createDraft()
  initial.entries = Array.from({ length: entryCount }, (_, index) => createEntry(index))
  const onChange = vi.fn<(draft: PlayDraft) => void>()
  function Harness({ externalSelection, selectionRequest = 0, externalAccount }: {
    externalSelection?: string
    selectionRequest?: number
    externalAccount?: string
  }) {
    const [draft, setDraft] = useState(initial)
    const [selectedId, setSelectedId] = useState(initial.entries[0]!.id)
    return <PositionEditor draft={externalAccount === undefined ? draft : { ...draft, accountId: externalAccount }}
      onChange={next => { onChange(next); setDraft(next) }}
      selectedId={externalSelection ?? selectedId} selectionRequest={selectionRequest} onSelect={setSelectedId} />
  }
  const view = render(<Harness />)
  return {
    initial, onChange, user: userEvent.setup(),
    selectExternally: (id: string, selectionRequest = 0) => view.rerender(<Harness externalSelection={id} selectionRequest={selectionRequest} />),
    chooseAccount: (id: string) => view.rerender(<Harness externalAccount={id} />),
  }
}

function field(name: string) {
  return screen.getByRole('spinbutton', { name })
}

function entryHeader(name: string) {
  return within(screen.getByRole('article', { name: `${name} editor` })).getByRole('button', { name: new RegExp(`^${name}`) })
}

function unitButton(group: string, unit: 'Price' | '% return at leverage') {
  return within(screen.getByRole('group', { name: group })).getByRole('button', { name: unit })
}

describe('local-draft position editor', () => {
  it('starts with blank planned levels, explicit units and at least one entry', () => {
    const { initial } = renderEditor(1)
    expect(screen.getByTestId('position-panel')).toHaveClass('plays-position', 'panel', 'position-panel')
    expect(screen.getByTestId('entry-sidebar')).toHaveClass('entry-sidebar')
    expect(entryHeader('Entry 1')).toHaveClass('entry-header')
    expect(screen.getByRole('article', { name: 'Entry 1 editor' }).style.getPropertyValue('--entry-color')).toBe(initial.entries[0]!.color)
    expect(field('Entry 1 planned entry price (quote units)')).toHaveValue(null)
    expect(field('Entry 1 planned stop price (quote units)')).toHaveValue(null)
    expect(field('Entry 1 planned target 1 price (quote units)')).toHaveValue(null)
    expect(field('Entry 1 quantity share (%)')).toHaveValue(100)
    expect(screen.getByRole('button', { name: 'Remove Entry 1' })).toBeDisabled()
    expect(screen.getByRole('tab', { name: 'Position' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.queryByText(/sample/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^save/i })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Margin in quote units' })).toHaveAttribute('aria-pressed', 'true')
    expect(unitButton('Entry 1 stop units', 'Price')).toHaveAttribute('aria-pressed', 'true')
  })

  it('edits whole-position sizing without deriving or reallocating entry values', async () => {
    const { user, onChange, initial } = renderEditor()
    const margin = screen.getByRole('spinbutton', { name: /Whole-position margin/ })
    fireEvent.change(margin, { target: { value: '125.7500' } })
    expect(onChange.mock.lastCall?.[0].size).toBe('125.7500')
    expect(onChange.mock.lastCall?.[0].entries).toEqual(initial.entries)
    await user.click(screen.getByRole('button', { name: 'Margin in quote units' }))
    expect(margin).toHaveValue(125.75)
    // Without an entry price there is nothing to convert at, so the size clears.
    await user.click(screen.getByRole('button', { name: 'Quantity in units' }))
    const quantity = screen.getByRole('spinbutton', { name: /Whole-position quantity/ })
    expect(quantity).toHaveValue(null)
    await user.type(quantity, '0.125')
    expect(onChange.mock.lastCall?.[0]).toMatchObject({ sizingMode: 'quantity', size: '0.125', leverage: '1' })
    expect(onChange.mock.lastCall?.[0].entries).toEqual(initial.entries)
    expect(screen.getByRole('button', { name: 'Quantity in units' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('converts the size between the quote asset and the contract at the leverage and entry', async () => {
    const user = userEvent.setup()
    function Converting() {
      const [draft, setDraft] = useState<PlayDraft>(() => {
        const base = { ...createDraft(), size: '500', leverage: '10' }
        base.entries[0]!.price = '84000'
        return base
      })
      return <PositionEditor draft={draft} onChange={setDraft} selectedId={draft.entries[0]!.id} onSelect={vi.fn()} maxLeverage={40}
        instrumentName="BTC/USDC" units={{ quote: 'USDC', base: 'BTC', quantityDecimals: 5 }} />
    }
    render(<Converting />)
    expect(screen.getByRole('button', { name: 'Margin in USDC' })).toHaveTextContent('USDC')
    await user.click(screen.getByRole('button', { name: 'Quantity in BTC' }))
    expect(screen.getByRole('spinbutton', { name: /Whole-position quantity/ })).toHaveValue(0.05952)
    expect(screen.getByTestId('size-readout')).toHaveTextContent('Margin 499.97 USDC')
    await user.click(screen.getByRole('button', { name: 'Margin in USDC' }))
    expect(screen.getByRole('spinbutton', { name: /Whole-position margin/ })).toHaveValue(499.97)
  })

  it('links whole-number leverage controls, allows clearing and preserves size and planned levels', async () => {
    const { user, onChange, initial } = renderEditor()
    const slider = screen.getByRole('slider', { name: 'Leverage slider (×)' })
    const leverage = screen.getByRole('spinbutton', { name: 'Leverage (×)' })
    fireEvent.change(slider, { target: { value: '9' } })
    expect(leverage).toHaveValue(9)
    await user.clear(leverage)
    expect(leverage).toHaveValue(null)
    expect(onChange.mock.lastCall?.[0].leverage).toBe('')
    expect(slider).toHaveValue('1')
    expect(slider).toHaveAttribute('aria-valuetext', 'Not specified')
    await user.type(leverage, '12')
    expect(slider).toHaveValue('12')
    expect(slider).toHaveAttribute('aria-valuetext', '12 times')
    expect(onChange.mock.lastCall?.[0]).toMatchObject({ leverage: '12', size: '' })
    expect(onChange.mock.lastCall?.[0].entries).toEqual(initial.entries)
    expect(leverage).toHaveAttribute('step', '1')
    expect(leverage).toHaveAttribute('min', '1')
    expect(leverage).toHaveAttribute('max', '100')
    expect(slider).toHaveAttribute('step', '1')
    expect(slider).toHaveAttribute('min', '1')
    expect(slider).toHaveAttribute('max', '100')
  })

  it.each([
    ['12.25', '12'], ['12.75', '13'], ['0', '1'], ['-5', '1'], ['100.9', '100'], ['500', '100'],
  ])('accepts numeric leverage %s only as a bounded whole multiplier %s', (value, expected) => {
    const { onChange, initial } = renderEditor()
    const leverage = screen.getByRole('spinbutton', { name: 'Leverage (×)' })
    fireEvent.change(leverage, { target: { value } })
    expect(leverage).toHaveValue(Number(expected))
    expect(screen.getByRole('slider', { name: 'Leverage slider (×)' })).toHaveValue(expected)
    expect(onChange.mock.lastCall?.[0]).toMatchObject({ leverage: expected, size: '' })
    expect(onChange.mock.lastCall?.[0].entries).toEqual(initial.entries)
  })

  it('keeps the budget in the position builder and discards unfinished edits when the account changes', async () => {
    const { user, chooseAccount } = renderEditor()
    const position = screen.getByTestId('position-panel')
    const budget = within(position).getByRole('textbox', { name: /Available budget/ })
    expect(budget.closest('.position-context')).not.toBeNull()
    expect(budget).toHaveAttribute('readonly')
    await user.click(within(position).getByRole('button', { name: 'Edit available budget' }))
    await user.type(within(position).getByRole('textbox', { name: /Available budget/ }), '275')
    chooseAccount('another-account')
    expect(within(position).getByRole('textbox', { name: /Available budget/ })).toHaveAttribute('readonly')
    expect(within(position).getByRole('textbox', { name: /Available budget/ })).toHaveValue('Unavailable')
    expect(within(position).queryByRole('button', { name: 'Save budget' })).not.toBeInTheDocument()
  })

  it('keeps entry prices and stops independent and clears only the switched level value', async () => {
    const { user, onChange } = renderEditor()
    await user.type(field('Entry 1 planned entry price (quote units)'), '123.45')
    await user.type(field('Entry 1 planned stop price (quote units)'), '120')
    await user.click(entryHeader('Entry 2'))
    await user.type(field('Entry 2 planned stop price (quote units)'), '85')
    await user.click(entryHeader('Entry 1'))
    await user.click(unitButton('Entry 1 stop units', '% return at leverage'))
    const stop = field('Entry 1 planned stop return at 1× leverage (%)')
    expect(stop).toHaveValue(null)
    await user.type(stop, '2.5')
    await user.clear(field('Entry 1 planned entry price (quote units)'))
    await user.type(field('Entry 1 planned entry price (quote units)'), '140')
    expect(stop).toHaveValue(2.5)
    expect(onChange.mock.lastCall?.[0].entries[1]!.stops[0]).toMatchObject({ value: '85' })
    expect(onChange.mock.lastCall?.[0].entries[0]!.stops[0]).toMatchObject({ unit: 'percent', value: '2.5' })
    await user.click(unitButton('Entry 1 stop units', 'Price'))
    expect(field('Entry 1 planned stop price (quote units)')).toHaveValue(null)
    expect(field('Entry 1 planned entry price (quote units)')).toHaveValue(140)
  })

  it('keeps a level value when its pressed chip is clicked and switches units with the keyboard', async () => {
    const { user, onChange } = renderEditor()
    await user.type(field('Entry 1 planned stop price (quote units)'), '120')
    onChange.mockClear()
    await user.click(unitButton('Entry 1 stop units', 'Price'))
    expect(onChange).not.toHaveBeenCalled()
    expect(field('Entry 1 planned stop price (quote units)')).toHaveValue(120)
    await user.tab()
    expect(unitButton('Entry 1 stop units', '% return at leverage')).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(unitButton('Entry 1 stop units', '% return at leverage')).toHaveAttribute('aria-pressed', 'true')
    expect(unitButton('Entry 1 stop units', 'Price')).toHaveAttribute('aria-pressed', 'false')
    expect(field('Entry 1 planned stop return at 1× leverage (%)')).toHaveValue(null)
    expect(screen.getByRole('article', { name: 'Entry 1 editor' })).toHaveAttribute('data-selected', 'true')
  })

  it('adds and removes partial targets with independent units and shares, without rebalancing', async () => {
    vi.stubGlobal('crypto', {})
    const { user, onChange, initial } = renderEditor()
    await user.type(field('Entry 1 planned target 1 price (quote units)'), '150')
    await user.clear(field('Entry 1 target 1 share (%)'))
    await user.type(field('Entry 1 target 1 share (%)'), '60')
    await user.click(screen.getByRole('button', { name: 'Add target to Entry 1' }))
    expect(field('Entry 1 planned target 2 price (quote units)')).toHaveValue(null)
    expect(field('Entry 1 target 2 share (%)')).toHaveValue(null)
    await user.type(field('Entry 1 planned target 2 price (quote units)'), '160')
    await user.type(field('Entry 1 target 2 share (%)'), '40')
    await user.click(unitButton('Entry 1 target 2 units', '% return at leverage'))
    expect(field('Entry 1 planned target 2 return at 1× leverage (%)')).toHaveValue(null)
    expect(field('Entry 1 target 2 share (%)')).toHaveValue(40)
    await user.type(field('Entry 1 planned target 2 return at 1× leverage (%)'), '7.25')
    expect(field('Entry 1 planned target 1 price (quote units)')).toHaveValue(150)
    expect(onChange.mock.lastCall?.[0].entries[1]).toEqual(initial.entries[1])
    await user.click(screen.getByRole('button', { name: 'Remove Entry 1 target 1' }))
    expect(field('Entry 1 planned target 1 return at 1× leverage (%)')).toHaveValue(7.25)
    expect(field('Entry 1 target 1 share (%)')).toHaveValue(40)
    await user.click(unitButton('Entry 1 target 1 units', 'Price'))
    expect(field('Entry 1 planned target 1 price (quote units)')).toHaveValue(null)
    expect(field('Entry 1 target 1 share (%)')).toHaveValue(40)
    await user.click(screen.getByRole('button', { name: 'Remove Entry 1 target 1' }))
    expect(onChange.mock.lastCall?.[0].entries[0]!.targets).toEqual([])
    expect(screen.getByRole('button', { name: 'Add target to Entry 1' })).toBeEnabled()
  })

  it('applies leverage presets as whole multipliers and marks the active preset', async () => {
    const { user, onChange } = renderEditor(1)
    const presets = screen.getByRole('group', { name: 'Leverage presets' })
    expect(within(presets).getByRole('button', { name: '1×' })).toHaveAttribute('aria-pressed', 'true')
    await user.click(within(presets).getByRole('button', { name: '25×' }))
    expect(onChange.mock.lastCall?.[0]).toMatchObject({ leverage: '25', size: '' })
    expect(field('Leverage (×)')).toHaveValue(25)
    expect(within(presets).getByRole('button', { name: '25×' })).toHaveAttribute('aria-pressed', 'true')
    expect(within(presets).getByRole('button', { name: '1×' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('limits leverage to the venue maximum and flags a plan above it', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    const draft = { ...createDraft(), leverage: '50' }
    const view = render(<PositionEditor draft={draft} onChange={onChange} selectedId={draft.entries[0]!.id} onSelect={vi.fn()}
      maxLeverage={40} instrumentName="BTC/USDC" />)
    const presets = screen.getByRole('group', { name: 'Leverage presets' })
    expect(within(presets).getAllByRole('button').map(button => button.textContent)).toEqual(['1×', '5×', '10×', '25×', '40×'])
    expect(screen.getByRole('slider', { name: 'Leverage slider (×)' })).toHaveAttribute('max', '40')
    expect(screen.getByRole('alert')).toHaveTextContent('50× is above the 40× venue maximum for BTC/USDC.')
    expect(screen.getByText('Max 40×')).toBeInTheDocument()
    fireEvent.change(field('Leverage (×)'), { target: { value: '75' } })
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ leverage: '40' }))
    view.rerender(<PositionEditor draft={{ ...draft, leverage: '3' }} onChange={onChange} selectedId={draft.entries[0]!.id} onSelect={vi.fn()} />)
    expect(screen.getByRole('slider', { name: 'Leverage slider (×)' })).toHaveAttribute('max', '100')
    expect(screen.queryByRole('alert')).toBeNull()
    await user.click(within(screen.getByRole('group', { name: 'Leverage presets' })).getByRole('button', { name: '100×' }))
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ leverage: '100' }))
  })

  it('adds several stops with shares and shows what a percentage means at the leverage', async () => {
    const { user, onChange } = renderEditor(1)
    await user.click(screen.getByRole('button', { name: '10×' }))
    await user.type(field('Entry 1 planned entry price (quote units)'), '200')
    await user.click(unitButton('Entry 1 stop units', '% return at leverage'))
    await user.type(field('Entry 1 planned stop return at 10× leverage (%)'), '20')
    expect(screen.getByText('≈ 196 · 2% move at 10×')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Add stop to Entry 1' }))
    await user.type(field('Entry 1 planned stop 2 price (quote units)'), '190')
    await user.clear(field('Entry 1 stop 1 share (%)'))
    await user.type(field('Entry 1 stop 1 share (%)'), '60')
    await user.type(field('Entry 1 stop 2 share (%)'), '40')
    expect(onChange.mock.lastCall?.[0].entries[0]!.stops.map((stop: { unit: string; value: string; share: string }) => [stop.unit, stop.value, stop.share]))
      .toEqual([['percent', '20', '60'], ['price', '190', '40']])
    await user.click(screen.getByRole('button', { name: 'Remove Entry 1 stop 1' }))
    expect(onChange.mock.lastCall?.[0].entries[0]!.stops).toHaveLength(1)
    expect(field('Entry 1 planned stop price (quote units)')).toHaveValue(190)
  })

  it('asks before a leverage change moves percentage stops and targets', async () => {
    const { user, onChange } = renderEditor(1)
    await user.type(field('Entry 1 planned entry price (quote units)'), '200')
    await user.click(unitButton('Entry 1 stop units', '% return at leverage'))
    await user.type(field('Entry 1 planned stop return at 1× leverage (%)'), '5')
    await user.type(screen.getByRole('spinbutton', { name: /Whole-position margin/ }), '100')
    const calls = onChange.mock.calls.length

    // Cancel keeps the leverage and the levels.
    await user.click(screen.getByRole('button', { name: '10×' }))
    let dialog = screen.getByRole('dialog', { name: 'Change leverage from 1× to 10×?' })
    expect(within(dialog).getByRole('row', { name: /Entry 1 stop/ })).toHaveTextContent('Entry 1 stop5% · 19050% · 1905% · 199')
    expect(within(dialog).getByText('Margin stays 100 quote units; the position goes from 100 quote units to 1,000 quote units (0.5 units → 5 units).')).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(onChange.mock.calls.length).toBe(calls)
    expect(field('Leverage (×)')).toHaveValue(1)

    // Keeping prices rescales the percentage so the stop stays at 190.
    await user.click(screen.getByRole('button', { name: '10×' }))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Keep prices' }))
    expect(onChange.mock.lastCall?.[0]).toMatchObject({ leverage: '10' })
    expect(onChange.mock.lastCall?.[0].entries[0]!.stops[0]).toMatchObject({ unit: 'percent', value: '50' })
    expect(screen.getByText('≈ 190 · 5% move at 10×')).toBeInTheDocument()

    // Keeping the percentage moves the stop; the slider previews until it is released.
    const slider = screen.getByRole('slider', { name: 'Leverage slider (×)' })
    fireEvent.change(slider, { target: { value: '20' } })
    expect(field('Leverage (×)')).toHaveValue(20)
    expect(onChange.mock.lastCall?.[0]).toMatchObject({ leverage: '10' })
    fireEvent.pointerUp(slider)
    dialog = screen.getByRole('dialog', { name: 'Change leverage from 10× to 20×?' })
    await user.click(within(dialog).getByRole('button', { name: 'Keep % and move the levels' }))
    expect(onChange.mock.lastCall?.[0]).toMatchObject({ leverage: '20' })
    expect(onChange.mock.lastCall?.[0].entries[0]!.stops[0]).toMatchObject({ value: '50' })
    expect(screen.getByText('≈ 195 · 2.5% move at 20×')).toBeInTheDocument()

    // Clearing the number field and leaving it keeps the current leverage.
    await user.clear(field('Leverage (×)'))
    await user.tab()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(field('Leverage (×)')).toHaveValue(20)
  })

  it('shows the position size and quantity the margin buys at the leverage', async () => {
    const { user } = renderEditor(1)
    await user.type(screen.getByRole('spinbutton', { name: /Whole-position margin/ }), '250')
    expect(screen.getByTestId('size-readout')).toHaveTextContent('Position 250 quote unitsat 1×')
    await user.click(screen.getByRole('button', { name: '5×' }))
    await user.type(field('Entry 1 planned entry price (quote units)'), '2500')
    expect(screen.getByTestId('size-readout')).toHaveTextContent('Position 1,250 quote units≈ 0.5 unitsat 5×')
  })

  it('shows allocated quantity shares and splits them equally only on request', async () => {
    const { user, onChange } = renderEditor(1)
    expect(screen.getByRole('tab', { name: 'Entries 1' })).toBeInTheDocument()
    expect(within(entryHeader('Entry 1')).queryByText(/^@/)).not.toBeInTheDocument()
    await user.type(field('Entry 1 planned entry price (quote units)'), '64200')
    expect(within(entryHeader('Entry 1')).getByText('@ 64200')).toBeInTheDocument()
    expect(screen.getByText('100% of quantity allocated')).toHaveAttribute('data-complete', 'true')
    await user.click(screen.getByRole('button', { name: 'Add entry' }))
    await user.click(screen.getByRole('button', { name: 'Add entry' }))
    expect(onChange.mock.lastCall?.[0].entries.map(entry => entry.share)).toEqual(['100', '', ''])
    expect(screen.getByText('100% of quantity allocated')).toBeInTheDocument()
    await user.click(entryHeader('Entry 1'))
    await user.clear(field('Entry 1 quantity share (%)'))
    expect(screen.getByText('Shares not set')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Split equally' }))
    expect(onChange.mock.lastCall?.[0].entries.map(entry => entry.share)).toEqual(['33.33', '33.33', '33.34'])
    expect(screen.getByRole('tab', { name: 'Entries 3' })).toBeInTheDocument()
    expect(screen.getByText('100% of quantity allocated')).toHaveAttribute('data-complete', 'true')
    await user.click(entryHeader('Entry 3'))
    await user.clear(field('Entry 3 quantity share (%)'))
    expect(screen.getByText('66.66% of quantity allocated')).toHaveAttribute('data-complete', 'false')
  })

  it('adds blank entries using distinct identities without changing existing shares or reusing names', async () => {
    vi.stubGlobal('crypto', {})
    const { user, initial, onChange } = renderEditor(1)
    await user.click(screen.getByRole('button', { name: 'Add entry' }))
    const added = onChange.mock.lastCall?.[0].entries[1]
    expect(added).toMatchObject({ name: 'Entry 2', share: '', price: '', stops: [{ unit: 'price', value: '', share: '100' }] })
    expect(added?.id).not.toBe(initial.entries[0]!.id)
    expect(onChange.mock.lastCall?.[0].entries[0]).toEqual(initial.entries[0])
    expect(entryHeader('Entry 2')).toHaveAttribute('aria-pressed', 'true')
    await user.click(entryHeader('Entry 1'))
    await user.click(screen.getByRole('button', { name: 'Remove Entry 1' }))
    await user.click(screen.getByRole('button', { name: 'Add entry' }))
    expect(onChange.mock.lastCall?.[0].entries.map(entry => entry.name)).toEqual(['Entry 2', 'Entry 3'])
    expect(field('Entry 3 planned entry price (quote units)')).toHaveValue(null)
  })

  it('opens only the selected entry and selects another by its whole header, including its share text', async () => {
    const { user } = renderEditor()
    expect(field('Entry 1 planned entry price (quote units)')).toBeInTheDocument()
    expect(screen.queryByRole('spinbutton', { name: 'Entry 2 planned entry price (quote units)' })).toBeNull()
    await user.click(within(entryHeader('Entry 2')).getByText('—'))
    expect(entryHeader('Entry 2')).toHaveFocus()
    expect(entryHeader('Entry 2')).toHaveAttribute('aria-expanded', 'true')
    expect(field('Entry 2 planned entry price (quote units)')).toBeInTheDocument()
    expect(screen.queryByRole('spinbutton', { name: 'Entry 1 planned entry price (quote units)' })).toBeNull()
    await user.click(within(entryHeader('Entry 1')).getByText('100%'))
    expect(entryHeader('Entry 1')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('article', { name: 'Entry 2 editor' })).toBeInTheDocument()
  })

  it('summarizes the levels of a collapsed entry', async () => {
    const { user } = renderEditor()
    await user.type(field('Entry 1 planned stop price (quote units)'), '90')
    await user.type(field('Entry 1 planned target 1 price (quote units)'), '120')
    await user.click(entryHeader('Entry 2'))
    expect(within(entryHeader('Entry 1')).getByText('1 SL · 1 TP')).toBeInTheDocument()
  })

  it('opens the Entries tab when an entry is selected elsewhere, e.g. on the chart', () => {
    const { initial, selectExternally } = renderEditor()
    expect(screen.getByRole('tab', { name: 'Position' })).toHaveAttribute('aria-selected', 'true')
    selectExternally(initial.entries[1]!.id)
    expect(screen.getByRole('tab', { name: /Entries/ })).toHaveAttribute('aria-selected', 'true')
  })

  it('reveals external selection only inside the bounded sidebar and focuses with preventScroll', () => {
    const { initial, selectExternally } = renderEditor()
    const sidebar = screen.getByTestId('entry-sidebar')
    const header = entryHeader('Entry 2')
    sidebar.scrollTop = 25
    vi.spyOn(sidebar, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 100, 300, 400))
    vi.spyOn(header, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 300, 300, 40))
    const focus = vi.spyOn(header, 'focus')
    selectExternally(initial.entries[1]!.id)
    expect(sidebar.scrollTo).toHaveBeenLastCalledWith({ top: 213, behavior: 'auto' })
    expect(focus).toHaveBeenCalledWith({ preventScroll: true })
    expect(header).toHaveFocus()
    expect(window.scrollTo).not.toHaveBeenCalled()
  })

  it('reveals the same entry again when the parent increments selectionRequest', () => {
    const { initial, selectExternally } = renderEditor()
    const sidebar = screen.getByTestId('entry-sidebar')
    const entry = initial.entries[1]!
    selectExternally(entry.id, 1)
    vi.mocked(sidebar.scrollTo).mockClear()
    sidebar.scrollTop = 350
    selectExternally(entry.id, 2)
    expect(sidebar.scrollTo).toHaveBeenCalledOnce()
    expect(entryHeader(entry.name)).toHaveFocus()
    expect(entryHeader(entry.name)).toHaveAttribute('aria-pressed', 'true')
    expect(window.scrollTo).not.toHaveBeenCalled()
  })

  it('selects an existing entry when the selected entry is removed and never removes the last entry', async () => {
    const { user, initial, onChange } = renderEditor()
    await user.click(entryHeader('Entry 2'))
    await user.click(screen.getByRole('button', { name: 'Remove Entry 2' }))
    expect(onChange.mock.lastCall?.[0].entries).toEqual([initial.entries[0]])
    expect(entryHeader('Entry 1')).toHaveAttribute('aria-pressed', 'true')
    expect(entryHeader('Entry 1')).toHaveFocus()
    onChange.mockClear()
    await user.click(screen.getByRole('button', { name: 'Remove Entry 1' }))
    expect(onChange).not.toHaveBeenCalled()
    expect(screen.getAllByRole('article')).toHaveLength(1)
    expect(window.scrollTo).not.toHaveBeenCalled()
  })

  it('reuses the live expanded form, switches entries, avoids duplicate IDs and restores trigger focus on Escape', async () => {
    const { user, initial } = renderEditor()
    const trigger = screen.getByRole('button', { name: 'Expand selected entry' })
    await user.click(trigger)
    const dialog = screen.getByRole('dialog', { name: 'Expanded entry editor' })
    expect(dialog).toHaveClass('entry-dialog', 'plays-entry-dialog')
    const price = within(dialog).getByRole('spinbutton', { name: 'Entry 1 planned entry price (quote units)' })
    expect(document.querySelectorAll(`input[id="${price.id}"]`)).toHaveLength(1)
    expect(screen.getByTestId('entry-sidebar').querySelectorAll('input[aria-label="Entry 1 planned entry price (quote units)"]')).toHaveLength(0)
    await user.type(price, '145.125')
    await user.selectOptions(within(dialog).getByLabelText('Entry'), initial.entries[1]!.id)
    expect(within(dialog).getByRole('spinbutton', { name: 'Entry 2 planned entry price (quote units)' })).toHaveValue(null)
    await user.type(within(dialog).getByRole('spinbutton', { name: 'Entry 2 quantity share (%)' }), '35')
    const ids = Array.from(document.querySelectorAll('[id]'), node => node.id)
    expect(new Set(ids).size).toBe(ids.length)
    const focus = vi.spyOn(trigger, 'focus')
    await user.keyboard('{Escape}')
    await waitFor(() => expect(trigger).toHaveFocus())
    expect(focus).toHaveBeenCalledWith({ preventScroll: true })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(field('Entry 2 quantity share (%)')).toHaveValue(35)
    expect(entryHeader('Entry 2')).toHaveAttribute('aria-pressed', 'true')
    await user.click(entryHeader('Entry 1'))
    expect(field('Entry 1 planned entry price (quote units)')).toHaveValue(145.125)
    expect(window.scrollTo).not.toHaveBeenCalled()
  })

  it('restores the sidebar scroll offset when closing the same expanded entry', async () => {
    const { user } = renderEditor()
    const sidebar = screen.getByTestId('entry-sidebar')
    sidebar.scrollTop = 175
    const trigger = screen.getByRole('button', { name: 'Expand selected entry' })
    await user.click(trigger)
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Close' }))
    await waitFor(() => expect(trigger).toHaveFocus())
    expect(sidebar.scrollTo).toHaveBeenLastCalledWith({ top: 175, behavior: 'auto' })
    expect(field('Entry 1 planned entry price (quote units)')).toBeInTheDocument()
    expect(window.scrollTo).not.toHaveBeenCalled()
  })

  it('does not focus the sidebar when external selection changes inside the expanded editor', async () => {
    const { user, initial, selectExternally } = renderEditor()
    await user.click(screen.getByRole('button', { name: 'Expand selected entry' }))
    const dialog = screen.getByRole('dialog')
    const picker = within(dialog).getByLabelText('Entry')
    await user.click(picker)
    selectExternally(initial.entries[1]!.id)
    expect(picker).toHaveFocus()
    expect(picker).toHaveValue(initial.entries[1]!.id)
    const share = within(dialog).getByRole('spinbutton', { name: 'Entry 2 quantity share (%)' })
    await user.type(share, '25')
    expect(share).toHaveFocus()
    expect(window.scrollTo).not.toHaveBeenCalled()
  })
})
