import { useMemo, useRef, useState, type ComponentProps, type CSSProperties, type ReactNode, type RefObject } from 'react'
import { Camera, ChartNoAxesCombined, Maximize2, RefreshCw, Trash2 } from 'lucide-react'
import type { CandleInterval, WorkspaceApi } from '@/api/workspace'
import { CandleChart } from '@/components/chart/CandleChart'
import { ChartHeader, type ChartStat } from '@/components/chart/ChartHeader'
import { ChartIconButton, ChartMenu, ChartToolbar, ChartToolbarDivider } from '@/components/chart/ChartToolbar'
import { ChartToolRail } from '@/components/chart/ChartToolRail'
import type { ChartDrawing } from '@/components/chart/drawings'
import { drawingToolLabels, drawingTools, drawingUtilityIcons, isDrawingKind } from '@/components/chart/drawingTools'
import { intervalName } from '@/components/chart/intervals'
import { TimeframeBar } from '@/components/chart/TimeframeBar'
import type { ChartAdapterFactory, PriceOverlay } from '@/components/chart/types'
import { useDrawingEditor } from '@/components/chart/useDrawingEditor'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { useChartPreferences } from '@/features/market/chartPreferences'
import { useCandles } from '@/features/market/useCandles'
import { describeMarket, useMarketContext } from '@/features/market/useMarketContext'
import type { DraftEntry, PlayDraft } from './draft'
import { applyLevelDrag, averageEntryPrice, formatDraggedPrice, parseOverlayId, planOverlays, type ChartView } from './levels'

export interface ChartSource {
  api: WorkspaceApi
  accountId: string
}

interface ChartPanelProps {
  entries: DraftEntry[]
  selectedId: string
  onSelect: (id: string) => void
  instrument: string
  venue?: string | null
  direction?: PlayDraft['direction']
  /** Venue market data for the chosen account; null keeps the placeholder (manual or unsupported). */
  source?: ChartSource | null
  onEntriesChange?: (entries: DraftEntry[]) => void
  /** Drawings for the current instrument; the caller keeps them per instrument. */
  drawings?: readonly ChartDrawing[] | undefined
  onDrawingsChange?: (drawings: ChartDrawing[]) => void
  createAdapter?: ChartAdapterFactory
}

const noDrawings: readonly ChartDrawing[] = []
const creationHints: Record<string, string> = {
  'trend-line': 'Drag, or click twice, to draw a trend line.',
  'horizontal-line': 'Click to place a horizontal line.',
  zone: 'Drag, or click twice, to mark a zone.',
  fibonacci: 'Drag from the swing start to the swing end.',
  position: 'Click the entry, then drag to the target. The stop mirrors it at 1R.',
  text: 'Click to place a note, then edit its text.',
}

const timeFormat = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'UTC', hour12: false })
const captureReason = 'Captures arrive with evidence storage'

