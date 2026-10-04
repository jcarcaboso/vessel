import { useEffect, useMemo, useRef, useState, type ComponentProps, type CSSProperties, type KeyboardEvent, type ReactNode, type RefObject } from 'react'
import { ArrowRightToLine, Camera, ChartNoAxesCombined, Maximize2, OctagonX, RefreshCw, Star, Target } from 'lucide-react'
import { Popover } from 'radix-ui'
import type { CandleInterval, WorkspaceApi } from '@/api/workspace'
import { CandleChart, type CandleChartControl } from '@/components/chart/CandleChart'
import { ChartHeader, type ChartStat } from '@/components/chart/ChartHeader'
import { ChartIconButton, ChartMenu, ChartToolbar, ChartToolbarDivider } from '@/components/chart/ChartToolbar'
import { ChartToolRail, type ChartToolGroup } from '@/components/chart/ChartToolRail'
import { drawingColors, type ChartDrawing } from '@/components/chart/drawings'
import { DrawingEditBar } from '@/components/chart/DrawingEditBar'
import { crosshairTool, drawingToolGroups, drawingToolHints, drawingToolLabels, drawingToolsByKind, drawingUtilityIcons, isDrawingKind } from '@/components/chart/drawingTools'
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
import { createNextEntry, type DraftEntry, type PlayDraft } from './draft'
import { LevelEditor } from './LevelEditor'
import { applyEntryEdit, applyLevelDrag, averageEntryPrice, formatDraggedPrice, levelTag, parseOverlayId, placeLevel, planOverlays, type ChartView, type ExitKind } from './levels'

export interface ChartSource {
  api: WorkspaceApi
  accountId: string
}

interface ChartPanelProps {
  entries: DraftEntry[]
  selectedId: string
  onSelect: (id: string) => void
  instrument: string
  /** Display name such as BTC/USDC; defaults to the contract. */
  instrumentName?: string
  venue?: string | null
  direction?: PlayDraft['direction']
  /** The play's leverage; percentage levels are returns at it. */
  leverage?: number
  /** False for read-only plays: levels can be viewed but not placed or dragged. */
  editable?: boolean
  /** Brings the Evidence tab into view after a capture. */
  onShowEvidence?: () => void
  /** Venue market data for the chosen account; null keeps the placeholder (manual or unsupported). */
  source?: ChartSource | null
  onEntriesChange?: (entries: DraftEntry[]) => void
  /** Drawings for the current instrument; the caller keeps them per instrument. */
  drawings?: readonly ChartDrawing[] | undefined
  onDrawingsChange?: (drawings: ChartDrawing[]) => void
  /** Adds a chart capture to the draft evidence; returns why it was not added, or null. */
  onCapture?: (image: Blob, context: string) => string | null
  createAdapter?: ChartAdapterFactory
}

const noDrawings: readonly ChartDrawing[] = []

type PlanTool = 'entry' | ExitKind
const planToolIcon = { size: 16, strokeWidth: 1.6, 'aria-hidden': true } as const

const timeFormat = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'UTC', hour12: false })

