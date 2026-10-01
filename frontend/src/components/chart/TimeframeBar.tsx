import { useState } from 'react'
import { Check, ChevronDown, Star } from 'lucide-react'
import { Popover } from 'radix-ui'
import { candleIntervals, type CandleInterval } from '@/api/workspace'
import { intervalLabel, intervalName } from './intervals'

export function TimeframeBar({ value, favorites, onChange, onFavoritesChange }: {
  value: CandleInterval
  favorites: readonly CandleInterval[]
  onChange: (interval: CandleInterval) => void
  onFavoritesChange: (favorites: CandleInterval[]) => void
}) {
  const [open, setOpen] = useState(false)
  // The active interval stays visible even when it is not a favorite.
  const shown = candleIntervals.filter(interval => favorites.includes(interval) || interval === value)
  const toggleFavorite = (interval: CandleInterval) => onFavoritesChange(favorites.includes(interval)
    ? favorites.filter(favorite => favorite !== interval) : [...favorites, interval])

  return <div className="timeframe-bar" role="group" aria-label="Timeframe">
    {shown.map(interval => <button key={interval} type="button" aria-pressed={interval === value}
      aria-label={intervalName(interval)} title={intervalName(interval)} onClick={() => onChange(interval)}>{intervalLabel(interval)}</button>)}
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button type="button" className="timeframe-more" aria-label="All timeframes"><ChevronDown size={14} aria-hidden="true" /></button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content className="chart-popover timeframe-menu" align="start" sideOffset={6}>
          <p>Star a timeframe to keep it on the bar.</p>
          <ul>
            {candleIntervals.map(interval => {
              const favorite = favorites.includes(interval)
              return <li key={interval}>
                <button type="button" className="chart-popover-choice" aria-current={interval === value} onClick={() => { onChange(interval); setOpen(false) }}>
                  <span>{intervalName(interval)}</span>{interval === value && <Check size={13} aria-hidden="true" />}
                </button>
                <button type="button" className="timeframe-star" aria-pressed={favorite} aria-label={`Favorite ${intervalName(interval)}`}
                  onClick={() => toggleFavorite(interval)}><Star size={13} aria-hidden="true" fill={favorite ? 'currentColor' : 'none'} /></button>
              </li>
            })}
          </ul>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  </div>
}