export function ChartPanel({ entries, selectedId, onSelect, instrument, venue = null, direction = 'long', source = null, onEntriesChange, drawings = noDrawings, onDrawingsChange, createAdapter }: ChartPanelProps) {
  const [view, setView] = useState<ChartView>('aggregate')
  const [preferences, setPreferences] = useChartPreferences()
  const editor = useDrawingEditor(drawings, next => onDrawingsChange?.(next), `${source?.accountId ?? ''}|${instrument}`)
  const interval = preferences.interval
  const [expanded, setExpanded] = useState(false)
  const expandButton = useRef<HTMLButtonElement>(null)
  const live = source !== null && instrument !== ''
  const overlays = useMemo(() => planOverlays(entries, selectedId, view, direction), [entries, selectedId, view, direction])
  const average = view === 'aggregate' ? averageEntryPrice(entries) : null

  const viewMenu = <ChartMenu label="Chart view" value={view === 'aggregate' ? 'aggregate' : selectedId} onChange={value => {
    if (value === 'aggregate') setView('aggregate')
    else { setView('selected'); onSelect(value) }
  }} options={[{ value: 'aggregate', label: 'Aggregate · All entries' },
    ...entries.map(entry => ({ value: entry.id, label: entry.name, swatch: entry.color }))]} />
  const rail = <ChartToolRail tools={drawingTools} active={editor.tool ?? 'crosshair'} onSelect={id => {
    if (id === 'magnet') setPreferences({ magnet: !preferences.magnet })
    else if (id === 'undo') editor.undo()
    else if (id === 'clear') editor.clear()
    else editor.setTool(isDrawingKind(id) ? id : null)
  }} footer={[
    { id: 'magnet', label: 'Snap to candles', icon: drawingUtilityIcons.magnet, available: true, pressed: preferences.magnet },
    { id: 'undo', label: 'Undo drawing change', icon: drawingUtilityIcons.undo, available: editor.canUndo, pressed: false },
    { id: 'clear', label: `Clear ${instrument} drawings`, icon: drawingUtilityIcons.clear, available: drawings.length > 0, pressed: false },
  ]} unavailableReason="Nothing to change" />
  const drawingBar = editor.tool ? <div className="chart-drawing-bar" role="status">{creationHints[editor.tool]} Esc cancels.</div>
    : editor.selected ? <div className="chart-drawing-bar" role="group" aria-label="Selected drawing">
      <span>{drawingToolLabels[editor.selected.kind]}</span>
      {editor.selected.kind === 'text' && <input aria-label="Note text" value={editor.selected.text ?? ''} maxLength={200}
        onFocus={editor.beginTextEdit} onChange={event => editor.setText(editor.selected!.id, event.target.value)} />}
      <ChartIconButton label="Delete drawing" icon={<Trash2 size={14} aria-hidden="true" />} onClick={editor.remove} />
    </div> : null
  const drawingProps = {
    drawings, selectedDrawingId: editor.selectedId, tool: editor.tool, magnet: preferences.magnet,
    onDrawingCreate: editor.create, onDrawingChange: editor.change, onDrawingSelect: editor.select, onKeyDown: editor.onKeyDown,
  }
  const venuePrefix = venue ? `${venue} · ` : ''

  return <section className="panel chart-panel" aria-label="Chart" data-testid="chart-panel">
    {live ? <LiveChart key={`${source.accountId}|${instrument}`} source={source} instrument={instrument} interval={interval}
      caption={`${venuePrefix}${intervalName(interval)} trade candles · UTC`}
      timeframes={<TimeframeBar value={interval} favorites={preferences.favorites}
        onChange={next => setPreferences({ interval: next })} onFavoritesChange={favorites => setPreferences({ favorites })} />}
      viewMenu={viewMenu} rail={rail} drawingBar={drawingBar} drawingProps={drawingProps} overlays={overlays} entries={entries} direction={direction} onSelect={onSelect}
      onEntriesChange={onEntriesChange} createAdapter={createAdapter} expanded={expanded} expandButton={expandButton}
      onExpandedChange={setExpanded} onDialogClosed={() => expandButton.current?.focus({ preventScroll: true })} />
      : <>
        <ChartHeader symbol={instrument} caption={instrument ? `${venuePrefix}No market data provider` : 'No perpetual instrument selected'} />
        <ChartToolbar label="Chart controls" end={<>
          <ChartIconButton label="Capture chart" icon={<Camera size={15} aria-hidden="true" />} disabled disabledReason={captureReason} />
          <ChartIconButton label="Expand chart" icon={<Maximize2 size={15} aria-hidden="true" />} disabled disabledReason="Needs market data" />
        </>} />
        <div className="chart-placeholder">
          <span className="chart-placeholder-icon" aria-hidden="true"><ChartNoAxesCombined size={27} /></span>
          <strong>{instrument ? 'No market data for this instrument' : 'Choose an instrument'}</strong>
          <p>{instrument ? 'Manual accounts and labels have no candle provider yet. Planned levels stay in the editor.' : 'Select a Hyperliquid account and perpetual to load candles.'}</p>
          <p>No candles, live prices or execution observations are shown.</p>
        </div>
      </>}
    <div className="chart-legend" role="group" aria-label="Planned entries">
      {entries.map((entry) => <button key={entry.id} type="button" aria-pressed={entry.id === selectedId}
        style={{ '--entry-color': entry.color } as CSSProperties} onClick={() => onSelect(entry.id)}>
        <i aria-hidden="true" /><span>{entry.name}</span>
        <small>{entry.share ? `${entry.share}% of quantity` : 'Share not set'}</small>
      </button>)}
      {average !== null && <span className="chart-legend-average"><i aria-hidden="true" />Average entry <strong>{formatDraggedPrice(average)}</strong></span>}
      {entries.length === 0 && <p className="muted">No planned entries.</p>}
    </div>
    <p className="chart-caption">{view === 'aggregate' ? 'Aggregate planned entries. Selecting an entry focuses its editor and keeps the other entries visible. The average is quantity-weighted over entries with a price and share.' : 'Selected entry only.'} {live ? 'Drag the selected entry’s levels or edit them in the editor.' : ''} Planned levels are not fills.</p>
  </section>
}

