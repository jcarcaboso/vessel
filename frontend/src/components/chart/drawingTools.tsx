import { ArrowUpDown, Crosshair, Eraser, Magnet, Minus, RectangleHorizontal, Rows4, Redo2, Slash, Type, Undo2 } from 'lucide-react'
import type { ChartTool } from './ChartToolRail'
import type { DrawingKind } from './drawings'

const icon = { size: 16, strokeWidth: 1.6, 'aria-hidden': true } as const

export const drawingToolLabels: Record<DrawingKind, string> = {
  'trend-line': 'Trend line', 'horizontal-line': 'Horizontal line', zone: 'Rectangle zone',
  fibonacci: 'Fibonacci retracement', position: 'Long/short position', text: 'Text note',
}

/** The agreed first drawing set, led by the crosshair for selecting and moving. */
export const drawingTools: readonly ChartTool[] = [
  { id: 'crosshair', label: 'Crosshair', icon: <Crosshair {...icon} />, available: true },
  { id: 'trend-line', label: drawingToolLabels['trend-line'], icon: <Slash {...icon} />, available: true },
  { id: 'horizontal-line', label: drawingToolLabels['horizontal-line'], icon: <Minus {...icon} />, available: true },
  { id: 'zone', label: drawingToolLabels.zone, icon: <RectangleHorizontal {...icon} />, available: true },
  { id: 'fibonacci', label: drawingToolLabels.fibonacci, icon: <Rows4 {...icon} />, available: true },
  { id: 'position', label: drawingToolLabels.position, icon: <ArrowUpDown {...icon} />, available: true },
  { id: 'text', label: drawingToolLabels.text, icon: <Type {...icon} />, available: true },
]

export const drawingUtilityIcons = {
  magnet: <Magnet {...icon} />,
  undo: <Undo2 {...icon} />,
  redo: <Redo2 {...icon} />,
  clear: <Eraser {...icon} />,
}

export const isDrawingKind = (id: string): id is DrawingKind => id in drawingToolLabels
