import type { SystemInfo } from '@/api/system'
import { Button } from '@/components/ui/button'
import { VenueBadge } from '@/components/venues/VenueBadge'
import { AppearanceSettings, CurrentThemeName } from '@/features/settings/AppearanceSettings'
import { showAppearanceSection } from '@/features/settings/appearance'
import { Database, LogOut, ShieldCheck } from 'lucide-react'

export function SettingsPage({ system, disconnectSession, onAccounts }: {
  system: SystemInfo; disconnectSession: () => void; onAccounts: () => void
}) {
  return <div className="settings-grid">
    <AppearanceSettings />
    <section className="shell-panel settings-panel">
      <ShieldCheck size={23} /><h2>Private session</h2>
      <p>Connected as {system.owner.displayName}.</p>
      <dl>
        <div><dt>Orders and signing</dt><dd>Not enabled</dd></div>
        <div><dt>Theme</dt><dd className="settings-theme"><CurrentThemeName /><Button variant="outline" size="sm" onClick={() => showAppearanceSection('theme-customizer')}>Customize</Button></dd></div>
      </dl>
      <Button variant="outline" onClick={disconnectSession}><LogOut size={15} />Disconnect session</Button>
    </section>
    <section className="shell-panel settings-panel">
      <Database size={23} /><h2>Venue capabilities</h2>
      <div className="venue-capability-list">{system.venues.map(venue => <div key={venue.id}>
        <VenueBadge venueId={venue.id} /><span className="workspace-badge">import {venue.capabilities.sync ? 'available' : 'unavailable'} · orders {venue.capabilities.orders ? 'read-only' : 'unavailable'}</span>
      </div>)}</div>
      <Button variant="outline" onClick={onAccounts}>Manage account access and refresh</Button>
    </section>
  </div>
}
