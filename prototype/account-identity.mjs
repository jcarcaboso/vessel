// Disposable comparison of account identity treatments for donut legends and account selectors.
// Synthetic accounts only; nothing here talks to Vessel's API or a venue.

const logoBase = '../frontend/src/assets/venues/'

const icon = {
  chevron: '<path d="m6 9 6 6 6-6"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  folder: '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
  wallet: '<path d="M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1"/><path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4"/>',
  notebook: '<path d="M13.4 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7.4"/><path d="M2 6h4"/><path d="M2 10h4"/><path d="M2 14h4"/><path d="M2 18h4"/><path d="M21.4 5.6a1 1 0 1 0-3-3l-5 5a2 2 0 0 0-.5.9l-.9 2.9a.5.5 0 0 0 .6.6l2.9-.8a2 2 0 0 0 .9-.5z"/>',
  inbox: '<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>',
  copy: '<rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
}
const svg = (name, size = 14, cls = '') => `<svg class="${cls}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icon[name]}</svg>`
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])

// Venue descriptors as the API reports them. `hip3` is hypothetical, only to stress a long venue name and an unknown logo.
const venues = {
  hyperliquid: { name: 'Hyperliquid', logo: 'hyperliquid.svg' },
  lighter: { name: 'Lighter', logo: 'lighter.svg' },
  'lighter-rh': { name: 'Lighter · Robinhood', logo: 'lighter-rh.svg' },
  risex: { name: 'RISEx', logo: 'risex.svg' },
  manual: { name: 'Manual', icon: 'notebook' },
  hip3: { name: 'Hyperliquid Builder-Deployed Perpetuals (HIP-3)', icon: 'wallet' },
}

const portfolios = {
  farming: { name: 'farming' },
  intraday: { name: 'intraday' },
  swing: { name: 'Swing research desk — long-horizon experiments' },
}

// The three accounts from the owner's screenshot, then a stress set.
const accounts = [
  { id: 'hl-main', name: 'main', venue: 'hyperliquid', source: '0x6d1e9c42aa1b3c4d5e6f708192a3b4c5d6e7f389', portfolio: 'farming' },
  { id: 'lt-main', name: 'Main account', venue: 'lighter', source: '48213', portfolio: 'farming' },
  { id: 'rx-main', name: 'main', venue: 'risex', source: '0x9a3c55e7b1d2c3f4a5b6c7d8e9f0a1b2c3d401be', portfolio: 'intraday' },
  { id: 'rh-long', name: 'Swing desk — long-horizon subaccount for majors', venue: 'lighter-rh', source: '281474976710655', portfolio: 'swing' },
  { id: 'hl-blank', name: '', venue: 'hyperliquid', source: '0x3f5ab2c19e0d4471a8b6e2f0c9d1aa7c3b21c0de', portfolio: 'swing' },
  { id: 'hip3-main', name: 'main', venue: 'hip3', source: '0x77b04c1d2e3f405162738495a6b7c8d9e0f1a2b3', portfolio: 'swing' },
  { id: 'hl-main-2', name: 'main', venue: 'hyperliquid', source: '0xa41c7d3e2f1a0b9c8d7e6f5a4b3c2d1e0f9a92de', portfolio: 'swing' },
  { id: 'manual', name: 'Cold storage ledger', venue: 'manual', source: null, portfolio: 'swing' },
  { id: 'lt-scratch', name: 'Scratch', venue: 'lighter', source: '7', portfolio: null },
]
const byId = Object.fromEntries(accounts.map(a => [a.id, a]))

const groups = [
  { id: 'farming', name: 'farming', total: '$2,643.55', short: '$2.6K', count: 2, share: '65.83%', slices: [
    { id: 'hl-main', slot: 2, share: '50.54%', money: '$1,336.06', fraction: .5054 },
    { id: 'lt-main', slot: 1, share: '49.46%', money: '$1,307.49', fraction: .4946 },
  ] },
  { id: 'intraday', name: 'intraday', total: '$1,372.30', short: '$1.4K', count: 1, share: '34.17%', slices: [
    { id: 'rx-main', slot: 1, share: '100.00%', money: '$1,372.30', fraction: 1 },
  ] },
  { id: 'swing', name: portfolios.swing.name, total: '$9,480.00', short: '$9.5K', count: 5, share: 'stress', slices: [
    { id: 'rh-long', slot: 1, share: '32.10%', money: '$3,043.08', fraction: .321 },
    { id: 'hl-blank', slot: 2, share: '24.80%', money: '$2,351.04', fraction: .248 },
    { id: 'hip3-main', slot: 3, share: '18.40%', money: '$1,744.32', fraction: .184 },
    { id: 'hl-main-2', slot: 4, share: '15.20%', money: '$1,440.96', fraction: .152 },
    { id: 'manual', slot: 5, share: '9.50%', money: '$900.60', fraction: .095 },
  ] },
]

