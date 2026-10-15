import type { SummaryAmount } from '@/api/overview-summary'
import { InfoTip } from '@/components/ui/info-tip'

type Status = 'complete' | 'partial' | 'unavailable'

const plural = (count: number, noun: string) => `${count} ${count === 1 ? noun : `${noun}s`}`

/**
 * Coverage stays visible only while it is incomplete: a compact warning pill whose accessible name states the coverage
 * and whose tooltip lists the reasons. Complete coverage renders nothing.
 */
export function CoverageBadge({ covered, total, noun = 'account', status, reasons = [], excluded = 0, closed, label }: {
  /** Covered and total items; when unknown, the server status alone is shown. */
  covered?: number | undefined; total?: number | undefined; noun?: string
  /** A server coverage state; when absent, coverage is complete only with every item covered and no reasons. */
  status?: Status
  reasons?: string[]; excluded?: number
  /** Closed operations that contributed, for realized results. */
  closed?: number | undefined
  /** What the coverage concerns, e.g. "Balance". */
  label?: string | undefined
}) {
  const counted = covered !== undefined && total !== undefined
  const accountsComplete = !counted || covered >= total
  const complete = status ? status === 'complete' : accountsComplete && excluded === 0 && reasons.length === 0
  if (complete) return null
  const coverage = counted ? `${covered} of ${plural(total, noun)}` : status ?? 'partial'
  const pill = !accountsComplete ? `${covered}/${total}` : excluded > 0 ? `${excluded} excluded` : status === 'unavailable' ? 'unavailable' : 'partial'
  const name = [`${label ? `${label} coverage` : 'Coverage'} ${coverage}`, closed !== undefined && `${closed} closed`, excluded > 0 && `${excluded} excluded`]
    .filter(Boolean).join(', ')
  return <InfoTip label={name} className="workspace-badge warning-badge coverage-badge" trigger={pill}>
    <span>{counted ? coverage : `Coverage ${coverage}`}{closed !== undefined ? ` · ${closed} closed` : ''}{excluded > 0 ? ` · ${excluded} excluded` : ''}.</span>
    {counted && status === 'unavailable' && <span>Coverage unavailable.</span>}
    {reasons.map((reason, index) => <span key={index}>{reason}</span>)}
  </InfoTip>
}

/** Coverage of a Summary amount from the overview summary API. */
export function SummaryCoverageBadge({ value: { coverage }, operations = false, label }: { value: SummaryAmount; operations?: boolean; label?: string }) {
  return <CoverageBadge covered={coverage.contributingAccountCount} total={coverage.totalAccountCount} label={label}
    closed={operations ? coverage.contributingOperationCount : undefined} excluded={coverage.excludedOperationCount}
    reasons={coverage.reasons.map(r => `${r.count}: ${r.reason}`)} />
}

/** The nominal-USD tag on pooled balance figures: venue quote stablecoins are added at 1:1. The tag opens the detail. */
export function NominalUsdTag({ detail = 'Listed stablecoins at 1:1.' }: { detail?: string }) {
  return <InfoTip label="About nominal USD" className="value-tag" trigger="Nominal USD">{detail}</InfoTip>
}
