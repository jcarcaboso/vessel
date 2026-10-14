import type { SystemInfo } from '@/api/system'
import { useVenues } from '@/api/venues'
import { Button } from '@/components/ui/button'
import { AppearanceSettings, CurrentThemeName } from '@/features/settings/AppearanceSettings'
import { showAppearanceSection } from '@/features/settings/appearance'
import { Database, LogOut, ShieldCheck } from 'lucide-react'

export function SettingsPage({ system, disconnectSession, onAccounts }: {
  system: SystemInfo; disconnectSession: () => void; onAccounts: () => void
}) {
  const venues = useVenues()
  return <div className="settings-grid">
    <AppearanceSettings />
    <section className="shell-panel settings-panel">
      <ShieldCheck size={23} /><h2>Private session</h2>
      <p>Connected as {system.owner.displayName}. The token lives only in this browser session's memory and is released on disconnect.</p>
      <dl>
        <div><dt>Authentication</dt><dd>Bearer token</dd></div>
        <div><dt>Market scope</dt><dd>Perpetuals only</dd></div>
        <div><dt>Orders and signing</dt><dd>Not enabled</dd></div>
        <div><dt>Theme</dt><dd className="settings-theme"><CurrentThemeName /><Button variant="outline" size="sm" onClick={() => showAppearanceSection('theme-customizer')}>Customize</Button></dd></div>
      </dl>
      <Button variant="outline" onClick={disconnectSession}><LogOut size={15} />Disconnect session</Button>
    </section>
    <section className="shell-panel settings-panel">
      <Database size={23} /><h2>Venue capabilities</h2>
      <p>Accounts can be added at {venues.creatable().map(venue => venue.name).join(', ')}. A refresh is explicitly requested, not a background job.</p>
      <div className="venue-capability-list">{system.venues.map(venue => <div key={venue.id}>
        <span>{venue.name}</span><span className="workspace-badge">import {venue.capabilities.sync ? 'available' : 'unavailable'} · orders {venue.capabilities.orders ? 'read-only' : 'unavailable'}</span>
      </div>)}</div>
      <p className="field-help">Some venues require a verified read-only token for order reads. Manage it on the account. No trading keys or orders are sent; retained imports are not complete lifetime history.</p>
      <Button variant="outline" onClick={onAccounts}>Manage account access and refresh</Button>
    </section>
  </div>
}
