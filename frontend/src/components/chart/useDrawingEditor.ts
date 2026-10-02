import { useRef, useState, type KeyboardEvent } from 'react'
import type { ChartDrawing, DrawingKind, DrawingStyle } from './drawings'

const historyLimit = 50

/**
 * Tool, selection and undo state for one drawing list. The caller owns the list, so drawings can
 * live in any feature model; `scopeKey` (e.g. the instrument) resets selection and history.
 */
export function useDrawingEditor(drawings: readonly ChartDrawing[], onChange: (next: ChartDrawing[]) => void, scopeKey: string) {
  const [state, setState] = useState({ scopeKey, tool: null as DrawingKind | null, selectedId: null as string | null, history: [] as ChartDrawing[][] })
  const gestureStart = useRef<readonly ChartDrawing[] | null>(null)
  if (state.scopeKey !== scopeKey) setState({ scopeKey, tool: null, selectedId: null, history: [] })
  const current = state.scopeKey === scopeKey ? state : { scopeKey, tool: null, selectedId: null, history: [] }
  const selected = drawings.find(drawing => drawing.id === current.selectedId) ?? null

  const remember = (previous: readonly ChartDrawing[]) =>
    setState(value => ({ ...value, history: [...value.history.slice(-(historyLimit - 1)), [...previous]] }))
  const commit = (next: ChartDrawing[]) => { remember(drawings); onChange(next) }
  const replace = (drawing: ChartDrawing) => drawings.map(existing => existing.id === drawing.id ? drawing : existing)

  const editor = {
    tool: current.tool,
    selected,
    selectedId: selected?.id ?? null,
    canUndo: current.history.length > 0,
    setTool: (tool: DrawingKind | null) => setState(value => ({ ...value, tool, selectedId: tool ? null : value.selectedId })),
    select: (id: string | null) => setState(value => ({ ...value, selectedId: id })),
    create: (drawing: ChartDrawing) => {
      commit([...drawings, drawing])
      setState(value => ({ ...value, tool: null, selectedId: drawing.id }))
    },
    change: (drawing: ChartDrawing, phase: 'move' | 'end') => {
      gestureStart.current ??= drawings
      onChange(replace(drawing))
      if (phase === 'end') {
        remember(gestureStart.current)
        gestureStart.current = null
      }
    },
    /** Call when a text field gains focus so the whole edit undoes in one step. */
    beginTextEdit: () => remember(drawings),
    setText: (id: string, text: string) => onChange(drawings.map(drawing => drawing.id === id ? { ...drawing, text } : drawing)),
    /** Appearance changes are single undo steps and allowed while locked. */
    setStyle: (id: string, style: DrawingStyle) => commit(drawings.map(drawing =>
      drawing.id === id ? { ...drawing, style: { ...drawing.style, ...style } } : drawing)),
    setLocked: (id: string, locked: boolean) => commit(drawings.map(drawing => drawing.id === id ? { ...drawing, locked } : drawing)),
    remove: () => {
      if (!selected || selected.locked) return
      commit(drawings.filter(drawing => drawing.id !== selected.id))
      setState(value => ({ ...value, selectedId: null }))
    },
    /** Removes unlocked drawings; locked ones stay until unlocked. */
    clear: () => {
      const kept = drawings.filter(drawing => drawing.locked)
      if (kept.length === drawings.length) return
      commit(kept)
      setState(value => ({ ...value, selectedId: kept.some(drawing => drawing.id === value.selectedId) ? value.selectedId : null }))
    },
    clearable: drawings.some(drawing => !drawing.locked),
    undo: () => {
      const previous = current.history.at(-1)
      if (!previous) return
      onChange(previous)
      setState(value => ({ ...value, history: value.history.slice(0, -1),
        selectedId: previous.some(drawing => drawing.id === value.selectedId) ? value.selectedId : null }))
    },
    onKeyDown: (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); editor.undo() }
      else if ((event.key === 'Delete' || event.key === 'Backspace') && selected && !selected.locked) { event.preventDefault(); editor.remove() }
      else if (event.key === 'Escape' && (current.tool || selected)) {
        event.preventDefault()
        event.stopPropagation()
        setState(value => ({ ...value, tool: null, selectedId: null }))
      }
    },
  }
  return editor
}
