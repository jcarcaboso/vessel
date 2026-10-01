import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { PlayWorkspace } from './PlayWorkspace'
import { systemFixture } from '@/test/system-fixture'

function renderWorkspace() {
  return render(<PlayWorkspace system={systemFixture} disconnect={vi.fn()} />)
}

describe('approved workspace fixture', () => {
  it('keeps capital above, chart and journal left, position right, and summary below', () => {
    renderWorkspace()
    const workspace = screen.getByTestId('workspace')
    const left = screen.getByTestId('left-column')
    expect(left.children[0]).toBe(screen.getByTestId('chart-panel'))
    expect(left.children[1]).toBe(screen.getByTestId('journal-panel'))
    expect(workspace.children[0]).toBe(left)
    expect(workspace.children[1]).toBe(screen.getByTestId('position-panel'))
    expect(workspace.previousElementSibling).toBe(screen.getByTestId('capital-context'))
    expect(workspace.nextElementSibling).toBe(screen.getByTestId('summary-panel'))
    expect(screen.getByRole('status')).toHaveTextContent('sample only')
    expect(screen.getByRole('status')).toHaveTextContent('Nothing is saved or broker-connected')
    expect(screen.getByText('Hyperliquid · planned')).toBeInTheDocument()
  })

  it('selects from the chart, focuses the same entry and scrolls only the bounded sidebar', async () => {
    renderWorkspace()
    const legend = screen.getByRole('button', { name: /Entry 2 · 63,700 USD/ })
    await userEvent.click(legend)
    const entry2 = within(screen.getByRole('article', { name: 'Entry 2 editor' })).getByRole('button', { name: /Entry 2/ })
    expect(entry2).toHaveFocus()
    expect(entry2).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByTestId('entry-sidebar').scrollTo).toHaveBeenCalled()
    expect(screen.getByLabelText('Selected entry')).toHaveValue('entry-2')
    expect(screen.getByRole('article', { name: 'Entry 1 editor' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Entry 1 · 64,200 USD/ })).toBeInTheDocument()
  })

  it('synchronizes selection from the dropdown and entry header', async () => {
    renderWorkspace()
    await userEvent.selectOptions(screen.getByLabelText('Selected entry'), 'entry-2')
    expect(screen.getByRole('button', { name: /Entry 2 · 63,700 USD/ })).toHaveAttribute('aria-pressed', 'true')
    await userEvent.click(within(screen.getByRole('article', { name: 'Entry 1 editor' })).getByRole('button', { name: /Entry 1/ }))
    expect(screen.getByLabelText('Selected entry')).toHaveValue('entry-1')
  })

  it('does not change entry selection when editing an unselected quantity share', async () => {
    renderWorkspace()
    const share = screen.getByRole('spinbutton', { name: 'Entry 2 quantity share' })
    await userEvent.clear(share)
    await userEvent.type(share, '35')
    expect(screen.getByLabelText('Selected entry')).toHaveValue('entry-1')
    expect(share).toHaveValue(35)
  })

  it('uses the same entry values in an accessible dialog and restores trigger focus on Escape', async () => {
    const user = userEvent.setup()
    renderWorkspace()
    const trigger = screen.getByRole('button', { name: 'Expand selected entry' })
    await user.click(trigger)
    const dialog = screen.getByRole('dialog', { name: 'Expanded entry editor' })
    const price = within(dialog).getByRole('spinbutton', { name: 'Entry 1 planned entry' })
    await user.clear(price)
    await user.type(price, '64500')
    await user.selectOptions(within(dialog).getByLabelText('Entry'), 'entry-2')
    expect(within(dialog).getByRole('spinbutton', { name: 'Entry 2 planned entry' })).toHaveValue(63700)
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByRole('spinbutton', { name: 'Entry 1 planned entry' })).toHaveValue(64500)
    expect(trigger).toHaveFocus()
    expect(screen.getByLabelText('Selected entry')).toHaveValue('entry-2')
  })

  it('keeps review and original thesis separate with local note state', async () => {
    renderWorkspace()
    await userEvent.type(screen.getByRole('textbox', { name: 'Thesis' }), 'Sample reasoning')
    await userEvent.click(screen.getByRole('tab', { name: 'Review' }))
    expect(screen.getByRole('textbox', { name: 'Review' })).toHaveValue('')
    await userEvent.type(screen.getByRole('textbox', { name: 'Review' }), 'Sample reflection')
    await userEvent.click(screen.getByRole('tab', { name: 'Thesis' }))
    expect(screen.getByRole('textbox', { name: 'Thesis' })).toHaveValue('Sample reasoning')
  })
})
