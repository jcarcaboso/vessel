import { useState } from 'react'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { DraftEvidence } from './draft'
import { createEvidence, evidenceLimits, evidenceProblem, sniffImageType } from './evidence'
import { EvidencePanel } from './EvidencePanel'
import { PlayJournal } from './WorkspacePanels'
import { createDraft } from './draft'

const png = () => new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1])], 'setup.png', { type: 'image/png' })
const jpeg = () => new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])], 'daily.jpg', { type: 'image/jpeg' })
const webp = () => new Blob([new TextEncoder().encode('RIFF\0\0\0\0WEBP')])

function Harness({ initial = [], onList }: { initial?: DraftEvidence[]; onList?: (list: DraftEvidence[]) => void }) {
  const [list, setList] = useState(initial)
  return <EvidencePanel evidence={list} onChange={update => setList(current => { const next = update(current); onList?.(next); return next })} />
}

describe('Evidence helpers', () => {
  it('accepts PNG, JPEG and WebP by signature, whatever the declared type', async () => {
    expect(await sniffImageType(png())).toBe('image/png')
    expect(await sniffImageType(jpeg())).toBe('image/jpeg')
    expect(await sniffImageType(webp())).toBe('image/webp')
    expect(await sniffImageType(new File(['<svg/>'], 'x.png', { type: 'image/png' }))).toBeNull()
    expect(await evidenceProblem(new Blob([]))).toBe('The image is empty.')
    expect(await evidenceProblem(new File(['GIF89a'], 'x.gif'))).toBe('Only PNG, JPEG or WebP images can be added.')
    const huge = { size: evidenceLimits.maxBytes + 1, slice: () => png() } as unknown as Blob
    expect(await evidenceProblem(huge)).toBe('Images are limited to 10 MB.')
    expect(await evidenceProblem(png())).toBeNull()
  })
})

describe('Evidence panel', () => {
  it('adds uploaded images, rejects other files, and edits each note inline and in the viewer', async () => {
    const onList = vi.fn()
    render(<Harness onList={onList} />)
    expect(screen.getByText(/No images yet/)).toBeInTheDocument()
    const input = document.querySelector<HTMLInputElement>('input[type="file"]')!
    expect(input).toHaveAttribute('accept', 'image/png,image/jpeg,image/webp')
    await userEvent.upload(input, [png(), new File(['plain text'], 'notes.png', { type: 'image/png' }), jpeg()], { applyAccept: false })

    expect(await screen.findByRole('alert')).toHaveTextContent('notes.png: Only PNG, JPEG or WebP images can be added.')
    const cards = within(screen.getByRole('list', { name: 'Evidence images' })).getAllByRole('listitem')
    expect(cards).toHaveLength(2)
    expect(cards[0]).toHaveTextContent('Upload')
    expect(cards[0]).toHaveTextContent('setup.png')
    expect(screen.getByText('2 of 50 · Kept in this browser until the play is saved')).toBeInTheDocument()
    expect(within(cards[1]!).getByRole('link', { name: 'Download image 2' })).toHaveAttribute('download', 'daily.jpg')

    await userEvent.type(screen.getByRole('textbox', { name: 'Note for image 1' }), 'Range high')
    expect(onList.mock.lastCall![0][0].note).toBe('Range high')

    await userEvent.click(screen.getByRole('button', { name: 'Open Image 1: setup.png' }))
    const viewer = await screen.findByRole('dialog', { name: 'setup.png' })
    expect(within(viewer).getByRole('img', { name: 'setup.png' })).toHaveAttribute('src', 'blob:test-image')
    const note = within(viewer).getByRole('textbox', { name: 'Note for image 1' })
    expect(note).toHaveValue('Range high')
    await userEvent.type(note, ', retested')
    await userEvent.keyboard('{Escape}')
    expect(screen.getByRole('textbox', { name: 'Note for image 1' })).toHaveValue('Range high, retested')
  })

  it('removes an image only after confirmation and releases its URL', async () => {
    const items = [createEvidence('capture', png(), 'vessel-capture.png', 'BTC · Hyperliquid · 1 hour'), createEvidence('upload', jpeg(), 'daily.jpg')]
    render(<Harness initial={items} />)
    expect(screen.getAllByRole('listitem')[0]).toHaveTextContent('Capture')
    expect(screen.getAllByRole('listitem')[0]).toHaveTextContent('BTC · Hyperliquid · 1 hour')
    await userEvent.click(screen.getByRole('button', { name: 'Remove image 1' }))
    await userEvent.click(within(screen.getByRole('group', { name: 'Remove image 1?' })).getByRole('button', { name: 'Cancel' }))
    expect(screen.getAllByRole('listitem')).toHaveLength(2)
    await userEvent.click(screen.getByRole('button', { name: 'Remove image 1' }))
    await userEvent.click(within(screen.getByRole('group', { name: 'Remove image 1?' })).getByRole('button', { name: 'Remove' }))
    expect(screen.getAllByRole('listitem')).toHaveLength(1)
    expect(screen.getAllByRole('listitem')[0]).toHaveTextContent('daily.jpg')
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:test-image')
  })

  it('stops at the per-play limit', async () => {
    const full = Array.from({ length: evidenceLimits.maxItems - 1 }, () => createEvidence('upload', png(), 'a.png'))
    render(<Harness initial={full} />)
    await userEvent.upload(document.querySelector<HTMLInputElement>('input[type="file"]')!, [png(), png()])
    expect(await screen.findByRole('alert')).toHaveTextContent('Only 1 more image fits; a play holds at most 50.')
    expect(screen.getAllByRole('listitem')).toHaveLength(50)
    expect(screen.getByRole('button', { name: 'Upload image' })).toBeDisabled()
  })
})

describe('Journal evidence tab', () => {
  it('opens the Evidence tab on request and shows the image count', () => {
    const notes = createDraft().notes
    const evidence = [createEvidence('capture', png(), 'c.png', 'BTC')]
    const { rerender } = render(<PlayJournal notes={notes} onChange={vi.fn()} evidence={evidence} onEvidenceChange={vi.fn()} evidenceRequest={0} />)
    expect(screen.getByRole('tab', { name: 'Thesis' })).toHaveAttribute('aria-selected', 'true')
    rerender(<PlayJournal notes={notes} onChange={vi.fn()} evidence={evidence} onEvidenceChange={vi.fn()} evidenceRequest={1} />)
    const tab = screen.getByRole('tab', { name: 'Evidence' })
    expect(tab).toHaveAttribute('aria-selected', 'true')
    expect(tab).toHaveTextContent('Evidence1')
    expect(screen.getByRole('list', { name: 'Evidence images' })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Evidence' })).toBeInTheDocument()
  })
})
