import { useState } from 'react'
import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DraftEvidence } from './draft'
import { createEvidence } from './evidence'
import { EvidencePanel } from './EvidencePanel'
import { MarkupEditor } from './MarkupEditor'
import { hitShape, markedFileName, markupSvg, moveShape, strokeWidth, textSize, type ImageMarkup } from './markup'

const base: ImageMarkup = { width: 1000, height: 500, shapes: [] }

describe('Markup model', () => {
  it('renders every kind as SVG sized like the image and escapes text', () => {
    const svg = markupSvg({ ...base, shapes: [
      { id: 'p', kind: 'pen', color: '#ff5c5c', width: 5, points: [{ x: 1, y: 2 }, { x: 30, y: 40 }] },
      { id: 'm', kind: 'marker', color: '#ffd23f', width: 20, points: [{ x: 5, y: 5 }] },
      { id: 'a', kind: 'arrow', color: '#4ade80', width: 5, from: { x: 0, y: 0 }, to: { x: 100, y: 0 } },
      { id: 'b', kind: 'box', color: '#60a5fa', width: 5, from: { x: 50, y: 60 }, to: { x: 10, y: 20 } },
      { id: 't', kind: 'text', color: '#111111', size: 32, at: { x: 10, y: 10 }, text: '<b>"Break" & retest</b>' },
    ] }, 'b')
    expect(svg).toMatch(/^<svg xmlns="http:\/\/www.w3.org\/2000\/svg" width="1000" height="500" viewBox="0 0 1000 500">/)
    expect(svg).toContain('<polyline points="1,2 30,40" fill="none" stroke="#ff5c5c" stroke-width="5"')
    expect(svg).toContain('<circle cx="5" cy="5" r="10" fill="#ffd23f" fill-opacity="0.4"/>')
    expect(svg).toContain('<polygon points="100,0 ')
    expect(svg).toContain('<rect x="10" y="20" width="40" height="40"')
    expect(svg).toContain('&lt;b&gt;&quot;Break&quot; &amp; retest&lt;/b&gt;')
    expect(svg).toContain('stroke="#ffffff" stroke-opacity="0.6"')
    expect(svg).toContain('stroke="#8fb8ff"')
    expect(svg).not.toContain('<b>')
  })

  it('scales strokes and text with the image, hits the topmost mark and keeps moves inside the image', () => {
    expect(strokeWidth(base, 'm', 'pen')).toBe(5)
    expect(strokeWidth(base, 'm', 'marker')).toBe(20)
    expect(strokeWidth({ width: 100, height: 50 }, 's', 'box')).toBe(1.5)
    expect(textSize(base, 'l')).toBe(48)
    const markup: ImageMarkup = { ...base, shapes: [
      { id: 'box', kind: 'box', color: '#ffffff', width: 4, from: { x: 100, y: 100 }, to: { x: 300, y: 200 } },
      { id: 'line', kind: 'pen', color: '#ffffff', width: 4, points: [{ x: 100, y: 150 }, { x: 300, y: 150 }] },
    ] }
    expect(hitShape(markup, { x: 200, y: 152 }, 3)?.id).toBe('line')
    expect(hitShape(markup, { x: 101, y: 120 }, 3)?.id).toBe('box')
    expect(hitShape(markup, { x: 200, y: 120 }, 3)).toBeNull()
    expect(hitShape(markup, { x: 600, y: 400 }, 3)).toBeNull()
    expect(moveShape(base, markup.shapes[0]!, 800, -150)).toMatchObject({ from: { x: 900, y: 0 }, to: { x: 1000, y: 50 } })
    expect(markedFileName('chart.png')).toBe('chart-marked.png')
    expect(markedFileName('vessel-capture')).toBe('vessel-capture-marked.png')
  })
})

beforeAll(() => {
  // jsdom has no pointer events or layout; the stage maps 500×250 screen pixels to a 1000×500 image.
  if (!('PointerEvent' in window)) {
    class PointerEventStub extends MouseEvent { pointerId = 1 }
    Object.defineProperty(window, 'PointerEvent', { configurable: true, value: PointerEventStub })
  }
})
beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 500, height: 250, right: 500, bottom: 250, x: 0, y: 0, toJSON: () => ({}) })
})

