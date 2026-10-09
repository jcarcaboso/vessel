import { useState } from 'react'
import { Check, Moon, Palette, RotateCcw, Sun, TriangleAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { appearanceStore, radiusRange, resolveTheme, useAppearance, type Appearance } from './appearance'
import { contrastChecks, isHexColor, themes, type Theme, type ThemeColorKey } from './themes'
import './appearance.css'

const colorGroups: { label: string; colors: { key: ThemeColorKey; label: string }[] }[] = [
  { label: 'Surfaces', colors: [
    { key: 'background', label: 'Page background' }, { key: 'card', label: 'Panels' }, { key: 'secondary', label: 'Insets' },
    { key: 'accent', label: 'Hover and selection' }, { key: 'field', label: 'Fields' }, { key: 'border', label: 'Borders' },
  ] },
  { label: 'Text', colors: [{ key: 'foreground', label: 'Text' }, { key: 'mutedForeground', label: 'Secondary text' }] },
  { label: 'Actions', colors: [
    { key: 'primary', label: 'Primary button' }, { key: 'primaryForeground', label: 'Primary button text' }, { key: 'ring', label: 'Accent and focus' },
  ] },
  { label: 'Signals', colors: [{ key: 'positive', label: 'Positive and Long' }, { key: 'negative', label: 'Negative and Short' }, { key: 'warning', label: 'Warning' }] },
  { label: 'Chart', colors: [{ key: 'candleUp', label: 'Up candle' }, { key: 'candleDown', label: 'Down candle' }] },
]

/** Theme gallery plus a customizer for the selected theme. Changes apply to the whole app immediately. */
export function AppearanceSettings() {
  const appearance = useAppearance()
  const resolved = resolveTheme(appearance)
  const failing = contrastChecks(resolved.colors).filter(check => check.ratio < check.minimum)
  return <section className="shell-panel appearance-panel" aria-labelledby="appearance-heading">
    <header className="shell-panel-heading">
      <div><h2 id="appearance-heading">Appearance</h2><p>Choose a theme and adjust its colours. Saved in this browser only; layout never changes between themes.</p></div>
      <span className="workspace-badge"><Palette size={11} aria-hidden="true" /> {resolved.theme.name}{resolved.customized ? ' · customized' : ''}</span>
    </header>
    <div className="appearance-body">
      {(['dark', 'light'] as const).map(scheme => <div key={scheme} className="theme-group">
        <h3>{scheme === 'dark' ? <Moon size={13} aria-hidden="true" /> : <Sun size={13} aria-hidden="true" />}{scheme === 'dark' ? 'Dark themes' : 'Light themes'}</h3>
        <div className="theme-gallery">{themes.filter(theme => theme.scheme === scheme).map(theme =>
          <ThemeCard key={theme.id} theme={theme} selected={theme.id === resolved.theme.id} custom={appearance.custom} />)}
        </div>
      </div>)}
      <div className="theme-customizer">
        <div className="customizer-heading">
          <div><h3>Customize {resolved.theme.name}</h3><p>Overrides are kept per theme, so switching back restores them.</p></div>
          <Button variant="outline" size="sm" disabled={!resolved.customized} onClick={() => appearanceStore.resetTheme(resolved.theme.id)}><RotateCcw size={13} />Reset {resolved.theme.name}</Button>
        </div>
        <div className="color-groups">{colorGroups.map(group => <fieldset key={group.label} className="color-group">
          <legend>{group.label}</legend>
          {group.colors.map(({ key, label }) => <ColorField key={`${resolved.theme.id}-${key}`} label={label} value={resolved.colors[key]}
            changed={resolved.colors[key] !== resolved.theme.colors[key]} onChange={color => appearanceStore.setColor(key, color)} />)}
        </fieldset>)}
          <fieldset className="color-group">
            <legend>Shape</legend>
            <label className="radius-field"><span>Corner radius <output>{resolved.radius}px</output></span>
              <input type="range" min={radiusRange.min} max={radiusRange.max} step={1} value={resolved.radius} onChange={event => appearanceStore.setRadius(Number(event.target.value))} />
            </label>
            <ThemeSample />
          </fieldset>
        </div>
        <div className={`contrast-report ${failing.length ? 'has-issues' : ''}`} role="status" aria-label="Readability">
          {failing.length === 0
            ? <><Check size={14} aria-hidden="true" />All {contrastChecks(resolved.colors).length} readability checks pass.</>
            : <><TriangleAlert size={14} aria-hidden="true" /><div><strong>{failing.length} readability {failing.length === 1 ? 'check fails' : 'checks fail'}</strong>
              <ul>{failing.map(check => <li key={check.label}>{check.label}: {check.ratio.toFixed(2)}:1, needs {check.minimum}:1</li>)}</ul></div></>}
        </div>
      </div>
    </div>
  </section>
}

function ThemeCard({ theme, selected, custom }: { theme: Theme; selected: boolean; custom: Appearance['custom'] }) {
  const { colors, radius, customized } = resolveTheme({ themeId: theme.id, custom })
  return <button type="button" className="theme-card" aria-pressed={selected} onClick={() => appearanceStore.selectTheme(theme.id)}>
    <span className="theme-preview" aria-hidden="true" style={{ background: colors.background, borderColor: colors.border }}>
      <span className="theme-preview-panel" style={{ background: colors.card, borderColor: colors.border, borderRadius: radius / 2 }}>
        <i style={{ background: colors.foreground, width: '62%' }} />
        <i style={{ background: colors.mutedForeground, width: '42%' }} />
        <span className="theme-preview-signals"><b style={{ background: colors.positive }} /><b style={{ background: colors.negative }} /><b style={{ background: colors.warning }} /></span>
      </span>
      <span className="theme-preview-action" style={{ background: colors.primary, borderRadius: radius / 3 }} />
    </span>
    <span className="theme-card-copy">
      <strong>{theme.name}{selected && <Check size={13} aria-label="Selected" />}</strong>
      <small>{theme.description}</small>
      {customized && <span className="workspace-badge">Customized</span>}
    </span>
  </button>
}

function ColorField({ label, value, changed, onChange }: { label: string; value: string; changed: boolean; onChange: (color: string) => void }) {
  // Typing keeps a draft until it is a full hex colour; the picker and resets show through otherwise.
  const [draft, setDraft] = useState<string | null>(null)
  const text = draft ?? value
  const commit = () => { if (isHexColor(text)) onChange(text); setDraft(null) }
  return <div className="color-field" data-changed={changed || undefined}>
    <input type="color" value={value} aria-label={`${label} colour`} onChange={event => onChange(event.target.value)} />
    <span>{label}</span>
    <input type="text" value={text} aria-label={`${label} hex value`} spellCheck={false} maxLength={7}
      aria-invalid={!isHexColor(text) || undefined}
      onChange={event => setDraft(event.target.value.trim())} onBlur={commit} onKeyDown={event => { if (event.key === 'Enter') commit() }} />
  </div>
}

/** A few live controls so a change can be judged without leaving the page. */
function ThemeSample() {
  return <div className="theme-sample" aria-label="Theme sample">
    <div><Button size="sm">Primary</Button><Button size="sm" variant="outline">Outline</Button></div>
    <div><span className="sample-chip positive">Long +2.4%</span><span className="sample-chip negative">Short −1.1%</span><span className="workspace-badge warning-badge">Warning</span></div>
    <input aria-label="Sample field" placeholder="Field" readOnly />
  </div>
}

export function CurrentThemeName() {
  const { theme, customized } = resolveTheme(useAppearance())
  return <>{theme.name}{customized ? ' (customized)' : ''}</>
}
