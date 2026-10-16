import { useEffect, useState } from 'react'

/**
 * True only once `active` has stayed true for `delay` milliseconds, and false as soon as it ends, so a
 * loading placeholder never flashes for a fast response.
 */
export function useDelayedFlag(active: boolean, delay = 200): boolean {
  const [elapsed, setElapsed] = useState(false)
  useEffect(() => {
    if (!active) return
    const timer = setTimeout(() => setElapsed(true), delay)
    return () => { clearTimeout(timer); setElapsed(false) }
  }, [active, delay])
  return active && elapsed
}