/** Same rule as `shortSource` in frontend/src/lib/format.ts. */
function shortSource(value) {
  if (!value) return null
  if (/^0x[\da-f]{40}$/i.test(value)) return `${value.slice(0, 6)}…${value.slice(-4)}`
  if (/^\d+$/.test(value)) return value.length > 10 ? `#${value.slice(0, 4)}…${value.slice(-4)}` : `#${value}`
  return value.length > 16 ? `${value.slice(0, 8)}…${value.slice(-4)}` : value
}
const sourceText = a => shortSource(a.source) ?? 'Manual record'
const venueName = a => venues[a.venue].name
// Names compare trimmed and case-insensitively across every enabled account, so a suffix appears the same way in every view.
const key = a => a.name.trim().toLowerCase()
const ambiguous = a => !a.name.trim() || accounts.filter(b => key(b) === key(a)).length > 1
const fullTitle = a => `${a.name.trim() || 'Unnamed account'} · ${venueName(a)} · ${a.source ?? 'Manual record'}`

function logo(venueId, size = 'sm') {
  const v = venues[venueId]
  return `<span class="venue-logo venue-logo-${size}" aria-hidden="true">${v.logo ? `<img src="${logoBase}${v.logo}" alt="">` : svg(v.icon, 12)}</span>`
}
/** The primary label: the name, or for an unnamed account its short source in figures. */
function nameHtml(a, cls = 'id-name') {
  return a.name.trim() ? `<span class="${cls}">${esc(a.name)}</span>` : `<span class="${cls} is-unnamed">${esc(sourceText(a))}</span>`
}
const sourceHtml = a => a.name.trim() ? `<span class="id-source${a.source ? '' : ' is-manual'}">${esc(sourceText(a))}</span>` : '<span class="id-source is-manual">Unnamed</span>'

// ---------- donut ----------
const tau = Math.PI * 2
const point = (r, angle) => `${(r * Math.sin(angle)).toFixed(3)} ${(-r * Math.cos(angle)).toFixed(3)}`
function arc(outer, inner, start, end) {
  if (end - start >= tau - 1e-6) return `M ${point(outer, 0)} A ${outer} ${outer} 0 1 1 ${point(outer, Math.PI)} A ${outer} ${outer} 0 1 1 ${point(outer, 0)} M ${point(inner, 0)} A ${inner} ${inner} 0 1 0 ${point(inner, Math.PI)} A ${inner} ${inner} 0 1 0 ${point(inner, 0)} Z`
  const large = end - start > Math.PI ? 1 : 0
  return `M ${point(outer, start)} A ${outer} ${outer} 0 ${large} 1 ${point(outer, end)} L ${point(inner, end)} A ${inner} ${inner} 0 ${large} 0 ${point(inner, start)} Z`
}
function donut(group) {
  const r = 52, inner = r * .64
  let at = 0
  const paths = group.slices.map(s => { const start = at; at += s.fraction * tau; return `<path d="${arc(r, inner, start, at)}" fill="var(--series-${s.slot})"/>` }).join('')
  return `<div class="allocation-figure"><svg viewBox="${-r - 4} ${-r - 4} ${r * 2 + 8} ${r * 2 + 8}" aria-hidden="true">${paths}</svg>
    <div class="allocation-center"><strong>${group.short}</strong><small>${group.count} ${group.count === 1 ? 'account' : 'accounts'}</small></div></div>`
}
function card(group, legend, { width } = {}) {
  const items = group.slices.map(s => legend.row(byId[s.id], s)).join('')
  return `<article class="allocation-card" ${width ? `style="width:${width}px"` : ''}>
    <header><span class="allocation-card-name">${svg('folder', 15)}<span>${esc(group.name)}</span></span><span>${group.share === 'stress' ? 'stress data' : `${group.share} of total`}</span></header>
    <div class="allocation-donut">${donut(group)}<ul class="legend legend-${legend.id}">${items}</ul></div>
  </article>`
}

const swatch = s => `<span class="allocation-swatch" style="background:var(--series-${s.slot})"></span>`
const share = s => `<strong class="allocation-share">${s.share}</strong>`

