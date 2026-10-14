import { screen } from '@testing-library/react'
import { render } from '@/test/render'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { DrawingEditBar } from './DrawingEditBar'
import type { ChartDrawing } from './drawings'

const drawing: ChartDrawing = { id: 'note', schemaVersion: 1, kind: 'text', points: [{ time: 100, price: 20 }], text: '' }

describe('drawing note limit', () => {
  it('accepts 500 characters, matching the saved drawing contract', async () => {
    const onText = vi.fn()
    render(<DrawingEditBar drawing={{ ...drawing, text: 'x'.repeat(499) }} label="Note" defaultColor="#ffffff"
      onText={onText} onStyle={vi.fn()} onLocked={vi.fn()} onDelete={vi.fn()} onTextFocus={vi.fn()} onTextBlur={vi.fn()} />)
    const note = screen.getByRole('textbox', { name: 'Note text' })
    expect(note).toHaveAttribute('maxlength', '500')
    await userEvent.type(note, 'y')
    expect(onText).toHaveBeenLastCalledWith('x'.repeat(499) + 'y')
  })
})
