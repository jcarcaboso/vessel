import type { WorkspaceApi } from './workspace'

/**
 * What a client tells the rest of the session, so caches can drop data without the client knowing them.
 * `unauthorized`: a request was answered 401 or 403. `account-removed`: an account was deleted or disabled.
 */
export type ApiEvent = { type: 'unauthorized' } | { type: 'account-removed'; accountId: string }
type Listener = (event: ApiEvent) => void

const listeners = new WeakMap<WorkspaceApi, Set<Listener>>()

/** Listens to one client's events until the returned function is called or the client is dropped. */
export function onApiEvent(api: WorkspaceApi, listener: Listener): () => void {
  let set = listeners.get(api)
  if (!set) { set = new Set(); listeners.set(api, set) }
  set.add(listener)
  return () => { set.delete(listener) }
}

/** Only `createWorkspaceApi` emits, for the client it created. */
export function emitApiEvent(api: WorkspaceApi, event: ApiEvent) {
  for (const listener of [...listeners.get(api) ?? []]) listener(event)
}
