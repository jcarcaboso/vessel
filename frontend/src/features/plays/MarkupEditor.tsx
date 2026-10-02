import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type MouseEvent, type PointerEvent, type ReactNode } from 'react'
import { Check, Eraser, Highlighter, MousePointer2, MoveUpRight, Pencil, Redo2, Square, Trash2, Type, Undo2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  clampPoint, hitShape, markupColors, markupDataUrl, markupId, markupLimits, moveShape, strokeWidth, textSize,
  type ImageMarkup, type MarkupPoint, type MarkupShape, type MarkupSize, type MarkupTool,
} from './markup'

const tools: Array<[MarkupTool, string, ReactNode]> = [
  ['select', 'Select and move', <MousePointer2 key="select" size={15} aria-hidden="true" />],
  ['pen', 'Pen', <Pencil key="pen" size={15} aria-hidden="true" />],
  ['marker', 'Marker', <Highlighter key="marker" size={15} aria-hidden="true" />],
  ['arrow', 'Arrow', <MoveUpRight key="arrow" size={15} aria-hidden="true" />],
  ['box', 'Box', <Square key="box" size={15} aria-hidden="true" />],
  ['text', 'Text', <Type key="text" size={15} aria-hidden="true" />],
]
const colorNames: Record<(typeof markupColors)[number], string> = {
  '#ff5c5c': 'Red', '#ffd23f': 'Yellow', '#4ade80': 'Green', '#60a5fa': 'Blue', '#ffffff': 'White', '#111111': 'Black',
}
const sizes: Array<[MarkupSize, string]> = [['s', 'Thin'], ['m', 'Medium'], ['l', 'Thick']]

/** `scale` is screen pixels per image pixel when the text box opened. */
interface TextDraft { at: MarkupPoint; value: string; editingId: string | null; scale: number }
type Gesture =
  | { kind: 'draw'; shape: MarkupShape }
  | { kind: 'move'; shape: MarkupShape; start: MarkupPoint; moved: MarkupShape }

/**
 * Draws pen strokes, marker highlights, arrows, boxes and text over an image. Every finished
 * change is applied at once (so closing the viewer keeps it) and can be undone while editing.
 */