const legends = [
  {
    id: 'current', title: 'Current', label: 'Today',
    pitch: 'Name only. Two accounts called “main” on different venues look identical, and nothing shows which venue an account belongs to.',
    row: (a, s) => `<li title="${esc(fullTitle(a))}">${swatch(s)}${nameHtml(a)}${share(s)}</li>`,
  },
  {
    id: 'chip', title: 'A · Venue chip', label: 'A',
    pitch: 'Name followed by a small chip with the venue logo and name. The chip gives way first: its text truncates, then only the logo remains in narrow cards. The source stays in the tooltip.',
    pros: ['Venue is readable at a glance', 'One line per account, same row height as today'],
    cons: ['Does not separate two accounts with the same name on the same venue', 'Long venue names lose their text in small cards'],
    row: (a, s) => `<li title="${esc(fullTitle(a))}">${swatch(s)}<span class="id-line">${nameHtml(a)}<span class="venue-chip">${logo(a.venue, 'xs')}<span>${esc(venueName(a))}</span></span></span>${share(s)}</li>`,
  },
  {
    id: 'two-line', title: 'B · Two-line identity', label: 'B',
    pitch: 'Name on the first line; venue logo, venue name and short source on a muted second line. The same pattern the Accounts table already uses.',
    pros: ['Always unambiguous: venue and address/index are both visible', 'Consistent with Accounts rows'],
    cons: ['Rows are taller (≈34px instead of 26px)', 'More text in a chart legend'],
    row: (a, s) => `<li title="${esc(fullTitle(a))}">${swatch(s)}<span class="id-stack">${nameHtml(a)}<span class="id-meta">${logo(a.venue, 'xs')}<span class="id-venue">${esc(venueName(a))}</span><span class="id-dot">·</span>${sourceHtml(a)}</span></span>${share(s)}</li>`,
  },
  {
    id: 'marker', title: 'C · Logo as marker', label: 'C',
    pitch: 'The venue logo replaces the colour dot and carries the slice colour as a ring. The short source follows the name in muted figures; the venue name is in the tooltip and accessible name.',
    pros: ['Compact: one line, no extra column', 'Address or index always disambiguates'],
    cons: ['Venue is recognised by logo, not read', 'The slice colour becomes a thin ring rather than a solid dot'],
    row: (a, s) => `<li title="${esc(fullTitle(a))}"><span class="logo-marker" style="--slice:var(--series-${s.slot})">${logo(a.venue, 'sm')}</span><span class="id-line">${nameHtml(a)}${a.name.trim() ? sourceHtml(a) : ''}</span>${share(s)}</li>`,
  },
  {
    id: 'adaptive', title: 'D · Disambiguate only when needed', label: 'D',
    pitch: 'Venue logo before every name; the short source appears only when two enabled accounts share a name (trimmed, case-insensitive) or the name is blank. The rule uses all enabled accounts, so “main” gets its suffix in every view, not only where both are visible.',
    pros: ['Quiet when names are already distinct', 'Suffix is stable across views'],
    cons: ['“main” vs “Main account” are similar but not equal, so they stay without a suffix', 'Which rows carry a suffix can change when accounts are added'],
    row: (a, s) => `<li title="${esc(fullTitle(a))}">${swatch(s)}<span class="id-line">${logo(a.venue, 'xs')}${nameHtml(a)}${a.name.trim() && ambiguous(a) ? sourceHtml(a) : ''}</span>${share(s)}</li>`,
  },
  {
    id: 'tile', title: 'E · Account identity tile', label: 'E',
    pitch: 'A reusable AccountIdentity component: the venue logo as an avatar with the slice colour as a corner badge, the name in bold, and “Venue · source” underneath. An unnamed account shows its source as the title.',
    pros: ['One component for legends, selectors, tables and dialogs', 'Strongest visual identity per account'],
    cons: ['Tallest rows (≈40px); small cards fit fewer accounts before scrolling', 'Corner badge is small next to the logo'],
    row: (a, s) => `<li title="${esc(fullTitle(a))}"><span class="id-avatar">${logo(a.venue, 'md')}<span class="id-badge" style="background:var(--series-${s.slot})"></span></span><span class="id-stack">${nameHtml(a)}<span class="id-meta"><span class="id-venue">${esc(venueName(a))}</span><span class="id-dot">·</span>${sourceHtml(a)}</span></span>${share(s)}</li>`,
  },
]

