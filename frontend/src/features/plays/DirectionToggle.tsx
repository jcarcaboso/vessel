import { ArrowDown, ArrowUp } from 'lucide-react'

export function DirectionToggle({ value, onChange, disabled = false, title }: {
  value: 'long' | 'short'
  onChange: (value: 'long' | 'short') => void
  disabled?: boolean
  title?: string | undefined
}) {
  return <div className="direction-toggle segmented" role="group" aria-label="Direction" title={title}>
    <button type="button" className="direction-option" data-direction="long" aria-pressed={value === 'long'} disabled={disabled}
      onClick={() => onChange('long')}>
      <span className="direction-icon" aria-hidden="true"><ArrowUp size={14} aria-hidden="true" /></span>
      <span>Long</span><span className="direction-indicator" aria-hidden="true" />
    </button>
    <button type="button" className="direction-option" data-direction="short" aria-pressed={value === 'short'} disabled={disabled}
      onClick={() => onChange('short')}>
      <span className="direction-icon" aria-hidden="true"><ArrowDown size={14} aria-hidden="true" /></span>
      <span>Short</span><span className="direction-indicator" aria-hidden="true" />
    </button>
  </div>
}