export function ChartPanel({ entries, selectedId, onSelect, instrument, instrumentName = instrument, venue = null, direction = 'long', leverage = 1,
  editable = true, source = null, onEntriesChange, drawings = noDrawings, onDrawingsChange, onCapture, onShowEvidence, createAdapter }: ChartPanelProps) {
  const [view, setView] = useState<ChartView>('aggregate')
  const [planTool, setPlanTool] = useState<PlanTool | null>(null)
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
      const next = applyLevelDrag(current, id, price, direction, leverage)
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
  const selectedEntry = entries.find(entry => entry.id === selectedId) ?? entries[0]
  const selectedTag = selectedEntry ? levelTag(entries, { entryId: selectedEntry.id, kind: 'entry' }) : ''
  const selectedName = entries.length > 1 && selectedEntry ? selectedEntry.name : 'the entry'
  /**
   * Places a level at a price picked on the chart, one pick per tool use. The entry tool prices the
   * selected entry when it has no price yet, and otherwise adds a new entry at that price.
   */
  const pickPrice = (price: number) => {
    const current = latest.current.entries
    const entry = current.find(item => item.id === selectedEntry?.id)
    if (!planTool || !entry) return
    setPlanTool(null)
    if (planTool === 'entry' && Number(entry.price) > 0) {
      const added = placeLevel(createNextEntry(current), 'entry', price)
      const change = (next: DraftEntry[]) => latest.current.onEntriesChange?.(next)
      change([...current, added])
      history.push({ label: `Add ${added.name}`,
        undo: () => change(latest.current.entries.filter(item => item.id !== added.id)),
        redo: () => change([...latest.current.entries.filter(item => item.id !== added.id), added]) })
      onSelect(added.id)
      return
    }
    applyEntry(placeLevel(entry, planTool, price), planTool === 'entry' ? `Set ${selectedTag} entry price` : `Add ${selectedTag} ${planTool}`)
  }
  const onChartKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const key = event.key.toLowerCase()
    if (planTool && key === 'escape') { event.preventDefault(); setPlanTool(null); return }
    if ((event.metaKey || event.ctrlKey) && (key === 'y' || key === 'z' && event.shiftKey)) { event.preventDefault(); history.redo() }
    else if ((event.metaKey || event.ctrlKey) && key === 'z') { event.preventDefault(); history.undo() }
    else editor.onKeyDown(event)
  }
  const interval = preferences.interval
  const [expanded, setExpanded] = useState(false)
  const expandButton = useRef<HTMLButtonElement>(null)
  const live = source !== null && instrument !== ''
  const overlays = useMemo(() => planOverlays(entries, selectedId, view, direction, leverage), [entries, selectedId, view, direction, leverage])
  const average = view === 'aggregate' ? averageEntryPrice(entries) : null
  const several = entries.length > 1

  // One entry is both the aggregate and the selection, so the view choice only appears with several.
  const viewMenu = several && <ChartMenu label="Chart view" value={view === 'aggregate' ? 'aggregate' : selectedId} onChange={value => {
    if (value === 'aggregate') setView('aggregate')
    else { setView('selected'); onSelect(value) }
  }} options={[{ value: 'aggregate', label: 'Aggregate · All entries' },
    ...entries.map(entry => ({ value: entry.id, label: entry.name, swatch: entry.color }))]} />
  const priced = selectedEntry !== undefined && Number(selectedEntry.price) > 0
  const planTools = editable && selectedEntry ? [
    { id: 'plan:entry', label: 'Add an entry on the chart', description: Number(selectedEntry.price) > 0 ? 'Click the chart at the price of a new entry.' : `Click the chart at ${selectedName} price.`, icon: <ArrowRightToLine {...planToolIcon} />, available: true },
    { id: 'plan:stop', label: `Add a stop to ${selectedName} on the chart`, description: 'Click the chart at the stop price. Add several for partial stops.', icon: <OctagonX {...planToolIcon} />, available: priced, unavailableReason: 'Set the entry price first' },
    { id: 'plan:target', label: `Add a target to ${selectedName} on the chart`, description: 'Click the chart at the target price. Add several for partial targets.', icon: <Target {...planToolIcon} />, available: priced, unavailableReason: 'Set the entry price first' },
  ] : []
  const selectTool = (id: string) => {
    if (id.startsWith('plan:')) {
      const tool = id.slice(5) as PlanTool
      editor.setTool(null)
      setPlanTool(current => current === tool ? null : tool)
      return
    }
    if (id === 'magnet') setPreferences({ magnet: !preferences.magnet })
    else if (id === 'undo') history.undo()
    else if (id === 'redo') history.redo()
    else if (id === 'clear') editor.clear()
    else if (isDrawingKind(id)) {
      setPlanTool(null)
      editor.setTool(editor.tool === id ? null : id)
      const group = drawingToolGroups.find(item => item.kinds.includes(id))
      if (group && preferences.toolChoice[group.id] !== id) setPreferences({ toolChoice: { ...preferences.toolChoice, [group.id]: id } })
    } else { setPlanTool(null); editor.setTool(null) }
  }
  const railTools = [crosshairTool, ...drawingToolGroups.map((group): ChartToolGroup => ({
    id: group.id, label: group.label, tools: group.kinds.map(kind => drawingToolsByKind[kind]),
    current: preferences.toolChoice[group.id] ?? group.kinds[0]!,
  }))]
  const toggleFavorite = (id: string) => {
    if (!isDrawingKind(id)) return
    const favorites = preferences.drawingFavorites
    setPreferences({ drawingFavorites: favorites.includes(id) ? favorites.filter(kind => kind !== id) : [...favorites, id] })
  }
  const favoriteTools = <div className="chart-favorite-tools" role="group" aria-label="Favorite drawing tools">
    {preferences.drawingFavorites.map(kind => {
      const tool = drawingToolsByKind[kind]
      return <ChartIconButton key={kind} label={tool.label} description={tool.description} icon={tool.icon} pressed={editor.tool === kind} onClick={() => selectTool(kind)} />
    })}
    <Popover.Root>
      <Popover.Trigger asChild>
        <button type="button" className="chart-icon-button chart-favorites-edit" aria-label="Choose favorite tools" title="Choose favorite tools"><Star size={14} aria-hidden="true" /></button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content className="chart-popover chart-tool-flyout" align="start" sideOffset={6} aria-label="Favorite tools">
          <p className="chart-tool-flyout-title">Favorites</p>
          <ul>
            {drawingToolGroups.flatMap(group => group.kinds).map(kind => {
              const tool = drawingToolsByKind[kind]
              const favorite = preferences.drawingFavorites.includes(kind)
              return <li key={kind}>
                <span className="chart-popover-choice">{tool.icon}<span>{tool.label}</span></span>
                <button type="button" className="chart-tool-favorite" aria-pressed={favorite} onClick={() => toggleFavorite(kind)}
                  aria-label={favorite ? `Remove ${tool.label} from favorites` : `Add ${tool.label} to favorites`}>
                  <Star size={13} aria-hidden="true" fill={favorite ? 'currentColor' : 'none'} /></button>
              </li>
            })}
          </ul>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  </div>
  const rail = <ChartToolRail tools={railTools} active={planTool ? `plan:${planTool}` : editor.tool ?? 'crosshair'}
    favorites={preferences.drawingFavorites} onToggleFavorite={toggleFavorite}
    groups={[{ label: `Plan levels for ${selectedEntry?.name ?? 'the entry'}`, tools: planTools }]} onSelect={selectTool} footer={[
    { id: 'magnet', label: 'Snap to candles', description: 'Pulls anchors to a nearby open, high, low or close.', icon: drawingUtilityIcons.magnet, available: true, pressed: preferences.magnet },
    { id: 'undo', label: history.undoLabel ? `Undo: ${history.undoLabel}` : 'Undo', icon: drawingUtilityIcons.undo, available: history.canUndo, pressed: false },
    { id: 'redo', label: history.redoLabel ? `Redo: ${history.redoLabel}` : 'Redo', icon: drawingUtilityIcons.redo, available: history.canRedo, pressed: false },
    { id: 'clear', label: `Clear unlocked ${instrument} drawings`, icon: drawingUtilityIcons.clear, available: editor.clearable, pressed: false, destructive: true },
  ]} unavailableReason="Nothing to change" />
  const planHint = planTool && `${planTool === 'entry' ? priced ? 'Click to add an entry' : `Click to set ${selectedName} price` : `Click to add a ${planTool} to ${selectedName}`}. Esc cancels.`
  const drawingBar = planHint ? <div className="chart-drawing-bar" role="status">{planHint}</div>
    : editor.tool ? <div className="chart-drawing-bar" role="status">{drawingToolHints[editor.tool]} Esc cancels.</div>
    : editor.selected ? <DrawingEditBar drawing={editor.selected} label={drawingToolLabels[editor.selected.kind]} defaultColor={drawingColors[0]}
      onStyle={style => editor.setStyle(editor.selected!.id, style)} onLocked={locked => editor.setLocked(editor.selected!.id, locked)}
      onDelete={editor.remove} onText={text => editor.setText(editor.selected!.id, text)} onTextFocus={editor.beginTextEdit} onTextBlur={editor.endTextEdit} /> : null
  const editedRef = levelEdit ? parseOverlayId(levelEdit.id) : null
  const editedIndex = editedRef ? entries.findIndex(entry => entry.id === editedRef.entryId) : -1
  const levelEditor = levelEdit && editedIndex >= 0 && editable ? <LevelEditor key={levelEdit.id} entries={entries} entry={entries[editedIndex]!}
    overlayId={levelEdit.id} anchor={levelEdit.anchor} direction={direction} leverage={leverage} onApply={applyEntry}
    onClose={() => setLevelEdit(null)} /> : null
  const drawingProps = {
    drawings, selectedDrawingId: editor.selectedId, tool: editor.tool, magnet: preferences.magnet,
    pricePicker: planTool !== null, onPricePick: pickPrice,
    onDrawingCreate: editor.create, onDrawingChange: editor.change, onDrawingSelect: editor.select, onKeyDown: onChartKeyDown,
    ...levelProps,
  }

  return <section className="panel chart-panel" aria-label="Chart" data-testid="chart-panel">
    {live ? <LiveChart key={`${source.accountId}|${instrument}`} source={source} instrument={instrument} interval={interval}
      instrumentName={instrumentName} caption={`${instrumentName} · ${venue ? `${venue} ` : ''}trade candles`} venue={venue} onCapture={onCapture} onShowEvidence={onShowEvidence}
      timeframes={<TimeframeBar value={interval} favorites={preferences.favorites}
        onChange={next => setPreferences({ interval: next })} onFavoritesChange={favorites => setPreferences({ favorites })} />}
      liveUpdates={preferences.live} onLiveUpdatesChange={on => setPreferences({ live: on })}
      viewMenu={<>{viewMenu}{viewMenu && favoriteTools && <ChartToolbarDivider />}{favoriteTools}</>} rail={rail} drawingBar={<>{drawingBar}{levelEditor}</>} drawingProps={drawingProps} overlays={overlays} createAdapter={createAdapter} expanded={expanded} expandButton={expandButton}
      onExpandedChange={setExpanded} onDialogClosed={() => expandButton.current?.focus({ preventScroll: true })} />
      : <>
        <ChartToolbar label="Chart controls" end={<>
          <span className="chart-status"><span className="chart-source">{instrument ? `${instrumentName} · ${venue ? `${venue} · ` : ''}no market data provider` : 'No perpetual instrument selected'}</span></span>
          <ChartIconButton label="Capture chart" icon={<Camera size={15} aria-hidden="true" />} disabled disabledReason="Needs market data" />
          <ChartIconButton label="Expand chart" icon={<Maximize2 size={15} aria-hidden="true" />} disabled disabledReason="Needs market data" />
        </>} />
        <div className="chart-placeholder">
          <span className="chart-placeholder-icon" aria-hidden="true"><ChartNoAxesCombined size={27} /></span>
          <strong>{instrument ? 'No market data for this instrument' : 'Choose an instrument'}</strong>
          <p>{instrument ? 'Manual accounts and labels have no candle provider yet. Planned levels stay in the editor.' : 'Select a Hyperliquid account and perpetual to load candles.'}</p>
          <p>No candles, live prices or execution observations are shown.</p>
        </div>
      </>}
    {several && <div className="chart-legend" role="group" aria-label="Planned entries">
      {entries.map((entry) => <button key={entry.id} type="button" aria-pressed={entry.id === selectedId}
        style={{ '--entry-color': entry.color } as CSSProperties} onClick={() => onSelect(entry.id)}>
        <i aria-hidden="true" /><span>{entry.name}</span>
        <small>{entry.share ? `${entry.share}% of quantity` : 'Share not set'}</small>
      </button>)}
      {average !== null && <span className="chart-legend-average"><i aria-hidden="true" />Average entry <strong>{formatDraggedPrice(average)}</strong></span>}
    </div>}
    {entries.length === 0 && <p className="chart-legend muted">No planned entries.</p>}
  </section>
}

