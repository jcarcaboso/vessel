import { lazy, type ComponentType } from 'react'
import { PageLoadFallback } from '@/components/PageErrorBoundary'

export function lazyPage<Props extends object>(load: () => Promise<{ default: ComponentType<Props> }>) {
  return lazy<ComponentType<Props>>(async () => {
    try { return await load() }
    // Native imports can cache fetch, link and evaluation failures. Keep the shell alive without
    // claiming another import of the same URL will recover, or re-evaluating a changed module graph.
    catch { return { default: PageLoadFallback } }
  })
}
