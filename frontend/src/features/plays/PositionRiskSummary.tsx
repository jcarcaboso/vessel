import type { PlayDraft } from './draft'
import { positionRiskSummary, type PlannedExitSummary, type RiskCoverage, type RiskReference } from './position-risk-summary'
import { defaultSizeUnits, formatMoney, formatQuantity, formatRewardToRisk, type SizeUnits } from './sizing'
import './position-risk-summary.css'

export interface PositionRiskSummaryProps {
  draft: PlayDraft
  units?: SizeUnits
  /** Explicit named, positive reference in `units.quote`. Never inferred from margin or budget. */
  riskReference?: RiskReference | null
}

const percent = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 })
const percentText = (value: number) => value > 0 && value < 0.01 ? '< 0.01%' : `${percent.format(value)}%`
const moneyText = (value: number, units: SizeUnits) =>
  value > 0 && value < 0.01 ? `< 0.01 ${units.quote}` : formatMoney(value, units)
const coverageText = (value: RiskCoverage) =>
  `${value.percent === null ? 'Unknown' : percentText(value.percent)} · ${value.status}`

function Outcome({ value, units }: { value: PlannedExitSummary; units: SizeUnits }) {
  if (value.totalAmount !== null) return <>{moneyText(value.totalAmount, units)}</>
  if (value.coverage.status === 'invalid') return <>Unknown<small>Invalid allocation</small></>
  return <>{value.knownAmount === null ? 'Unknown' : `Known ${moneyText(value.knownAmount, units)}`}
    <small>Total unknown</small></>
}

/** Append inside the approved bottom PositionSummary. This component owns no account/API reads. */
export function PositionRiskSummary({ draft, units = defaultSizeUnits, riskReference }: PositionRiskSummaryProps) {
  const summary = positionRiskSummary(draft, units, riskReference)
  const coverages: Array<[string, RiskCoverage, string]> = [
    ['Entry allocation', summary.entryAllocation, 'Entry quantity shares of the full position.'],
    ['Stop allocation', summary.stops.allocation, 'Allocated stop shares weighted by actual entry shares, even when prices are missing.'],
    ['Target allocation', summary.targets.allocation, 'Allocated target shares weighted by actual entry shares, even when prices are missing.'],
    ['Stop coverage', summary.stops.coverage, 'Full-position quantity with priced entries and correctly sided planned stops. Not observed stop protection.'],
    ['Target coverage', summary.targets.coverage, 'Full-position quantity with priced entries and correctly sided planned targets. Not executed exits.'],
  ]
  return <div className="position-risk-summary" role="group" aria-label="Planned position money summary">
    <dl className="position-risk-metrics">
      <div><dt>All-stops planned loss</dt><dd data-tone="loss" data-incomplete={summary.stops.totalAmount === null}>
        <Outcome value={summary.stops} units={units} />
      </dd></div>
      <div><dt>All-targets planned gain</dt><dd data-tone="gain" data-incomplete={summary.targets.totalAmount === null}>
        <Outcome value={summary.targets} units={units} />
      </dd></div>
      <div><dt>Planned R:R</dt><dd data-incomplete={summary.rewardToRisk === null}
        data-warning={summary.rewardToRisk !== null && summary.rewardToRisk < 1}>
        {summary.rewardToRisk === null ? 'Unknown' : formatRewardToRisk(summary.rewardToRisk)}
      </dd></div>
      <div><dt>{summary.reference ? `Risk / ${summary.reference.name}` : 'Risk share'}</dt>
        <dd data-incomplete={summary.riskSharePercent === null}>
          {summary.riskSharePercent === null ? 'Unknown' : percentText(summary.riskSharePercent)}
          {!summary.reference && <small>Needs a named positive reference in {units.quote}</small>}
        </dd>
      </div>
    </dl>
    <dl className="position-risk-coverage">
      <div><dt>Priced quantity</dt><dd>
        {summary.pricedQuantity === null ? 'Unknown' : formatQuantity(summary.pricedQuantity, units)}
        <small>{summary.pricedCoverage.percent === null ? 'Unknown' : percentText(summary.pricedCoverage.percent)}
          {' '}of full position · {summary.pricedCoverage.status}</small>
      </dd></div>
      {coverages.map(([label, value, description]) => <div key={label} title={description}><dt>{label}</dt>
        <dd data-warning={value.status !== 'complete'}>{coverageText(value)}</dd>
      </div>)}
    </dl>
    <p className="position-risk-note">Planned estimates assume fills at the stated prices. Stops and targets are separate scenarios.
      Fees, slippage and funding excluded. Actual loss can exceed planned loss.</p>
  </div>
}