function EditorHarness({ initial = null, onMarkup }: { initial?: ImageMarkup | null; onMarkup?: (markup: ImageMarkup | null) => void }) {
  const [markup, setMarkup] = useState(initial)
  return <MarkupEditor imageUrl="blob:test-image" alt="Chart" markup={markup ?? { ...base }} onDone={vi.fn()}
    onChange={next => { setMarkup(next); onMarkup?.(next) }} />
}

const drag = (from: [number, number], to: [number, number]) => {
  const stage = screen.getByRole('application')
  fireEvent.pointerDown(stage, { clientX: from[0], clientY: from[1], button: 0 })
  fireEvent.pointerMove(stage, { clientX: (from[0] + to[0]) / 2, clientY: (from[1] + to[1]) / 2 })
  fireEvent.pointerMove(stage, { clientX: to[0], clientY: to[1] })
  fireEvent.pointerUp(stage, { clientX: to[0], clientY: to[1] })
}

describe('Markup editor', () => {
  it('draws pen strokes, arrows and boxes in image pixels, with undo and redo', async () => {
    const onMarkup = vi.fn()
    render(<EditorHarness onMarkup={onMarkup} />)
    expect(screen.getByRole('button', { name: 'Pen' })).toHaveAttribute('aria-pressed', 'true')
    drag([10, 10], [60, 30])
    expect(onMarkup.mock.lastCall![0].shapes[0]).toMatchObject({ kind: 'pen', color: '#ff5c5c', width: 5,
      points: [{ x: 20, y: 20 }, { x: 70, y: 40 }, { x: 120, y: 60 }] })

    await userEvent.click(screen.getByRole('button', { name: 'Arrow' }))
    await userEvent.click(screen.getByRole('button', { name: 'Yellow' }))
    drag([100, 100], [200, 50])
    expect(onMarkup.mock.lastCall![0].shapes[1]).toMatchObject({ kind: 'arrow', color: '#ffd23f', from: { x: 200, y: 200 }, to: { x: 400, y: 100 } })

    await userEvent.click(screen.getByRole('button', { name: 'Box' }))
    drag([300, 100], [301, 101]) // A click is not a box.
    expect(onMarkup.mock.lastCall![0].shapes).toHaveLength(2)
    drag([300, 100], [450, 200])
    expect(onMarkup.mock.lastCall![0].shapes[2]).toMatchObject({ kind: 'box', from: { x: 600, y: 200 }, to: { x: 900, y: 400 } })

    await userEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(onMarkup.mock.lastCall![0].shapes).toHaveLength(2)
    await userEvent.click(screen.getByRole('button', { name: 'Redo' }))
    expect(onMarkup.mock.lastCall![0].shapes).toHaveLength(3)
    await userEvent.click(screen.getByRole('button', { name: 'Clear all marks' }))
    expect(onMarkup).toHaveBeenLastCalledWith(null)
    await userEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(onMarkup.mock.lastCall![0].shapes).toHaveLength(3)
  })

  it('places and edits text, selects, restyles, moves and deletes marks', async () => {
    const onMarkup = vi.fn()
    render(<EditorHarness onMarkup={onMarkup} />)
    await userEvent.click(screen.getByRole('button', { name: 'Text' }))
    fireEvent.pointerDown(screen.getByRole('application'), { clientX: 50, clientY: 50, button: 0 })
    const input = screen.getByRole('textbox', { name: 'Mark text' })
    await userEvent.type(input, 'Liquidity sweep{Enter}')
    expect(onMarkup.mock.lastCall![0].shapes[0]).toMatchObject({ kind: 'text', text: 'Liquidity sweep', at: { x: 100, y: 100 }, size: 32 })
    expect(screen.queryByRole('textbox', { name: 'Mark text' })).toBeNull()

    await userEvent.click(screen.getByRole('button', { name: 'Select and move' }))
    const stage = screen.getByRole('application')
    fireEvent.pointerDown(stage, { clientX: 60, clientY: 55, button: 0 })
    fireEvent.pointerUp(stage, { clientX: 60, clientY: 55 })
    expect(screen.getByRole('button', { name: 'Delete selected mark' })).toBeEnabled()
    await userEvent.click(screen.getByRole('button', { name: 'Green' }))
    expect(onMarkup.mock.lastCall![0].shapes[0].color).toBe('#4ade80')

    drag([60, 55], [110, 80])
    expect(onMarkup.mock.lastCall![0].shapes[0].at).toEqual({ x: 200, y: 150 })

    fireEvent.doubleClick(stage, { clientX: 110, clientY: 80 })
    const edit = screen.getByRole('textbox', { name: 'Mark text' })
    expect(edit).toHaveValue('Liquidity sweep')
    await userEvent.clear(edit)
    await userEvent.type(edit, 'Sweep{Enter}')
    expect(onMarkup.mock.lastCall![0].shapes[0]).toMatchObject({ text: 'Sweep', color: '#4ade80' })

    fireEvent.pointerDown(stage, { clientX: 110, clientY: 80, button: 0 })
    fireEvent.pointerUp(stage, { clientX: 110, clientY: 80 })
    fireEvent.keyDown(stage, { key: 'Delete' })
    expect(onMarkup).toHaveBeenLastCalledWith(null)
  })
})

