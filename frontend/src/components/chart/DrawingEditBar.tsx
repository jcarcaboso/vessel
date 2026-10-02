import { useState, type CSSProperties } from 'react'
import { Lock, LockOpen, Trash2 } from 'lucide-react'
import { Popover } from 'radix-ui'
import { ChartIconButton, ChartMenu, ChartToolbarDivider } from './ChartToolbar'
import { drawingColors, type ChartDrawing, type DrawingLineStyle, type DrawingLineWidth, type DrawingStyle } from './drawings'

const lineStyles: { value: DrawingLineStyle; label: string }[] = [
  { value: 'solid', label: 'Solid' }, { value: 'dashed', label: 'Dashed' }, { value: 'dotted', label: 'Dotted' },
]
const lineWidths: { value: `${DrawingLineWidth}`; label: string }[] = [
  { value: '1', label: '1 px' }, { value: '2', label: '2 px' }, { value: '3', label: '3 px' },
]

/** Floating editor for one selected drawing. Appearance stays editable while locked; geometry does not. */
export function DrawingEditBar({ drawing, label, defaultColor, onStyle, onLocked, onDelete, onText, onTextFocus }: {
  drawing: ChartDrawing
  label: string
  defaultColor: string
  onStyle: (style: DrawingStyle) => void
  onLocked: (locked: boolean) => void
  onDelete: () => void
  onText: (text: string) => void
  onTextFocus: () => void
}) {
  const [colorsOpen, setColorsOpen] = useState(false)
  const color = drawing.style?.color ?? defaultColor
  const lined = drawing.kind !== 'text' && drawing.kind !== 'position'
  return <div className="chart-drawing-bar" role="group" aria-label="Selected drawing">
    <span className="chart-drawing-name">{label}</span>
    <ChartToolbarDivider />
    <Popover.Root open={colorsOpen} onOpenChange={setColorsOpen}>
      <Popover.Trigger asChild>
        <button type="button" className="chart-color-trigger" aria-label={`Drawing color ${color}`} title="Color">
          <i style={{ '--swatch': color } as CSSProperties} aria-hidden="true" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content className="chart-popover chart-color-grid" sideOffset={6} aria-label="Drawing colors">
          {drawingColors.map(option => <button key={option} type="button" aria-label={`Color ${option}`} aria-pressed={option === color}
            style={{ '--swatch': option } as CSSProperties} onClick={() => { onStyle({ color: option }); setColorsOpen(false) }} />)}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
    {lined && <ChartMenu label="Line style" value={drawing.style?.line ?? 'solid'} options={lineStyles} onChange={line => onStyle({ line })} />}
    {drawing.kind !== 'text' && <ChartMenu label="Line width" value={`${drawing.style?.width ?? 1}`} options={lineWidths}
      onChange={width => onStyle({ width: Number(width) as DrawingLineWidth })} />}
    {drawing.kind === 'text' && <input aria-label="Note text" value={drawing.text ?? ''} maxLength={200} disabled={drawing.locked}
      onFocus={onTextFocus} onChange={event => onText(event.target.value)} />}
    <ChartToolbarDivider />
    <ChartIconButton label={drawing.locked ? 'Unlock drawing' : 'Lock drawing'} pressed={drawing.locked === true}
      icon={drawing.locked ? <Lock size={14} aria-hidden="true" /> : <LockOpen size={14} aria-hidden="true" />} onClick={() => onLocked(!drawing.locked)} />
    <ChartIconButton label="Delete drawing" icon={<Trash2 size={14} aria-hidden="true" />} onClick={onDelete}
      disabled={drawing.locked === true} disabledReason="Unlock to delete" />
  </div>
}
