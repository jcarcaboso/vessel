import { useRef, useState, type CSSProperties } from 'react'
import type { SystemInfo } from '@/api/system'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { SampleChart } from '@/components/chart/SampleChart'
import { EntryForm } from './EntryForm'
import { sampleChart, samplePlay, type SampleEntry } from './sample'

export function PlayWorkspace({ system, disconnect }: { system: SystemInfo; disconnect: () => void }) {
  const [entries, setEntries] = useState(samplePlay.entries)
  const [selectedId, setSelectedId] = useState(samplePlay.entries[0]!.id)
  const [expanded, setExpanded] = useState(false)
  const [notes, setNotes] = useState({ thesis: '', invalidation: '', strategy: '', evidence: '', review: '' })
  const sidebar = useRef<HTMLDivElement>(null)
  const entryButtons = useRef(new Map<string, HTMLButtonElement>())
  const selected = entries.find((entry) => entry.id === selectedId)!

  function selectEntry(id: string) {
    setSelectedId(id)
    const button = entryButtons.current.get(id)
    const container = sidebar.current
    if (button && container && !expanded) {
      const offset = button.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop
      container.scrollTo({ top: Math.max(0, offset - 12), behavior: 'auto' })
      button.focus({ preventScroll: true })
    }
  }

  function updateEntry(next: SampleEntry) {
    setEntries((current) => current.map((entry) => entry.id === next.id ? next : entry))
  }

  return <main className="app-shell">
    <header className="topbar">
      <span className="wordmark">VESSEL</span><span className="muted">Trading diary / foundation</span>
      <Button variant="outline" size="sm" onClick={disconnect}>Disconnect</Button>
    </header>
    <div className="page-heading">
      <div><p className="eyebrow">SAMPLE PLAY · PERPETUALS</p><h1>{samplePlay.title}</h1></div>
      <span className="badge">Graphite</span>
    </div>
    <p className="sample-notice" role="status">API verified for {system.owner.displayName}. Workspace data is sample only. Nothing is saved or broker-connected.</p>
    <section className="panel capital-context" aria-labelledby="capital-title" data-testid="capital-context">
      <div><h2 id="capital-title">Capital context</h2><p>Sample account · Hyperliquid perpetuals</p></div>
      <dl><div><dt>Account value</dt><dd>Unavailable</dd></div><div><dt>Portfolio value</dt><dd>Unavailable</dd></div><div><dt>Available budget</dt><dd>Unavailable</dd></div></dl>
    </section>
    <div className="workspace" data-testid="workspace">
      <div className="left-column" data-testid="left-column">
        <SampleChart data={sampleChart} selectedId={selectedId} onSelect={selectEntry}
          overlays={entries.map((entry) => ({ id: entry.id, label: entry.name, price: entry.price.trim() ? Number(entry.price) : NaN, color: entry.color, kind: 'entry' }))} />
        <section className="panel journal-panel" aria-labelledby="journal-title" data-testid="journal-panel">
          <header className="panel-heading"><h2 id="journal-title">Journal</h2><span className="muted">Unsaved sample notes</span></header>
          <Tabs defaultValue="thesis" className="journal-tabs">
            <TabsList className="journal-tab-list h-auto!">
              {Object.keys(notes).map((key) => <TabsTrigger key={key} value={key}>{key[0]!.toUpperCase() + key.slice(1)}</TabsTrigger>)}
            </TabsList>
            {Object.entries(notes).map(([key, value]) => <TabsContent key={key} value={key} className="journal-tab-content">
              <label htmlFor={`note-${key}`}>{key[0]!.toUpperCase() + key.slice(1)}</label>
              <textarea id={`note-${key}`} value={value} placeholder={key === 'review' ? 'Reflection after the trade, separate from the original thesis.' : `Add sample ${key} notes…`}
                onChange={(event) => setNotes((current) => ({ ...current, [key]: event.target.value }))} />
            </TabsContent>)}
          </Tabs>
        </section>
      </div>
      <section className="panel position-panel" aria-labelledby="position-title" data-testid="position-panel">
        <header className="panel-heading"><h2 id="position-title">Position editor</h2><span className="badge">Sample</span></header>
        <div className="position-context"><p>Whole-position sizing</p><dl><div><dt>Margin / quantity</dt><dd>Not specified</dd></div><div><dt>Leverage</dt><dd>Not specified</dd></div></dl><p className="muted">Sizing and payoff calculations are deferred.</p></div>
        <label className="entry-picker">Selected entry
          <select value={selectedId} onChange={(event) => selectEntry(event.target.value)}>
            {entries.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
          </select>
        </label>
        <div ref={sidebar} className="entry-sidebar" data-testid="entry-sidebar" tabIndex={0} aria-label="Bounded entry editor">
          {entries.map((entry) => <article key={entry.id} className="entry-card" data-selected={selectedId === entry.id}
            style={{ '--entry-color': entry.color } as CSSProperties} aria-label={`${entry.name} editor`}>
            <button type="button" className="entry-header" aria-pressed={selectedId === entry.id}
              ref={(node) => { if (node) entryButtons.current.set(entry.id, node); else entryButtons.current.delete(entry.id) }}
              onClick={() => selectEntry(entry.id)}>{entry.name}<span>{entry.share || '0'}% of quantity</span></button>
            {expanded && selectedId === entry.id ? <p className="muted expanded-placeholder">Editing in the expanded dialog.</p> : <EntryForm entry={entry} onChange={updateEntry} />}
          </article>)}
        </div>
        <Dialog open={expanded} onOpenChange={setExpanded}>
          <DialogTrigger asChild><Button variant="outline" className="expand-entry">Expand selected entry</Button></DialogTrigger>
          <DialogContent className="entry-dialog">
            <DialogHeader><DialogTitle>Expanded entry editor</DialogTitle><DialogDescription>Same sample entry, same unsaved values. Escape returns to the sidebar.</DialogDescription></DialogHeader>
            <label>Entry<select value={selectedId} onChange={(event) => selectEntry(event.target.value)}>
              {entries.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
            </select></label>
            <EntryForm entry={selected} onChange={updateEntry} />
          </DialogContent>
        </Dialog>
      </section>
    </div>
    <section className="panel summary" aria-labelledby="summary-title" data-testid="summary-panel">
      <div><h2 id="summary-title">Full-position summary</h2><p>Sample plan · not an execution or realized return</p></div>
      <dl>{['Size', 'Margin', 'Exposure', 'Average entry', 'Leverage', 'All-stops loss', 'All-targets profit'].map((label) => <div key={label}><dt>{label}</dt><dd>Not calculated</dd></div>)}</dl>
    </section>
    <footer className="venue-status"><span>API venue capabilities:</span> {system.venues.map((venue) => <span key={venue.id}>{venue.name} · {venue.status}</span>)}</footer>
  </main>
}
