import { useEffect, useRef, useState } from 'react'
import type { BrokerAccount, WorkspaceApi } from '@/api/workspace'
import { errorMessage } from '@/api/errors'
import type { NotificationInput } from '@/components/notifications/notifications'

export function useAccountRefresh({ api, refreshable, reload, notify }: {
  api: WorkspaceApi; refreshable: BrokerAccount[]; reload: () => void; notify: (input: NotificationInput) => string
}) {
  const sessionRef = useRef<{ api: WorkspaceApi; controller: AbortController; busy: boolean } | null>(null)
  const [state, setState] = useState<{
    api: WorkspaceApi; accountId: string; progress: { current: number; total: number } | null
  } | null>(null)
  useEffect(() => {
    const controller = new AbortController()
    sessionRef.current = { api, controller, busy: false }
    return () => controller.abort()
  }, [api])
  const cancel = () => sessionRef.current?.controller.abort()

  async function run(accounts: Pick<BrokerAccount, 'id' | 'name'>[], batch: boolean) {
    const session = sessionRef.current
    if (!session || session.api !== api || session.busy || session.controller.signal.aborted || !accounts.length) return
    session.busy = true
    const { signal } = session.controller
    const current = () => !signal.aborted && sessionRef.current === session
    const failures: string[] = []
    try {
      for (const [index, account] of accounts.entries()) {
        if (!current()) return
        setState({ api, accountId: account.id, progress: batch ? { current: index + 1, total: accounts.length } : null })
        try { await api.sync(account.id, signal) }
        catch (cause) {
          if (!current()) return
          failures.push(account.name)
          if (!batch) notify({ tone: 'error', key: 'account-refresh', message: errorMessage(cause, 'The venue refresh did not complete.') })
        }
      }
      if (current()) {
        if (batch) notify({ tone: failures.length ? 'error' : 'success', key: 'account-refresh',
          message: `${accounts.length - failures.length} of ${accounts.length} accounts refreshed.${failures.length ? ` Failed: ${failures.join(', ')}.` : ''}` })
        else if (!failures.length) notify({ tone: 'success', message: 'Account refreshed. Recent execution facts remain unassigned to plays.' })
      }
    } finally {
      session.busy = false
      if (current()) { setState(null); reload() }
    }
  }
  return {
    refreshing: state?.api === api ? state.accountId : null,
    refreshProgress: state?.api === api ? state.progress : null,
    sync: (id: string) => run([{ id, name: '' }], false),
    refreshAll: () => run(refreshable, true),
    cancel,
  }
}
