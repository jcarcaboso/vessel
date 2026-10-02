import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

/** One reversible chart change. Both directions must read current state, not captured state. */
export interface ChartHistoryAction {
  label: string
  undo(): void
  redo(): void
}

const limit = 50

/** Undo and redo for chart edits (drawings and plotted levels). `scopeKey` changes reset it. */
export function useChartHistory(scopeKey: string) {
  const [state, setState] = useState({ scopeKey, past: [] as ChartHistoryAction[], future: [] as ChartHistoryAction[] })
  if (state.scopeKey !== scopeKey) setState({ scopeKey, past: [], future: [] })
  const current = state.scopeKey === scopeKey ? state : { scopeKey, past: [], future: [] }
  const latest = useRef(current)
  useEffect(() => { latest.current = current })

  const push = useCallback((action: ChartHistoryAction) =>
    setState(value => ({ ...value, past: [...value.past.slice(-(limit - 1)), action], future: [] })), [])
  const undo = useCallback(() => {
    const action = latest.current.past.at(-1)
    if (!action) return
    action.undo()
    setState(value => ({ ...value, past: value.past.slice(0, -1), future: [...value.future, action] }))
  }, [])
  const redo = useCallback(() => {
    const action = latest.current.future.at(-1)
    if (!action) return
    action.redo()
    setState(value => ({ ...value, future: value.future.slice(0, -1), past: [...value.past, action] }))
  }, [])

  return useMemo(() => ({
    push, undo, redo,
    canUndo: current.past.length > 0,
    canRedo: current.future.length > 0,
    undoLabel: current.past.at(-1)?.label ?? null,
    redoLabel: current.future.at(-1)?.label ?? null,
  }), [push, undo, redo, current.past, current.future])
}

export type ChartHistory = ReturnType<typeof useChartHistory>