describe('Marked images in the evidence panel', () => {
  const marked = (): DraftEvidence => ({
    ...createEvidence('upload', new Blob(['png'], { type: 'image/png' }), 'daily.png'),
    markup: { ...base, shapes: [{ id: 'b', kind: 'box', color: '#ff5c5c', width: 5, from: { x: 1, y: 1 }, to: { x: 99, y: 99 } }] },
  })
  function Harness({ initial }: { initial: DraftEvidence[] }) {
    const [list, setList] = useState(initial)
    return <EvidencePanel evidence={list} onChange={update => setList(update)} />
  }

  it('shows the marked version by default and switches to the original', async () => {
    render(<Harness initial={[marked()]} />)
    const card = screen.getByRole('listitem')
    expect(within(card).getByText('Marked')).toBeInTheDocument()
    expect(within(card).getByTestId('marks-overlay').getAttribute('src')).toMatch(/^data:image\/svg\+xml/)
    await userEvent.click(screen.getByRole('button', { name: /^Open Image 1/ }))
    const viewer = await screen.findByRole('dialog')
    expect(within(viewer).getByRole('button', { name: 'Marked' })).toHaveAttribute('aria-pressed', 'true')
    expect(within(viewer).getByRole('img', { name: 'daily.png, with marks' })).toBeInTheDocument()
    expect(within(viewer).getByTestId('marks-overlay')).toBeInTheDocument()
    await userEvent.click(within(viewer).getByRole('button', { name: 'Original' }))
    expect(within(viewer).queryByTestId('marks-overlay')).toBeNull()
    expect(within(viewer).getByRole('img', { name: 'daily.png' })).toBeInTheDocument()
    expect(within(viewer).getByRole('button', { name: 'Download original' })).toBeInTheDocument()
  })

  it('opens the editor from the viewer and keeps the dialog open on Escape while editing', async () => {
    render(<Harness initial={[{ ...marked(), markup: null }]} />)
    await userEvent.click(screen.getByRole('button', { name: /^Open Image 1/ }))
    const viewer = await screen.findByRole('dialog')
    expect(within(viewer).getByText('No marks yet')).toBeInTheDocument()
    await userEvent.click(within(viewer).getByRole('button', { name: 'Mark up' }))
    expect(within(viewer).getByRole('toolbar', { name: 'Markup tools' })).toBeInTheDocument()
    await userEvent.keyboard('{Escape}')
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    await userEvent.click(within(viewer).getByRole('button', { name: 'Done' }))
    expect(within(viewer).queryByRole('toolbar')).toBeNull()
  })
})
