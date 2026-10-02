import { useEffect, useMemo, useRef, useState, type ComponentProps, type CSSProperties, type KeyboardEvent, type ReactNode, type RefObject } from 'react'
import { Camera, ChartNoAxesCombined, Maximize2, RefreshCw } from 'lucide-react'
import type { CandleInterval, WorkspaceApi } from '@/api/workspace'
import { CandleChart } from '@/components/chart/CandleChart'
import { ChartHeader, type ChartStat } from '@/components/chart/ChartHeader'
import { ChartIconButton, ChartMenu, ChartToolbar, ChartToolbarDivider } from '@/components/chart/ChartToolbar'
import { ChartToolRail } from '@/components/chart/ChartToolRail'
import { drawingColors, type ChartDrawing } from '@/components/chart/drawings'
import { DrawingEditBar } from '@/components/chart/DrawingEditBar'
import { drawingToolLabels, drawingTools, drawingUtilityIcons, isDrawingKind } from '@/components/chart/drawingTools'
import { intervalName } from '@/components/chart/intervals'
import { LiveIndicator } from '@/components/chart/LiveIndicator'
import { TimeframeBar } from '@/components/chart/TimeframeBar'
import type { ChartAdapterFactory, PriceOverlay } from '@/components/chart/types'
import { useChartHistory } from '@/components/chart/useChartHistory'
import { useDrawingEditor } from '@/components/chart/useDrawingEditor'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { useChartPreferences } from '@/features/market/chartPreferences'
import { useCandles } from '@/features/market/useCandles'
import { useLiveMarket } from '@/features/market/useLiveMarket'
import { describeMarket, useMarketContext } from '@/features/market/useMarketContext'
import type { DraftEntry, PlayDraft } from './draft'
import { LevelEditor } from './LevelEditor'
import { applyEntryEdit, applyLevelDrag, averageEntryPrice, formatDraggedPrice, parseOverlayId, planOverlays, type ChartView } from './levels'

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
  const scopeKey = `${source?.accountId ?? ''}|${instrument}`
  const history = useChartHistory(scopeKey)
  const editor = useDrawingEditor(drawings, next => onDrawingsChange?.(next), scopeKey, history)
  const [levelEdit, setLevelEdit] = useState<{ id: string; anchor: { x: number; y: number } } | null>(null)
  // History actions and drag gestures read the latest entries, not the ones captured when they started.
  const latest = useRef({ entries, onEntriesChange })
  useEffect(() => { latest.current = { entries, onEntriesChange } })
  const dragStart = useRef<DraftEntry | null>(null)

  /** Records an entry edit made on the chart so undo/redo reverts only the fields it changed. */
  const recordEntryEdit = (label: string, before: DraftEntry, after: DraftEntry) => {
    const apply = (from: DraftEntry, to: DraftEntry) => latest.current.onEntriesChange?.(latest.current.entries.map(entry =>
      entry.id === before.id ? applyEntryEdit(entry, from, to) : entry))
    history.push({ label, undo: () => apply(after, before), redo: () => apply(before, after) })
  }
  const applyEntry = (next: DraftEntry, label: string) => {
    const before = entries.find(entry => entry.id === next.id)
    if (!before) return
    recordEntryEdit(label, before, next)
    onEntriesChange?.(entries.map(entry => entry.id === next.id ? next : entry))
  }
  const levelProps = {
    onLevelSelect: (id: string) => { const ref = parseOverlayId(id); if (ref) onSelect(ref.entryId) },
    onLevelDrag: (id: string, price: number, phase: 'move' | 'end') => {
      const ref = parseOverlayId(id)
      const current = latest.current.entries
      const entry = ref && current.find(item => item.id === ref.entryId)
      if (!ref || !entry) return
      dragStart.current ??= entry
      const next = applyLevelDrag(current, id, price, direction)
      onEntriesChange?.(next)
      if (phase === 'end') {
        const after = next.find(item => item.id === ref.entryId)!
        recordEntryEdit(`Move ${entry.name} level`, dragStart.current, after)
        dragStart.current = null
        if (ref.entryId !== selectedId) onSelect(ref.entryId)
      }
    },
    onLevelEdit: (id: string, anchor: { x: number; y: number }) => {
      const ref = parseOverlayId(id)
      if (!ref) return
      setLevelEdit({ id, anchor })
      if (ref.entryId !== selectedId) onSelect(ref.entryId)
    },
  }
  const onChartKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const key = event.key.toLowerCase()
    if ((event.metaKey || event.ctrlKey) && (key === 'y' || key === 'z' && event.shiftKey)) { event.preventDefault(); history.redo() }
    else if ((event.metaKey || event.ctrlKey) && key === 'z') { event.preventDefault(); history.undo() }
    else editor.onKeyDown(event)
  }
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
    else if (id === 'undo') history.undo()
    else if (id === 'redo') history.redo()
    else if (id === 'clear') editor.clear()
    else editor.setTool(isDrawingKind(id) ? id : null)
  }} footer={[
    { id: 'magnet', label: 'Snap to candles', icon: drawingUtilityIcons.magnet, available: true, pressed: preferences.magnet },
    { id: 'undo', label: history.undoLabel ? `Undo: ${history.undoLabel}` : 'Undo', icon: drawingUtilityIcons.undo, available: history.canUndo, pressed: false },
    { id: 'redo', label: history.redoLabel ? `Redo: ${history.redoLabel}` : 'Redo', icon: drawingUtilityIcons.redo, available: history.canRedo, pressed: false },
    { id: 'clear', label: `Clear unlocked ${instrument} drawings`, icon: drawingUtilityIcons.clear, available: editor.clearable, pressed: false },
  ]} unavailableReason="Nothing to change" />
  const drawingBar = editor.tool ? <div className="chart-drawing-bar" role="status">{creationHints[editor.tool]} Esc cancels.</div>
    : editor.selected ? <DrawingEditBar drawing={editor.selected} label={drawingToolLabels[editor.selected.kind]} defaultColor={drawingColors[0]}
      onStyle={style => editor.setStyle(editor.selected!.id, style)} onLocked={locked => editor.setLocked(editor.selected!.id, locked)}
      onDelete={editor.remove} onText={text => editor.setText(editor.selected!.id, text)} onTextFocus={editor.beginTextEdit} onTextBlur={editor.endTextEdit} /> : null
  const editedRef = levelEdit ? parseOverlayId(levelEdit.id) : null
  const editedIndex = editedRef ? entries.findIndex(entry => entry.id === editedRef.entryId) : -1
  const levelEditor = levelEdit && editedIndex >= 0 ? <LevelEditor key={levelEdit.id} entry={entries[editedIndex]!} entryIndex={editedIndex}
    overlayId={levelEdit.id} anchor={levelEdit.anchor} direction={direction} onApply={applyEntry}
    onClose={() => setLevelEdit(null)} /> : null
  const drawingProps = {
    drawings, selectedDrawingId: editor.selectedId, tool: editor.tool, magnet: preferences.magnet,
    onDrawingCreate: editor.create, onDrawingChange: editor.change, onDrawingSelect: editor.select, onKeyDown: onChartKeyDown,
    ...levelProps,
  }

  return <section className="panel chart-panel" aria-label="Chart" data-testid="chart-panel">
    {live ? <LiveChart key={`${source.accountId}|${instrument}`} source={source} instrument={instrument} interval={interval}
      caption={`${instrument} · ${venue ? `${venue} ` : ''}trade candles`}
      timeframes={<TimeframeBar value={interval} favorites={preferences.favorites}
        onChange={next => setPreferences({ interval: next })} onFavoritesChange={favorites => setPreferences({ favorites })} />}
      liveUpdates={preferences.live} onLiveUpdatesChange={on => setPreferences({ live: on })}
      viewMenu={viewMenu} rail={rail} drawingBar={<>{drawingBar}{levelEditor}</>} drawingProps={drawingProps} overlays={overlays} createAdapter={createAdapter} expanded={expanded} expandButton={expandButton}
      onExpandedChange={setExpanded} onDialogClosed={() => expandButton.current?.focus({ preventScroll: true })} />
      : <>
        <ChartToolbar label="Chart controls" end={<>
          <span className="chart-status"><span className="chart-source">{instrument ? `${instrument} · ${venue ? `${venue} · ` : ''}no market data provider` : 'No perpetual instrument selected'}</span></span>
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

function LiveChart({ source, instrument, interval, caption, liveUpdates, onLiveUpdatesChange, timeframes, viewMenu, rail, drawingBar, drawingProps, overlays, createAdapter, expanded, expandButton, onExpandedChange, onDialogClosed }: {
  source: ChartSource
  instrument: string
  interval: CandleInterval
  caption: string
  liveUpdates: boolean
  onLiveUpdatesChange: (on: boolean) => void
  timeframes: ReactNode
  viewMenu: ReactNode
  rail: ReactNode
  drawingBar: ReactNode
  drawingProps: Partial<ComponentProps<typeof CandleChart>>
  overlays: PriceOverlay[]
  createAdapter?: ChartAdapterFactory | undefined
  expanded: boolean
  expandButton: RefObject<HTMLButtonElement | null>
  onExpandedChange: (open: boolean) => void
  onDialogClosed: () => void
}) {
  const data = useCandles({ ...source, instrument, interval })
  const market = useMarketContext(source.api, source.accountId, instrument)
  const refresh = () => { data.refresh(); market.refresh() }
  // One stream per chart; the expanded dialog renders from the same state.
  const live = useLiveMarket({
    api: source.api, accountId: source.accountId, instrument, interval, enabled: liveUpdates, ready: data.status === 'ready',
    onCandle: data.upsert, onContext: market.apply, refreshCandles: data.refresh, refreshContext: market.refresh,
  })
  const updatedAt = [data.retrievedAt, live.lastEventAt].filter((value): value is string => value !== null)
    .reduce<string | null>((latest, value) => latest === null || Date.parse(value) > Date.parse(latest) ? value : latest, null)
  const described = market.context ? describeMarket(market.context) : null
  const stats: ChartStat[] = [
    { label: 'Mark', value: market.context?.markPrice ?? '—' },
    { label: 'Oracle', value: market.context?.oraclePrice ?? '—' },
    { label: '24h change', value: described?.change ?? '—', ...(described && described.direction !== 'flat' ? { tone: described.direction } : {}) },
    { label: '24h volume', hint: 'notional', value: described?.volume ?? '—' },
    { label: 'Open interest', value: described ? `${described.openInterest} ${instrument}` : '—' },
    { label: 'Funding', hint: '1h', value: described?.funding ?? '—' },
  ]
  // The instrument is already chosen and shown in the play fields, so the header carries statistics only.
  const header = <ChartHeader stats={stats} statsLabel={`${instrument} market statistics`}
    notice={market.error && <p className="chart-header-error" role="alert">{market.error}</p>} />
  const status = data.status === 'loading' ? 'Loading candles…'
    : data.refreshing ? 'Refreshing…'
      : data.loadingOlder ? 'Loading older candles…'
        : updatedAt ? `Updated ${timeFormat.format(new Date(updatedAt))} UTC` : ''
  const toolbar = (inDialog: boolean) => <ChartToolbar label="Chart controls" end={<>
    {/* Streamed updates change the time every few seconds; only announce it when updates are manual. */}
    <span className="chart-status" role="status" aria-live={live.state === 'off' ? 'polite' : 'off'} title={`${caption}${status ? ` · ${status}` : ''}`}>
      {/* The instrument is shown in the play fields; the source stays available as a tooltip and to screen readers. */}
      <span className="chart-source sr-only">{caption} · </span>{status && <span>{status}</span>}</span>
    <LiveIndicator state={live.state} onToggle={onLiveUpdatesChange} />
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
