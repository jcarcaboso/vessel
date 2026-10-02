import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import type { ChartDrawing, DrawingKind, DrawingStyle } from './drawings'
import type { ChartHistory } from './useChartHistory'

/**
 * Tool and selection state for one drawing list. The caller owns the list, so drawings can live in
 * any feature model; changes are recorded in the shared chart history. `scopeKey` resets selection.
 */
export function useDrawingEditor(drawings: readonly ChartDrawing[], onChange: (next: ChartDrawing[]) => void, scopeKey: string, history: ChartHistory) {
  const [state, setState] = useState({ scopeKey, tool: null as DrawingKind | null, selectedId: null as string | null })
  const gestureStart = useRef<readonly ChartDrawing[] | null>(null)
  // History actions run later, so they always write through the latest callback.
  const change = useRef(onChange)
  useEffect(() => { change.current = onChange })
  if (state.scopeKey !== scopeKey) setState({ scopeKey, tool: null, selectedId: null })
  const current = state.scopeKey === scopeKey ? state : { scopeKey, tool: null, selectedId: null }
  const selected = drawings.find(drawing => drawing.id === current.selectedId) ?? null

  const record = (label: string, before: readonly ChartDrawing[], after: readonly ChartDrawing[]) => history.push({
    label, undo: () => change.current([...before]), redo: () => change.current([...after]),
  })
  const commit = (label: string, next: ChartDrawing[]) => { record(label, drawings, next); onChange(next) }
  const update = (id: string, patch: (drawing: ChartDrawing) => ChartDrawing) =>
    drawings.map(drawing => drawing.id === id ? patch(drawing) : drawing)
  const textStart = useRef<readonly ChartDrawing[] | null>(null)

  return {
    tool: current.tool,
    selected,
    selectedId: selected?.id ?? null,
    setTool: (tool: DrawingKind | null) => setState(value => ({ ...value, tool, selectedId: tool ? null : value.selectedId })),
    select: (id: string | null) => setState(value => ({ ...value, selectedId: id })),
    create: (drawing: ChartDrawing) => {
      commit('Add drawing', [...drawings, drawing])
      setState(value => ({ ...value, tool: null, selectedId: drawing.id }))
    },
    change: (drawing: ChartDrawing, phase: 'move' | 'end') => {
      gestureStart.current ??= drawings
      const next = drawings.map(existing => existing.id === drawing.id ? drawing : existing)
      onChange(next)
      if (phase === 'end') {
        record('Move drawing', gestureStart.current, next)
        gestureStart.current = null
      }
    },
    /** Note edits are recorded once, when the field loses focus. */
    beginTextEdit: () => { textStart.current = drawings },
    endTextEdit: () => {
      if (textStart.current && textStart.current !== drawings) record('Edit note', textStart.current, drawings)
      textStart.current = null
    },
    setText: (id: string, text: string) => onChange(update(id, drawing => ({ ...drawing, text }))),
    /** Appearance changes are allowed while locked. */
    setStyle: (id: string, style: DrawingStyle) => commit('Style drawing', update(id, drawing => ({ ...drawing, style: { ...drawing.style, ...style } }))),
    setLocked: (id: string, locked: boolean) => commit(locked ? 'Lock drawing' : 'Unlock drawing', update(id, drawing => ({ ...drawing, locked }))),
    remove: () => {
      if (!selected || selected.locked) return
      commit('Delete drawing', drawings.filter(drawing => drawing.id !== selected.id))
      setState(value => ({ ...value, selectedId: null }))
    },
    /** Removes unlocked drawings; locked ones stay until unlocked. */
    clear: () => {
      const kept = drawings.filter(drawing => drawing.locked)
      if (kept.length === drawings.length) return
      commit('Clear drawings', kept)
      setState(value => ({ ...value, selectedId: kept.some(drawing => drawing.id === value.selectedId) ? value.selectedId : null }))
    },
    clearable: drawings.some(drawing => !drawing.locked),
    /** Delete and Escape for drawings; returns true when handled. Undo/redo keys belong to the caller. */
    onKeyDown: (event: KeyboardEvent) => {
      if ((event.key === 'Delete' || event.key === 'Backspace') && selected) {
        event.preventDefault()
        if (!selected.locked) {
          commit('Delete drawing', drawings.filter(drawing => drawing.id !== selected.id))
          setState(value => ({ ...value, selectedId: null }))
        }
        return true
      }
      if (event.key === 'Escape' && (current.tool || selected)) {
        event.preventDefault()
        event.stopPropagation()
        setState(value => ({ ...value, tool: null, selectedId: null }))
        return true
      }
      return false
    },
  }
}
