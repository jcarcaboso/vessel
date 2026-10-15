import { createContext, useCallback, useContext, useMemo, useState } from 'react'

type Update<T> = T | ((current: T) => T)

type JournalStore = {
  values: Readonly<Record<string, unknown>>
  set: (key: string, update: Update<unknown>, initial: unknown) => void
}

/**
 * Working state of the journal's tabs that lives above the inline and expanded views. Expanding the journal unmounts
 * the inline tabs and mounts new ones in the dialog (and back), so anything the owner has half done and that is not
 * part of the play draft, such as an order role picked in the Execution tab, is kept here instead of being lost.
 */
export const JournalStateContext = createContext<JournalStore | null>(null)

/** Creates the store the journal provides to its tabs. */
export function useJournalStore(): JournalStore {
  const [values, setValues] = useState<Record<string, unknown>>({})
  const set = useCallback((key: string, update: Update<unknown>, initial: unknown) => {
    setValues(current => ({ ...current, [key]: typeof update === 'function' ? (update as (value: unknown) => unknown)(key in current ? current[key] : initial) : update }))
  }, [])
  return useMemo(() => ({ values, set }), [values, set])
}

/**
 * Like `useState`, but it survives the tab being unmounted and remounted inside the same journal. Outside a journal it
 * is plain local state, so a panel also works on its own. Keys name one value each; scope them, e.g. by play.
 */
export function useJournalState<T>(key: string, initial: T): [T, (update: Update<T>) => void] {
  const store = useContext(JournalStateContext)
  const [local, setLocal] = useState(initial)
  const set = store?.set
  const setValue = useCallback((update: Update<T>) => {
    if (set) set(key, update as Update<unknown>, initial)
    else setLocal(update)
  }, [set, key, initial])
  return [store ? (key in store.values ? store.values[key] as T : initial) : local, setValue]
}
