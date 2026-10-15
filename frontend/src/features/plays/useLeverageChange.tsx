import { useState } from 'react'
import type { PlayDraft } from './draft'
import { keepPercentLevelPrices, leverageOf, percentLevels } from './levels'
import { LeverageChangeDialog } from './LeverageChangeDialog'
import { defaultSizeUnits, type SizeUnits } from './sizing'

/** One confirmation owner for position controls and accepted suggestions. */
export function useLeverageChange(draft: PlayDraft, onChange: (draft: PlayDraft) => void, units: SizeUnits = defaultSizeUnits) {
  const [pending, setPending] = useState<number | null>(null)
  const leverage = leverageOf(draft.leverage)
  function request(value: string) {
    if (value !== '' && Number(value) !== leverage && percentLevels(draft.entries).length) setPending(Number(value))
    else onChange({ ...draft, leverage: value })
  }
  function finish(keep?: 'prices' | 'percentages') {
    if (keep && pending !== null) onChange({ ...draft, leverage: String(pending),
      entries: keep === 'prices' ? keepPercentLevelPrices(draft.entries, leverage, pending) : draft.entries })
    setPending(null)
  }
  return { request, dialog: pending === null ? null : <LeverageChangeDialog draft={draft} from={leverage} to={pending} units={units}
    onKeepPrices={() => finish('prices')} onKeepPercentages={() => finish('percentages')} onCancel={() => finish()} /> }
}
