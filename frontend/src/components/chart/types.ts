import type { ChartDrawing, DrawingKind } from './drawings'

/** Renderer inputs are independent of plays, journals and execution matching. */

/** Display candle. Times are UTC Unix milliseconds; prices are parsed for plotting only. */
export interface ChartCandle {
  time: number
  open: number
  high: number
  low: number
  close: number
}

/** A horizontal price level supplied by a feature, e.g. a planned entry, stop or target. */
export interface PriceOverlay {
  id: string
  /** Short canvas/axis tag, e.g. "E1 · T2". */
  label: string
  price: number
  /** Line and tag color. CSS custom properties such as `var(--negative)` are resolved by the renderer. */
  color: string
  /** Optional marker drawn at the start of the tag, e.g. the owning entry's color. */
  accent?: string
  /** `reference` marks derived, non-editable levels such as an average. */
  kind: 'entry' | 'stop' | 'target' | 'reference'
  emphasis: 'selected' | 'normal'
  draggable: boolean
}

export interface ChartCallbacks {
  onLevelSelect(id: string): void
  /** Called continuously while dragging, then once with phase "end". */
  onLevelDrag(id: string, price: number, phase: 'move' | 'end'): void
  /** The visible range is close to the oldest loaded candle. */
  onNeedOlder(): void
  onDrawingCreate(drawing: ChartDrawing): void
  /** Called continuously while moving or resizing, then once with phase "end". */
  onDrawingChange(drawing: ChartDrawing, phase: 'move' | 'end'): void
  onDrawingSelect(id: string | null): void
  /** Asks to edit a level in place, e.g. after a double-click or a click on its tag. `anchor` is in pane pixels. */
  onLevelEdit(id: string, anchor: { x: number; y: number }): void
  /** A click while the price picker is on, with the price under the pointer (magnet applied). */
  onPricePick(price: number): void
}

/** Boundary that keeps the charting library out of feature code. */
export interface ChartAdapter {
  /** `reset` re-anchors the view at the latest candle, e.g. after an instrument or interval change. */
  setCandles(candles: readonly ChartCandle[], reset: boolean): void
  setOverlays(overlays: readonly PriceOverlay[]): void
  setDrawings(drawings: readonly ChartDrawing[], selectedId: string | null): void
  /** `null` is the crosshair: select, move and resize instead of creating. */
  setDrawingTool(tool: DrawingKind | null, magnet: boolean): void
  /** While on, clicks report a price through `onPricePick` instead of selecting, drawing or panning. */
  setPricePicker(active: boolean): void
  /**
   * PNG of the chart as shown, including planned levels and drawings but not the crosshair, with
   * `caption` in a footer. Null until the renderer is ready.
   */
  capture(caption: string): Promise<Blob | null>
  destroy(): void
}

export type ChartAdapterFactory = (container: HTMLElement, callbacks: ChartCallbacks) => ChartAdapter
