import { ConnectionGate } from '@/features/connection/ConnectionGate'
import { ApplicationShell } from '@/features/workspace/ApplicationShell'

export function WorkspacePage() {
  return <ConnectionGate>{(system, disconnect, api) => <ApplicationShell system={system} disconnect={disconnect} api={api} />}</ConnectionGate>
}