function legendOption(legend) {
  const list = (items, cls) => items?.length ? `<ul class="${cls}">${items.map(i => `<li>${esc(i)}</li>`).join('')}</ul>` : ''
  return `<article class="option" id="legend-${legend.id}" data-capture="legend-${legend.id}">
    <header class="option-head"><span class="option-tag">${legend.label}</span><div><h3>${esc(legend.title)}</h3><p>${esc(legend.pitch)}</p></div></header>
    <div class="option-notes">${list(legend.pros, 'pros')}${list(legend.cons, 'cons')}</div>
    <div class="stage stage-legend">
      <div class="stage-col"><span class="stage-label">Owner’s accounts · card at 470px</span>${card(groups[0], legend, { width: 470 })}${card(groups[1], legend, { width: 470 })}</div>
      <div class="stage-col"><span class="stage-label">Stress · card at 470px</span>${card(groups[2], legend, { width: 470 })}</div>
      <div class="stage-col"><span class="stage-label">Stress · narrowest card (300px)</span>${card(groups[2], legend, { width: 300 })}</div>
    </div>
  </article>`
}

// ---------- selectors ----------
const portfolioName = id => id ? portfolios[id].name : 'Unassigned'
const enabled = accounts
const filterBar = (trigger, popover, extra = '') => `<div class="filter-bar"><fieldset class="operation-filters"><legend>Filter operations</legend>
  <label class="filter-account"><span>Account</span>${trigger}${popover}</label>
  <label><span>Portfolio</span><span class="fake-select">All portfolios${svg('chevron')}</span></label>
  <label><span>Instrument</span><span class="fake-select">All instruments${svg('chevron')}</span></label>
  <label><span>Direction</span><span class="fake-select">All directions${svg('chevron')}</span></label>
  <label><span>Status</span><span class="fake-select">All statuses${svg('chevron')}</span></label>
  <label><span>Period</span><span class="fake-select">All retained activity${svg('chevron')}</span></label>
</fieldset>${extra}</div>`

const stackedLogos = () => `<span class="logo-stack">${['hyperliquid', 'lighter', 'risex', 'lighter-rh'].map(v => logo(v, 'xs')).join('')}</span>`
function trigger(a, { open = false, variant = 'rich' } = {}) {
  const body = !a ? `<span class="trigger-name">All enabled accounts</span>`
    : variant === 'text' ? `<span class="trigger-name">${esc(a.name || sourceText(a))} — ${esc(venueName(a))} · ${esc(sourceText(a))}</span>`
    : `${logo(a.venue, 'sm')}<span class="trigger-name${a.name.trim() ? '' : ' is-unnamed'}">${esc(a.name.trim() || sourceText(a))}</span>${a.name.trim() && ambiguous(a) ? `<span class="trigger-source">${esc(sourceText(a))}</span>` : ''}`
  return `<button type="button" class="account-trigger${open ? ' is-open' : ''}" aria-haspopup="listbox" aria-expanded="${open}" title="${a ? esc(fullTitle(a)) : 'All enabled accounts'}">${body}${svg('chevron', 14, 'trigger-chevron')}</button>`
}
const check = selected => `<span class="opt-check">${selected ? svg('check', 14) : ''}</span>`
const allRow = selected => `<li role="option" aria-selected="${selected}" class="opt opt-all${selected ? ' is-selected' : ''}">${check(selected)}${stackedLogos()}<span class="opt-text"><span class="opt-name">All enabled accounts</span><span class="opt-meta">${enabled.length} accounts · ${new Set(enabled.map(a => a.venue)).size} venues</span></span></li>`

function richRow(a, { selected = false, active = false, portfolio = false, query = '' } = {}) {
  const mark = text => query ? esc(text).replace(new RegExp(`(${query})`, 'ig'), '<mark>$1</mark>') : esc(text)
  return `<li role="option" aria-selected="${selected}" class="opt${selected ? ' is-selected' : ''}${active ? ' is-active' : ''}" title="${esc(fullTitle(a))}">${check(selected)}${logo(a.venue, 'md')}
    <span class="opt-text"><span class="opt-name${a.name.trim() ? '' : ' is-unnamed'}">${a.name.trim() ? mark(a.name) : esc(sourceText(a))}</span>
    <span class="opt-meta"><span class="id-venue">${mark(venueName(a))}</span><span class="id-dot">·</span>${sourceHtml(a)}</span></span>
    ${portfolio ? `<span class="opt-portfolio${a.portfolio ? '' : ' is-unassigned'}">${esc(portfolioName(a.portfolio))}</span>` : ''}</li>`
}
function compactRow(a, { selected = false, active = false, showVenueLogo = true, showPortfolio = false } = {}) {
  return `<li role="option" aria-selected="${selected}" class="opt opt-compact${selected ? ' is-selected' : ''}${active ? ' is-active' : ''}" title="${esc(fullTitle(a))}">${check(selected)}${showVenueLogo ? logo(a.venue, 'sm') : ''}
    ${nameHtml(a, 'opt-name')}${showPortfolio ? `<span class="opt-portfolio${a.portfolio ? '' : ' is-unassigned'}">${esc(portfolioName(a.portfolio))}</span>` : ''}${a.name.trim() ? sourceHtml(a) : '<em class="opt-unnamed">Unnamed</em>'}</li>`
}