function LiveChart({ source, instrument, interval, caption, timeframes, viewMenu, rail, drawingBar, drawingProps, overlays, entries, direction, onSelect, onEntriesChange, createAdapter, expanded, expandButton, onExpandedChange, onDialogClosed }: {
  source: ChartSource
  instrument: string
  interval: CandleInterval
  caption: string
  timeframes: ReactNode
  viewMenu: ReactNode
  rail: ReactNode
  drawingBar: ReactNode
  drawingProps: Partial<ComponentProps<typeof CandleChart>>
  overlays: PriceOverlay[]
  entries: DraftEntry[]
  direction: PlayDraft['direction']
  onSelect: (id: string) => void
  onEntriesChange?: ((entries: DraftEntry[]) => void) | undefined
  createAdapter?: ChartAdapterFactory | undefined
  expanded: boolean
  expandButton: RefObject<HTMLButtonElement | null>
  onExpandedChange: (open: boolean) => void
  onDialogClosed: () => void
}) {
  const data = useCandles({ ...source, instrument, interval })
  const market = useMarketContext(source.api, source.accountId, instrument)
  const refresh = () => { data.refresh(); market.refresh() }
  const described = market.context ? describeMarket(market.context) : null
  const stats: ChartStat[] = [
    { label: 'Mark', value: market.context?.markPrice ?? '—' },
    { label: 'Oracle', value: market.context?.oraclePrice ?? '—' },
    { label: '24h change', value: described?.change ?? '—', ...(described && described.direction !== 'flat' ? { tone: described.direction } : {}) },
    { label: '24h volume', hint: 'notional', value: described?.volume ?? '—' },
    { label: 'Open interest', value: described ? `${described.openInterest} ${instrument}` : '—' },
    { label: 'Funding', hint: '1h', value: described?.funding ?? '—' },
  ]
  const header = <ChartHeader symbol={instrument} caption={caption} stats={stats} statsLabel={`${instrument} market statistics`}
    notice={market.error && <p className="chart-header-error" role="alert">{market.error}</p>} />
  const status = data.status === 'loading' ? 'Loading candles…'
    : data.refreshing ? 'Refreshing…'
      : data.loadingOlder ? 'Loading older candles…'
        : data.retrievedAt ? `Updated ${timeFormat.format(new Date(data.retrievedAt))} UTC` : ''
  const toolbar = (inDialog: boolean) => <ChartToolbar label="Chart controls" end={<>
    <span className="chart-status" role="status">{status}</span>
    <ChartIconButton label="Refresh" icon={<RefreshCw size={15} aria-hidden="true" className={data.refreshing ? 'is-spinning' : ''} />}
      onClick={refresh} disabled={data.status === 'loading' || data.refreshing} aria-busy={data.refreshing} />
    <ChartToolbarDivider />
    <ChartIconButton label="Capture chart" icon={<Camera size={15} aria-hidden="true" />} disabled disabledReason={captureReason} />
    {!inDialog && <ChartIconButton ref={expandButton} label="Expand chart" icon={<Maximize2 size={15} aria-hidden="true" />} onClick={() => onExpandedChange(true)} />}
  </>}>
    {timeframes}
    <ChartToolbarDivider />
    {viewMenu}
  </ChartToolbar>
  const chartProps = {
    candles: data.candles, overlays, viewKey: `${instrument}|${interval}`,
    label: `${instrument} ${intervalName(interval)} trade candles with planned levels. Edit levels in the entry editor.`,
    onLevelSelect: (id: string) => { const ref = parseOverlayId(id); if (ref) onSelect(ref.entryId) },
    onLevelDrag: (id: string, price: number) => onEntriesChange?.(applyLevelDrag(entries, id, price, direction)),
    onNeedOlder: data.loadOlder,
    ...drawingProps,
    ...(createAdapter ? { createAdapter } : {}),
  }
  const stage = (testId: string) => <div className="chart-stage">
    {rail}
    <div className="chart-body" data-testid={testId}>
      <CandleChart {...chartProps} />
      {drawingBar}
      {data.status === 'loading' && <p className="chart-state">Loading {instrument} candles…</p>}
      {data.status === 'error' && <div className="chart-state" role="alert"><p>{data.error}</p><Button type="button" size="sm" variant="outline" onClick={data.refresh}>Try again</Button></div>}
      {data.status === 'ready' && !data.candles.length && <p className="chart-state">The venue returned no candles for this window.</p>}
    </div>
  </div>
  const notices = <>
    {data.status === 'ready' && data.error && <p className="chart-notice" role="alert">Refresh failed: {data.error} Showing the previous candles.</p>}
    {data.olderError && <p className="chart-notice" role="alert">Older candles failed to load. <button type="button" onClick={data.retryOlder}>Retry</button></p>}
    {data.historyExhausted && data.candles.length > 0 && <p className="chart-notice">Start of available venue history. {data.notice}</p>}
  </>

  return <>
    {expanded ? <div className="chart-body chart-body-parked"><p className="chart-state">Chart open in the expanded view.</p></div>
      : <>{header}{toolbar(false)}{stage('chart-body')}{notices}</>}
    <Dialog open={expanded} onOpenChange={onExpandedChange}>
      <DialogContent className="chart-dialog plays-chart-dialog" onCloseAutoFocus={event => { event.preventDefault(); onDialogClosed() }}>
        <DialogTitle className="sr-only">{instrument} chart</DialogTitle>
        <DialogDescription className="sr-only">The same candles, planned levels and selection. Escape returns to the workspace.</DialogDescription>
        {header}
        {toolbar(true)}
        {stage('chart-dialog-body')}
        {notices}
      </DialogContent>
    </Dialog>
  </>
}
