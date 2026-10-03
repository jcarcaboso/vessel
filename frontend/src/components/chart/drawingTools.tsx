import { ArrowUpDown, Crosshair, Eraser, Magnet, Minus, MoveHorizontal, MoveVertical, RectangleHorizontal, Rows4, Redo2, SeparatorVertical, Slash, Type, Undo2 } from 'lucide-react'
import type { ReactNode } from 'react'
import type { ChartTool } from './ChartToolRail'
import type { DrawingKind } from './drawings'

const icon = { size: 16, strokeWidth: 1.6, 'aria-hidden': true } as const

export const drawingToolLabels: Record<DrawingKind, string> = {
  'trend-line': 'Trend line', 'horizontal-line': 'Horizontal line', 'vertical-line': 'Vertical line', zone: 'Rectangle zone',
  'date-range': 'Date range', 'price-range': 'Price range',
  fibonacci: 'Fibonacci retracement', position: 'Long/short position', text: 'Text note',
}

/** How to draw each kind, shown in the tool tooltip and while the tool is active. */
export const drawingToolHints: Record<DrawingKind, string> = {
  'trend-line': 'Drag, or click twice, to draw a trend line.',
  'horizontal-line': 'Click to place a horizontal line.',
  'vertical-line': 'Click to mark a moment in time.',
  zone: 'Drag, or click twice, to mark a zone.',
  'date-range': 'Drag across time to measure bars and duration.',
  'price-range': 'Drag up or down to measure a price change.',
  fibonacci: 'Drag from the swing start to the swing end.',
  position: 'Click the entry, then drag to the target. The stop mirrors it at 1R.',
  text: 'Click to place a note, then edit its text.',
}

const tool = (id: DrawingKind, icon: ReactNode): ChartTool => ({ id, label: drawingToolLabels[id], description: drawingToolHints[id], icon, available: true })

/** The drawing set, led by the crosshair for selecting and moving. */
export const drawingTools: readonly ChartTool[] = [
  { id: 'crosshair', label: 'Crosshair', description: 'Select, move and resize drawings and levels.', icon: <Crosshair {...icon} />, available: true },
  tool('trend-line', <Slash {...icon} />),
  tool('horizontal-line', <Minus {...icon} />),
  tool('vertical-line', <SeparatorVertical {...icon} />),
  tool('zone', <RectangleHorizontal {...icon} />),
  tool('date-range', <MoveHorizontal {...icon} />),
  tool('price-range', <MoveVertical {...icon} />),
  tool('fibonacci', <Rows4 {...icon} />),
  tool('position', <ArrowUpDown {...icon} />),
  tool('text', <Type {...icon} />),
]

export const drawingUtilityIcons = {
  magnet: <Magnet {...icon} />,
  undo: <Undo2 {...icon} />,
  redo: <Redo2 {...icon} />,
  clear: <Eraser {...icon} />,
}

export const isDrawingKind = (id: string): id is DrawingKind => id in drawingToolLabels
