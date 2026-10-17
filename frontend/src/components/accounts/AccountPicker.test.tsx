import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { render } from '@/test/render'
import { AccountPicker, type PickerAccount } from './AccountPicker'
import { accountLabel, ambiguousAccounts, sourceHue } from './identity'

const hl = { id: 'hl', name: 'main', venueId: 'hyperliquid', source: '0x6d1e9c42aa1b3c4d5e6f708192a3b4c5d6e7f389', detail: 'farming' }
const lighter = { id: 'lt', name: 'Main account', venueId: 'lighter-rh', source: '48213', detail: 'farming' }
const risex = { id: 'rx', name: ' Main ', venueId: 'quantfury', source: '0x9a3c55e7b1d2c3f4a5b6c7d8e9f0a1b2c3d401be', detail: 'intraday' }
const unnamed = { id: 'blank', name: '', venueId: 'hyperliquid', source: '0x3f5ab2c19e0d4471a8b6e2f0c9d1aa7c3b21c0de', detail: 'Unassigned' }
const accounts: PickerAccount[] = [hl, lighter, risex, unnamed]

function setup(value = '', onChange = vi.fn()) {
  render(<><span id="label">Account</span><AccountPicker labelledBy="label" value={value} onChange={onChange} accounts={accounts}
    choices={[{ value: '', label: 'All enabled accounts' }]} /></>)
  return { onChange, trigger: screen.getByRole('button', { name: /^Account / }) }
}

describe('account identity', () => {
  it('marks blank names and names shared after trimming and ignoring case', () => {
    expect([...ambiguousAccounts(accounts)].sort()).toEqual(['blank', 'hl', 'rx'])
  })
  it('labels an unnamed account by its short source', () => {
    expect(accountLabel(unnamed)).toBe('0x3f5a…c0de')
    expect(accountLabel({ ...unnamed, source: null })).toBe('Unnamed account')
  })
  it('derives a stable hue from the source alone, ignoring case and spacing', () => {
    expect(sourceHue(hl.source)).toBe(sourceHue(` ${hl.source.toUpperCase()} `))
    expect(sourceHue(hl.source)).not.toBe(sourceHue(risex.source))
    expect(sourceHue(hl.source)).toBeGreaterThanOrEqual(0)
    expect(sourceHue(hl.source)).toBeLessThan(360)
  })
})

describe('AccountPicker', () => {
  it('names the trigger with the label, then the account, venue and, for a shared name, its source', () => {
    const { trigger } = setup('hl')
    expect(trigger).toHaveAccessibleName('Account main, Hyperliquid, 0x6d1e…f389')
    expect(trigger).toHaveAttribute('title', 'main · Hyperliquid · 0x6d1e9c42aa1b3c4d5e6f708192a3b4c5d6e7f389')
  })
  it('leaves the source out of the trigger when the name is distinct', () => {
    const { trigger } = setup('lt')
    expect(trigger).toHaveAccessibleName('Account Main account, Lighter · Robinhood')
  })
  it('lists accounts with venue, source and portfolio and chooses with a click', async () => {
    const { onChange, trigger } = setup()
    await userEvent.click(trigger)
    const list = screen.getByRole('listbox')
    expect(within(list).getByRole('option', { name: 'All enabled accounts' })).toHaveAttribute('aria-selected', 'true')
    expect(within(list).getByRole('option', { name: 'main, Hyperliquid, 0x6d1e…f389, farming' })).toBeInTheDocument()
    expect(within(list).getByRole('option', { name: 'Main account, Lighter · Robinhood, #48213, farming' })).toBeInTheDocument()
    expect(within(list).getByRole('option', { name: '0x3f5a…c0de, Hyperliquid, Unassigned' })).toBeInTheDocument()
    await userEvent.click(within(list).getByRole('option', { name: /^Main account,/ }))
    expect(onChange).toHaveBeenCalledExactlyOnceWith('lt')
    await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument())
    expect(trigger).toHaveFocus()
  })
  it('searches names, venues and sources, moves with arrow keys and chooses with Enter', async () => {
    const { onChange, trigger } = setup()
    trigger.focus()
    fireEvent.keyDown(trigger, { key: 'ArrowDown' })
    const search = await screen.findByRole('combobox', { name: 'Search accounts' })
    await waitFor(() => expect(search).toHaveFocus())
    await userEvent.type(search, '#482')
    expect(screen.getAllByRole('option').map(o => o.getAttribute('aria-label'))).toEqual(['Main account, Lighter · Robinhood, #48213, farming'])
    await userEvent.clear(search)
    await userEvent.type(search, 'hyperliquid')
    expect(screen.getAllByRole('option')).toHaveLength(2)
    expect(search).toHaveAttribute('aria-activedescendant', screen.getAllByRole('option')[0]!.id)
    await userEvent.keyboard('{ArrowDown}')
    expect(search).toHaveAttribute('aria-activedescendant', screen.getAllByRole('option')[1]!.id)
    await userEvent.keyboard('{Enter}')
    expect(onChange).toHaveBeenCalledExactlyOnceWith('blank')
  })
  it('filters by venue, says when nothing matches and closes on Escape without choosing', async () => {
    const { onChange, trigger } = setup()
    await userEvent.click(trigger)
    await userEvent.click(screen.getByRole('button', { name: /^Quantfury/ }))
    expect(screen.getAllByRole('option').map(o => o.getAttribute('aria-label'))).toEqual(['Main, Quantfury, 0x9a3c…01be, intraday'])
    await userEvent.type(screen.getByRole('combobox', { name: 'Search accounts' }), 'nothing')
    expect(screen.getByText('No account matches')).toBeInTheDocument()
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument())
    expect(onChange).not.toHaveBeenCalled()
    expect(trigger).toHaveFocus()
  })
})
