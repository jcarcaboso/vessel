import { useCallback, useEffect, useRef, useState } from 'react'
import type { SizingDocument } from '@/api/sizing'
import type { WorkspaceApi } from '@/api/workspace'

/**
 * The sizing document, loaded when the Plays page is first shown and after each accepted stored-state reload. A failed load leaves it null, so the
 * suggestions that need it stay hidden and the editor works as before. `updateRisk` saves the risk
 * setting and takes the document the server returns; it rejects so the caller can show why.
 */
export function useSizing(api: WorkspaceApi, generation = 0, enabled = true) {
  const [sizing, setSizing] = useState<SizingDocument | null>(null)
  // A hidden page neither reads nor rereads; it catches up once with the latest generation when shown.
  const loaded = useRef<{ api: WorkspaceApi; generation: number } | null>(null)
  useEffect(() => {
    if (!enabled || loaded.current?.api === api && loaded.current.generation === generation) return
    const controller = new AbortController()
    // Older API stubs may lack the endpoint; treat that like a failed load.
    Promise.resolve().then(() => api.sizing(controller.signal))
      .then(document => { if (!controller.signal.aborted) { loaded.current = { api, generation }; setSizing(document) } })
      .catch(() => { /* Suggestions that need the record stay hidden. */ })
    return () => controller.abort()
  }, [api, generation, enabled])
  const updateRisk = useCallback(async (riskPercent: string) => {
    setSizing(await api.updateSizingSettings({ riskPercent }))
  }, [api])
  return { sizing, updateRisk }
}