const selected = byId['hl-main']
const selectors = [
  {
    id: 'current', title: 'Current', label: 'Today',
    pitch: 'NativeSelect with the account name only: three entries read “Main account”, “main”, “main”.',
    stage: () => filterBar(`<span class="fake-select is-open">All enabled accounts${svg('chevron')}</span>`,
      `<div class="native-popup"><div class="native-opt is-selected">✓ All enabled accounts</div>${accounts.slice(0, 3).map(a => `<div class="native-opt">${esc(a.name)}</div>`).join('')}</div>`),
    triggers: [null, selected, byId['rh-long']].map(a => `<span class="fake-select">${a ? esc(a.name) : 'All enabled accounts'}${svg('chevron')}</span>`),
  },
  {
    id: 'native-text', title: '0 · Richer text in the native select', label: '0',
    pitch: 'No new component: each option reads “name — venue · source”, grouped by portfolio with optgroups. Logos are impossible in native options and the operating system decides how long labels are cut.',
    pros: ['Smallest change; keeps native keyboard, mobile pickers and the “every select uses NativeSelect” rule', 'Disambiguates in text'],
    cons: ['No logos', 'Long names and long venue names push the source out of view'],
    stage: () => filterBar(trigger(selected, { open: true, variant: 'text' }),
      `<div class="native-popup is-wide">${['farming', 'intraday', 'swing', null].map(p => `<div class="native-group">${esc(portfolioName(p))}</div>${accounts.filter(a => a.portfolio === p).map(a => `<div class="native-opt${a === selected ? ' is-selected' : ''}">${a === selected ? '✓ ' : ''}${esc(a.name.trim() || sourceText(a))} — ${esc(venueName(a))} · ${esc(sourceText(a))}</div>`).join('')}`).join('')}</div>`),
    triggers: [null, selected, byId['rh-long']].map(a => trigger(a, { variant: 'text' })),
  },
  {
    id: 'rich', title: '1 · Rich listbox', label: '1',
    pitch: 'A custom listbox. The trigger shows the venue logo and name, plus the short source when another account shares the name (rule D); the list shows each account as a logo tile with name and “venue · source”, in one flat list. The popover may be wider than the trigger so long names stay readable.',
    pros: ['Clear identity in both trigger and list', 'Simple: no grouping to learn'],
    cons: ['Long flat list once there are many accounts', 'Custom component: needs the listbox keyboard pattern and a mobile sheet'],
    stage: () => filterBar(trigger(selected, { open: true }),
      `<div class="popover"><ul role="listbox">${allRow(false)}<li class="opt-sep" role="presentation"></li>${accounts.map(a => richRow(a, { selected: a === selected, active: a.id === 'lt-main' })).join('')}</ul></div>`),
    triggers: [null, selected, byId['rh-long'], byId['hl-blank']].map(a => trigger(a)),
  },
  {
    id: 'by-portfolio', title: '2 · Grouped by portfolio', label: '2',
    pitch: 'Accounts sit under their portfolio, Unassigned last. Rows are one line: logo, name and short source aligned to the right. Mirrors the Allocation cards, so the same account reads the same way in both places.',
    pros: ['Compact rows fit more accounts', 'Matches how Overview groups accounts'],
    cons: ['Venue is shown only as a logo', 'Portfolio filter beside it becomes partly redundant'],
    stage: () => filterBar(trigger(selected, { open: true }),
      `<div class="popover"><ul role="listbox">${allRow(false)}${['farming', 'intraday', 'swing', null].map(p => `<li class="opt-group" role="presentation">${svg(p ? 'folder' : 'inbox', 13)}<span>${esc(portfolioName(p))}</span><small>${accounts.filter(a => a.portfolio === p).length}</small></li>${accounts.filter(a => a.portfolio === p).map(a => compactRow(a, { selected: a === selected, active: a.id === 'lt-main' })).join('')}`).join('')}</ul></div>`),
    triggers: [null, selected, byId['rh-long'], byId['hl-blank']].map(a => trigger(a)),
  },
  {
    id: 'by-venue', title: '3 · Grouped by venue', label: '3',
    pitch: 'Venue headers carry the logo and full venue name (truncated with a tooltip when long); rows show name, a portfolio tag and the short source. Answers “which Hyperliquid account?” directly.',
    pros: ['Venue identity is explicit even for long or unknown venues', 'Same-name accounts on one venue sit side by side with their sources'],
    cons: ['Rows repeat no logo, so the trigger and the list look different', 'Portfolio tag adds width'],
    stage: () => filterBar(trigger(selected, { open: true }),
      `<div class="popover is-wide"><ul role="listbox">${allRow(false)}${Object.keys(venues).filter(v => accounts.some(a => a.venue === v)).map(v => `<li class="opt-group" role="presentation">${logo(v, 'xs')}<span>${esc(venues[v].name)}</span><small>${accounts.filter(a => a.venue === v).length}</small></li>${accounts.filter(a => a.venue === v).map(a => compactRow(a, { selected: a === selected, active: a.id === 'hl-main-2', showVenueLogo: false, showPortfolio: true })).join('')}`).join('')}</ul></div>`),
    triggers: [null, selected, byId['rh-long'], byId['hl-blank']].map(a => trigger(a)),
  },
  {
    id: 'search', title: '4 · Searchable combobox', label: '4',
    pitch: 'The rich list with a search field on top that matches name, venue, portfolio or address/index (here “main”). Results keep the identity rows and add the portfolio on the right; keyboard hints sit in the footer.',
    pros: ['Scales to dozens of accounts', 'Pasting an address finds the account even when the name is generic'],
    cons: ['Most work: combobox ARIA pattern, focus handling, mobile sheet', 'Overkill for three accounts (search could appear only above ~8)'],
    stage: () => filterBar(trigger(selected, { open: true }),
      `<div class="popover is-wide has-search"><div class="popover-search">${svg('search', 14)}<span class="search-text">main</span><span class="caret"></span><kbd>Esc</kbd></div>
      <ul role="listbox">${accounts.filter(a => /main/i.test(a.name)).map(a => richRow(a, { selected: a === selected, active: a.id === 'rx-main', portfolio: true, query: 'main' })).join('')}</ul>
      <footer class="popover-foot"><span>5 of ${accounts.length} accounts</span><span><kbd>↑</kbd><kbd>↓</kbd> move <kbd>Enter</kbd> select</span></footer></div>`),
    triggers: [null, selected, byId['rh-long'], byId['hl-blank']].map(a => trigger(a)),
  },
]

