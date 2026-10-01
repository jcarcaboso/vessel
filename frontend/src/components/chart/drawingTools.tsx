import { ArrowUpDown, Crosshair, Eraser, Magnet, Minus, RectangleHorizontal, Rows4, Slash, Type } from 'lucide-react'
import type { ChartTool } from './ChartToolRail'

const icon = { size: 16, strokeWidth: 1.6, 'aria-hidden': true } as const

/** The agreed first drawing set. Only the crosshair works until drawing tools are implemented. */
export const drawingTools: readonly ChartTool[] = [
  { id: 'crosshair', label: 'Crosshair', icon: <Crosshair {...icon} />, available: true },
  { id: 'trend-line', label: 'Trend line', icon: <Slash {...icon} />, available: false },
  { id: 'horizontal-line', label: 'Horizontal line', icon: <Minus {...icon} />, available: false },
  { id: 'zone', label: 'Rectangle zone', icon: <RectangleHorizontal {...icon} />, available: false },
  { id: 'fibonacci', label: 'Fibonacci retracement', icon: <Rows4 {...icon} />, available: false },
  { id: 'position', label: 'Long/short position', icon: <ArrowUpDown {...icon} />, available: false },
  { id: 'text', label: 'Text note', icon: <Type {...icon} />, available: false },
]

export const drawingUtilities: readonly ChartTool[] = [
  { id: 'magnet', label: 'Snap to candles', icon: <Magnet {...icon} />, available: false },
  { id: 'clear', label: 'Clear drawings', icon: <Eraser {...icon} />, available: false },
]
