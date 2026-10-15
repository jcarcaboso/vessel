import { act, fireEvent, screen } from '@testing-library/react'
import { render } from '@/test/render'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { InfoTip } from './info-tip'

const tip = () => screen.getByRole('button')
const opened = () => tip().getAttribute('data-state')?.endsWith('open') ?? false

describe('info tip', () => {
  it('toggles open and closed through repeated clicks that carry no pointer events', () => {
    render(<InfoTip label="About x">Detail.</InfoTip>)
    expect(opened()).toBe(false)
    // Assistive technology and programmatic activation send a bare click.
    act(() => tip().click())
    expect(opened()).toBe(true)
    act(() => tip().click())
    expect(opened()).toBe(false)
    act(() => tip().click())
    expect(opened()).toBe(true)
    act(() => tip().click())
    expect(opened()).toBe(false)
  })

  it('toggles a click relative to the state when the press began', async () => {
    const user = userEvent.setup()
    render(<InfoTip label="About x">Detail.</InfoTip>)
    // A tap or click opens it, and the next one closes it.
    await user.click(tip())
    expect(opened()).toBe(true)
    await user.click(tip())
    expect(opened()).toBe(false)
  })

  it('closes a tip the pointer opened by hovering when it is clicked, although Radix closes it on press', async () => {
    const user = userEvent.setup()
    render(<InfoTip label="About x">Detail.</InfoTip>)
    await user.hover(tip())
    await act(() => new Promise(resolve => setTimeout(resolve, 400)))
    expect(opened()).toBe(true)
    await user.click(tip())
    expect(opened()).toBe(false)
  })

  it('does not let an abandoned press decide the next pointerless click', () => {
    render(<InfoTip label="About x">Detail.</InfoTip>)
    // Pressed while closed, then released elsewhere: no click reaches the tip, and the tip is opened some other way.
    fireEvent.pointerDown(tip())
    fireEvent.pointerCancel(tip())
    act(() => tip().click())
    expect(opened()).toBe(true)
    act(() => tip().click())
    expect(opened()).toBe(false)
    // The press ended outside the tip without a cancel; the bare click that follows is still relative to what is open.
    fireEvent.pointerDown(tip())
    act(() => tip().click())
    expect(opened()).toBe(true)
  })

  it('opens and closes from the keyboard', async () => {
    const user = userEvent.setup()
    render(<InfoTip label="About x">Detail.</InfoTip>)
    await user.tab()
    expect(tip()).toHaveFocus()
    // Focus opens it, like hover.
    expect(opened()).toBe(true)
    await user.keyboard('{Enter}')
    expect(opened()).toBe(false)
    await user.keyboard(' ')
    expect(opened()).toBe(true)
  })

  it('names an icon tip by its label and describes it with the detail', () => {
    render(<InfoTip label="About x">The detail.</InfoTip>)
    expect(screen.getByRole('button', { name: 'About x' })).toHaveAccessibleDescription('The detail.')
  })

  it('names a text tip by its visible text, with the detail as its description', () => {
    render(<InfoTip trigger="wallet">Standard · nominal total minus held.</InfoTip>)
    const button = screen.getByRole('button', { name: 'wallet' })
    expect(button).toHaveTextContent('wallet')
    expect(button).toHaveAccessibleDescription('Standard · nominal total minus held.')
  })

  it('starts the name of a text tip with its visible text, whatever the label says', () => {
    const { rerender } = render(<InfoTip trigger="1/2" label="Balance coverage">Detail.</InfoTip>)
    expect(screen.getByRole('button', { name: '1/2 Balance coverage' })).toHaveTextContent('1/2')
    // A label that already starts with the visible text is not repeated, whatever its case.
    rerender(<InfoTip trigger="Retrospective" label="retrospective plays">Detail.</InfoTip>)
    expect(screen.getByRole('button', { name: 'retrospective plays' })).toBeInTheDocument()
  })

  it('does not describe a tip by its own name', () => {
    render(<InfoTip label="Detail.">Detail.</InfoTip>)
    expect(tip()).not.toHaveAttribute('aria-describedby')
  })
})