function selectorOption(sel) {
  const list = (items, cls) => items?.length ? `<ul class="${cls}">${items.map(i => `<li>${esc(i)}</li>`).join('')}</ul>` : ''
  return `<article class="option" id="selector-${sel.id}" data-capture="selector-${sel.id}">
    <header class="option-head"><span class="option-tag">${sel.label}</span><div><h3>${esc(sel.title)}</h3><p>${esc(sel.pitch)}</p></div></header>
    <div class="option-notes">${list(sel.pros, 'pros')}${list(sel.cons, 'cons')}</div>
    <div class="stage stage-selector">${sel.stage()}</div>
    <div class="trigger-strip"><span class="stage-label">Closed trigger at the filter width (176px): all, selected, long name, unnamed</span><div>${sel.triggers.map(t => `<div class="trigger-cell">${t}</div>`).join('')}</div></div>
  </article>`
}

document.getElementById('app').innerHTML = `
  <header class="page-head"><h1>Account identity · options</h1>
    <p>October 16, 2026. Disposable comparison on synthetic accounts: the owner’s three accounts (“main” on Hyperliquid, “Main account” on Lighter, “main” on RISEx) plus a stress set with a long account name, a blank name, a manual record, two “main” accounts on the same venue and a hypothetical venue with a long name and no bundled logo. Graphite theme tokens.</p></header>
  <section class="group"><h2>Donut legends · Allocation</h2>${legends.map(legendOption).join('')}</section>
  <section class="group"><h2>Account selector · Activity filter and related filters</h2>${selectors.map(selectorOption).join('')}</section>`
