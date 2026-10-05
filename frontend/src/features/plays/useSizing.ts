import { useCallback, useEffect, useState } from 'react'
import type { SizingDocument } from '@/api/sizing'
import type { WorkspaceApi } from '@/api/workspace'

/**
 * The sizing document, loaded once when the Plays page mounts. A failed load leaves it null, so the
 * suggestions that need it stay hidden and the editor works as before. `updateRisk` saves the risk
 * setting and takes the document the server returns; it rejects so the caller can show why.
 */
export function useSizing(api: WorkspaceApi) {
  const [sizing, setSizing] = useState<SizingDocument | null>(null)
  useEffect(() => {
    const controller = new AbortController()
    // Older API stubs may lack the endpoint; treat that like a failed load.
    Promise.resolve().then(() => api.sizing(controller.signal))
      .then(document => { if (!controller.signal.aborted) setSizing(document) })
      .catch(() => { /* Suggestions that need the record stay hidden. */ })
    return () => controller.abort()
  }, [api])
  const updateRisk = useCallback(async (riskPercent: string) => {
    setSizing(await api.updateSizingSettings({ riskPercent }))
  }, [api])
  return { sizing, updateRisk }
}