function LiveChart({ source, instrument, instrumentName, interval, caption, venue, onCapture, onShowEvidence, liveUpdates, onLiveUpdatesChange, timeframes, viewMenu, rail, drawingBar, drawingProps, overlays, createAdapter, expanded, expandButton, onExpandedChange, onDialogClosed }: {
  source: ChartSource
  instrument: string
  instrumentName: string
  interval: CandleInterval
  caption: string
  venue: string | null
  onCapture?: ((image: Blob, context: string) => string | null) | undefined
  onShowEvidence?: (() => void) | undefined
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
  const chart = useRef<CandleChartControl>(null)
  const [capture, setCapture] = useState<{ busy: boolean; message: string; failed: boolean }>({ busy: false, message: '', failed: false })
  useEffect(() => {
    if (!capture.message) return
    const timer = setTimeout(() => setCapture(current => ({ ...current, message: '' })), 8000)
    return () => clearTimeout(timer)
  }, [capture.message])
  const latestCapture = useRef(onCapture)
  useEffect(() => { latestCapture.current = onCapture })
  const captureChart = async () => {
    if (!onCapture || capture.busy) return
    const now = new Date()
    const context = [instrumentName, venue, intervalName(interval)].filter(Boolean).join(' · ')
    setCapture({ busy: true, message: '', failed: false })
    let image: Blob | null
    try {
      image = await chart.current?.capture(`${context} · ${now.toISOString().slice(0, 16).replace('T', ' ')} UTC · Planned levels are not fills`) ?? null
    } catch {
      image = null
    }
    const problem = !image ? 'The chart could not be captured. Browser privacy or fingerprinting protection can block chart images; allow canvas access for this site and try again.'
      : latestCapture.current?.(image, context) ?? null
    setCapture({ busy: false, message: problem ?? 'Capture added to the Evidence tab of the journal.', failed: problem !== null })
  }
  const showEvidence = () => {
    onExpandedChange(false)
    onShowEvidence?.()
  }
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
    <ChartIconButton label="Capture chart" icon={<Camera size={15} aria-hidden="true" />} onClick={() => void captureChart()}
      disabled={!onCapture || data.status !== 'ready' || !data.candles.length || capture.busy} disabledReason={capture.busy ? 'Capturing' : 'Needs loaded candles'} aria-busy={capture.busy} />
    {!inDialog && <ChartIconButton ref={expandButton} label="Expand chart" icon={<Maximize2 size={15} aria-hidden="true" />} onClick={() => onExpandedChange(true)} />}
  </>}>
    {timeframes}
    <ChartToolbarDivider />
    {viewMenu}
  </ChartToolbar>
  const chartProps = {
    candles: data.candles, overlays, viewKey: `${instrument}|${interval}`, controlRef: chart,
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
    {capture.message && <p className={capture.failed ? 'chart-notice' : 'chart-notice chart-notice-success'} role={capture.failed ? 'alert' : 'status'}>{capture.message}
      {!capture.failed && onShowEvidence && <> <button type="button" onClick={showEvidence}>Show</button></>}</p>}
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
