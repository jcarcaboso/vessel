import { useCallback, useEffect, useState } from 'react'

const pageIds = ['overview', 'plays', 'review', 'portfolios', 'accounts', 'activity', 'settings'] as const
export type Page = typeof pageIds[number]
const pageFromHash = (): Page => pageIds.find(id => id === window.location.hash.slice(1)) ?? 'overview'

export function useHashPage(onNavigate: (page: Page) => void) {
  const [page, setPage] = useState(pageFromHash)
  const accept = useCallback((next: Page) => {
    setPage(next)
    onNavigate(next)
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' })
  }, [onNavigate])
  useEffect(() => {
    const handle = () => accept(pageFromHash())
    window.addEventListener('hashchange', handle)
    return () => window.removeEventListener('hashchange', handle)
  }, [accept])
  const navigate = (next: Page) => {
    window.location.hash = next
    accept(next)
  }
  return { page, navigate }
}
