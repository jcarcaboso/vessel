import { lazy, type ComponentType } from 'react'

/** Invalidate only after the boundary catches, not on rejection, which could cause an automatic retry loop. */
export function lazyPage<Props extends object>(load: () => Promise<{ default: ComponentType<Props> }>) {
  let Current = lazy(load)
  function Page(props: Props) { return <Current {...props} /> }
  // Keep the wrapper stable for healthy mounted pages. Repeat the same import on the next explicit retry or visit.
  // This clears React's rejection, not the browser's module cache; cached evaluation errors may still need a reload.
  return { Page, reset: () => { Current = lazy(load) } }
}
