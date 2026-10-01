import { useState } from 'react'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { DirectionToggle } from './DirectionToggle'

describe('direction toggle', () => {
  it.each(['long', 'short'] as const)('shows %s as pressed with text and a decorative direction icon', value => {
    render(<DirectionToggle value={value} onChange={vi.fn()} />)
    const group = screen.getByRole('group', { name: 'Direction' })
    const long = within(group).getByRole('button', { name: 'Long' })
    const short = within(group).getByRole('button', { name: 'Short' })
    expect(group).toHaveClass('direction-toggle')
    expect(long).toHaveAttribute('data-direction', 'long')
    expect(short).toHaveAttribute('data-direction', 'short')
    expect(long).toHaveAttribute('aria-pressed', String(value === 'long'))
    expect(short).toHaveAttribute('aria-pressed', String(value === 'short'))
    expect(long.querySelector('.lucide-arrow-up')).toHaveAttribute('aria-hidden', 'true')
    expect(short.querySelector('.lucide-arrow-down')).toHaveAttribute('aria-hidden', 'true')
    expect(within(group).getAllByRole('button', { pressed: true })).toHaveLength(1)
  })

  it('uses native buttons for pointer, Enter and Space selection', async () => {
    const onChange = vi.fn()
    function Harness() {
      const [value, setValue] = useState<'long' | 'short'>('long')
      return <DirectionToggle value={value} onChange={next => { onChange(next); setValue(next) }} />
    }
    render(<Harness />)
    const user = userEvent.setup()
    const long = screen.getByRole('button', { name: 'Long' })
    const short = screen.getByRole('button', { name: 'Short' })
    await user.tab()
    expect(long).toHaveFocus()
    await user.tab()
    expect(short).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(onChange).toHaveBeenLastCalledWith('short')
    expect(short).toHaveAttribute('aria-pressed', 'true')
    await user.tab({ shift: true })
    await user.keyboard(' ')
    expect(onChange).toHaveBeenLastCalledWith('long')
    expect(long).toHaveAttribute('aria-pressed', 'true')
    await user.click(short)
    expect(onChange).toHaveBeenLastCalledWith('short')
  })
})
