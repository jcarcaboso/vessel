import { portfolioIconKey, portfolioIconKeys, portfolioIcons, type PortfolioIconKey } from './portfolio-icons'

export function PortfolioIcon({ icon, size = 21 }: { icon: string | undefined; size?: number }) {
  const Icon = portfolioIcons[portfolioIconKey(icon)].icon
  return <Icon size={size} aria-hidden="true" />
}

/** A radio group of the available portfolio icons; arrow keys move between choices. A value this browser does not know leaves every choice unchecked. */
export function PortfolioIconPicker({ value, onChange, disabled = false, name }: {
  value: string; onChange: (icon: PortfolioIconKey) => void; disabled?: boolean; name: string
}) {
  return <fieldset className="portfolio-icon-picker" disabled={disabled}>
    <legend>Icon</legend>
    <div className="portfolio-icon-choices">{portfolioIconKeys.map(key => {
      const { label, icon: Icon } = portfolioIcons[key]
      return <label key={key} className="portfolio-icon-choice" title={label}>
        <input type="radio" className="sr-only" name={name} value={key} checked={value === key} onChange={() => onChange(key)} aria-label={label} />
        <Icon size={17} aria-hidden="true" />
      </label>
    })}</div>
  </fieldset>
}