export function MarkupEditor({ imageUrl, alt, markup, onChange, onDone }: {
  imageUrl: string
  alt: string
  markup: ImageMarkup | null
  onChange: (markup: ImageMarkup | null) => void
  onDone: () => void
}) {
  const stage = useRef<HTMLDivElement>(null)
  const [natural, setNatural] = useState<{ width: number; height: number } | null>(markup ? { width: markup.width, height: markup.height } : null)
  const [tool, setTool] = useState<MarkupTool>('pen')
  const [color, setColor] = useState<string>(markupColors[0])
  const [size, setSize] = useState<MarkupSize>('m')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [gesture, setGesture] = useState<Gesture | null>(null)
  const [text, setTextState] = useState<TextDraft | null>(null)
  // Pointer-down and blur can both finish the same text; the ref makes the second a no-op.
  const textDraft = useRef<TextDraft | null>(null)
  const setText = (next: TextDraft | null) => { textDraft.current = next; setTextState(next) }
  const [history, setHistory] = useState<{ past: Array<ImageMarkup | null>; future: Array<ImageMarkup | null> }>({ past: [], future: [] })
  const textInput = useRef<HTMLInputElement>(null)
  const textOpen = text !== null
  useEffect(() => { if (textOpen) textInput.current?.focus() }, [textOpen])

  const current = useMemo<ImageMarkup | null>(() => markup ?? (natural ? { ...natural, shapes: [] } : null), [markup, natural])
  const preview = useMemo(() => {
    if (!current || !gesture) return current
    const shape = gesture.kind === 'draw' ? gesture.shape : gesture.moved
    const exists = current.shapes.some(item => item.id === shape.id)
    return { ...current, shapes: exists ? current.shapes.map(item => item.id === shape.id ? shape : item) : [...current.shapes, shape] }
  }, [current, gesture])
  const selected = current?.shapes.find(shape => shape.id === selectedId) ?? null

  function commit(next: ImageMarkup) {
    setHistory(previous => ({ past: [...previous.past, markup], future: [] }))
    onChange(next.shapes.length ? next : null)
  }
  const replaceShape = (shape: MarkupShape) => current && commit({ ...current, shapes: current.shapes.map(item => item.id === shape.id ? shape : item) })
  const removeSelected = () => {
    if (!current || !selected) return
    commit({ ...current, shapes: current.shapes.filter(shape => shape.id !== selected.id) })
    setSelectedId(null)
  }
  const undo = () => {
    const previous = history.past.at(-1)
    if (previous === undefined) return
    setHistory(({ past, future }) => ({ past: past.slice(0, -1), future: [markup, ...future] }))
    setSelectedId(null)
    onChange(previous)
  }
  const redo = () => {
    const [next, ...rest] = history.future
    if (next === undefined) return
    setHistory(({ past }) => ({ past: [...past, markup], future: rest }))
    setSelectedId(null)
    onChange(next)
  }

  /** Image pixels per screen pixel, for tolerances and minimum gesture lengths. */
  const scale = () => {
    const rect = stage.current?.getBoundingClientRect()
    return current && rect?.width ? current.width / rect.width : 1
  }
  const toPoint = (event: PointerEvent) => {
    const rect = stage.current!.getBoundingClientRect()
    return clampPoint(current!, { x: (event.clientX - rect.left) / rect.width * current!.width, y: (event.clientY - rect.top) / rect.height * current!.height })
  }

  function commitText() {
    const draft = textDraft.current
    setText(null)
    if (!draft || !current) return
    const value = draft.value.trim().slice(0, markupLimits.text)
    const editing = draft.editingId ? current.shapes.find(shape => shape.id === draft.editingId) : null
    if (editing?.kind === 'text') {
      commit({ ...current, shapes: value ? current.shapes.map(shape => shape.id === editing.id ? { ...editing, text: value } : shape) : current.shapes.filter(shape => shape.id !== editing.id) })
    } else if (value && current.shapes.length < markupLimits.shapes) {
      commit({ ...current, shapes: [...current.shapes, { id: markupId(), kind: 'text', color, size: textSize(current, size), at: draft.at, text: value }] })
    }
  }

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (!current || event.button !== 0) return
    // The browser would move focus on mouse-down, closing a just-opened text box; focus is managed here.
    event.preventDefault()
    if (text) { commitText(); return }
    if (tool !== 'text') stage.current!.focus({ preventScroll: true })
    const point = toPoint(event)
    stage.current!.setPointerCapture?.(event.pointerId)
    if (tool === 'select') {
      const hit = hitShape(current, point, 6 * scale())
      setSelectedId(hit?.id ?? null)
      if (hit) setGesture({ kind: 'move', shape: hit, start: point, moved: hit })
      return
    }
    setSelectedId(null)
    if (tool === 'text') { setText({ at: point, value: '', editingId: null, scale: 1 / scale() }); return }
    if (current.shapes.length >= markupLimits.shapes) return
    const width = strokeWidth(current, size, tool)
    setGesture({ kind: 'draw', shape: tool === 'pen' || tool === 'marker'
      ? { id: markupId(), kind: tool, color, width, points: [point] }
      : { id: markupId(), kind: tool, color, width, from: point, to: point } })
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    if (!gesture || !current) return
    const point = toPoint(event)
    if (gesture.kind === 'move') {
      setGesture({ ...gesture, moved: moveShape(current, gesture.shape, point.x - gesture.start.x, point.y - gesture.start.y) })
      return
    }
    const shape = gesture.shape
    if (shape.kind === 'pen' || shape.kind === 'marker') {
      const last = shape.points.at(-1)!
      if (shape.points.length < markupLimits.points && Math.hypot(point.x - last.x, point.y - last.y) >= 2 * scale())
        setGesture({ kind: 'draw', shape: { ...shape, points: [...shape.points, point] } })
    } else if (shape.kind === 'arrow' || shape.kind === 'box') {
      setGesture({ kind: 'draw', shape: { ...shape, to: point } })
    }
  }

  function onPointerUp() {
    if (!gesture || !current) return
    setGesture(null)
    if (gesture.kind === 'move') {
      if (gesture.moved !== gesture.shape) replaceShape(gesture.moved)
      return
    }
    const shape = gesture.shape
    // A click with the arrow or box tool is not a mark.
    if ((shape.kind === 'arrow' || shape.kind === 'box') && Math.hypot(shape.to.x - shape.from.x, shape.to.y - shape.from.y) < 4 * scale()) return
    commit({ ...current, shapes: [...current.shapes, shape] })
  }

  function onDoubleClick(event: MouseEvent<HTMLDivElement>) {
    if (!current || tool !== 'select') return
    const rect = stage.current!.getBoundingClientRect()
    const hit = hitShape(current, { x: (event.clientX - rect.left) / rect.width * current.width, y: (event.clientY - rect.top) / rect.height * current.height }, 6 * scale())
    if (hit?.kind === 'text') setText({ at: hit.at, value: hit.text, editingId: hit.id, scale: 1 / scale() })
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.target instanceof HTMLInputElement) return
    const key = event.key.toLowerCase()
    if ((event.metaKey || event.ctrlKey) && (key === 'y' || key === 'z' && event.shiftKey)) { event.preventDefault(); redo() }
    else if ((event.metaKey || event.ctrlKey) && key === 'z') { event.preventDefault(); undo() }
    else if ((key === 'delete' || key === 'backspace') && selected) { event.preventDefault(); removeSelected() }
    else if (key === 'escape') { event.preventDefault(); if (gesture) setGesture(null); else if (selectedId) setSelectedId(null); else onDone() }
  }

  // A chosen colour or size also restyles the selected mark.
  function chooseColor(next: string) {
    setColor(next)
    if (selected) replaceShape({ ...selected, color: next })
  }
  function chooseSize(next: MarkupSize) {
    setSize(next)
    if (!selected || !current) return
    replaceShape(selected.kind === 'text' ? { ...selected, size: textSize(current, next) } : { ...selected, width: strokeWidth(current, next, selected.kind) })
  }

  const editingText = text?.editingId ? current?.shapes.find(shape => shape.id === text.editingId) : null
  const shownTextSize = text && current ? (editingText?.kind === 'text' ? editingText.size : textSize(current, size)) * text.scale : 14
  return <div className="markup-editor" onKeyDown={onKeyDown}>
    <div className="markup-toolbar" role="toolbar" aria-label="Markup tools">
      <div className="markup-group">
        {tools.map(([id, label, icon]) => <button key={id} type="button" className="markup-button" aria-label={label} title={label}
          aria-pressed={tool === id} onClick={() => { setTool(id); if (id !== 'select') setSelectedId(null) }}>{icon}</button>)}
      </div>
      <div className="markup-group" role="group" aria-label="Colour">
        {markupColors.map(value => <button key={value} type="button" className="markup-swatch" aria-label={colorNames[value]} title={colorNames[value]}
          aria-pressed={(selected?.color ?? color) === value} style={{ background: value }} onClick={() => chooseColor(value)} />)}
      </div>
      <div className="markup-group" role="group" aria-label="Size">
        {sizes.map(([id, label]) => <button key={id} type="button" className="markup-button markup-size" aria-label={label} title={label}
          aria-pressed={size === id} onClick={() => chooseSize(id)}><i data-size={id} aria-hidden="true" /></button>)}
      </div>
      <div className="markup-group">
        <button type="button" className="markup-button" aria-label="Undo" title="Undo" disabled={!history.past.length} onClick={undo}><Undo2 size={15} aria-hidden="true" /></button>
        <button type="button" className="markup-button" aria-label="Redo" title="Redo" disabled={!history.future.length} onClick={redo}><Redo2 size={15} aria-hidden="true" /></button>
        <button type="button" className="markup-button" aria-label="Delete selected mark" title="Delete selected mark" disabled={!selected} onClick={removeSelected}><Trash2 size={15} aria-hidden="true" /></button>
        <button type="button" className="markup-button" aria-label="Clear all marks" title="Clear all marks" disabled={!current?.shapes.length}
          onClick={() => { if (current) { commit({ ...current, shapes: [] }); setSelectedId(null) } }}><Eraser size={15} aria-hidden="true" /></button>
      </div>
      <Button type="button" size="sm" className="markup-done" onClick={() => { commitText(); onDone() }}><Check size={14} aria-hidden="true" />Done</Button>
    </div>
    <div className="markup-frame">
      <div ref={stage} className="markup-stage" data-tool={tool} tabIndex={0} role="application" aria-roledescription="image markup"
        aria-label={`${alt}. Draw with the chosen tool. Select a mark to move it, Delete removes it, Ctrl+Z undoes.`}
        style={current ? { aspectRatio: `${current.width} / ${current.height}`, '--markup-ratio': current.width / current.height } as CSSProperties : undefined}
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={() => setGesture(null)} onDoubleClick={onDoubleClick}>
        <img src={imageUrl} alt="" draggable={false}
          onLoad={event => { const image = event.currentTarget; if (!natural && image.naturalWidth) setNatural({ width: image.naturalWidth, height: image.naturalHeight }) }} />
        {preview && <img className="markup-overlay" src={markupDataUrl(preview, selectedId)} alt="" draggable={false} data-testid="markup-overlay" />}
        {text && current && <input ref={textInput} className="markup-text-input" aria-label="Mark text" value={text.value} maxLength={markupLimits.text}
          style={{ left: `${text.at.x / current.width * 100}%`, top: `${text.at.y / current.height * 100}%`, fontSize: `${shownTextSize}px`, color: editingText?.color ?? color }}
          onChange={event => setText({ ...text, value: event.target.value })} onPointerDown={event => event.stopPropagation()}
          onKeyDown={event => {
            if (event.key === 'Enter') { event.preventDefault(); commitText() }
            else if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setText(null) }
          }} onBlur={() => commitText()} />}
      </div>
    </div>
    <p className="markup-hint">{tool === 'text' ? 'Click where the text should start, type, then press Enter.' : tool === 'select' ? 'Drag a mark to move it. Double-click text to edit it. Delete removes the selected mark.' : 'Drag on the image to draw.'} The original image is kept.</p>
  </div>
}
