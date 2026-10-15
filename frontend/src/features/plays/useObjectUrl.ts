import { useEffect, useState } from 'react'

/** Each consumer owns its URL, so a viewer closing cannot revoke a thumbnail's URL for the same Blob. */
export function useObjectUrl(blob: Blob) {
  const [lease, setLease] = useState<{ blob: Blob; url: string } | null>(null)
  useEffect(() => {
    const url = URL.createObjectURL(blob)
    // Object URLs are external resources, acquired only after commit, including StrictMode's replay.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLease({ blob, url })
    return () => URL.revokeObjectURL(url)
  }, [blob])
  return lease?.blob === blob ? lease.url : undefined
}
