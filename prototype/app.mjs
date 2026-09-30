import { accounts, instruments, strategies, newPlay, calculate, equalize, validDraft, migrateDraft, levelErrors, levelPercent, priceFromPercent, suggestPosition, applySuggestion, entryColors, entryColor, syncAccountBudget, capitalContext, riskReference } from './model.mjs';
import { themes, applyTheme, semanticColors, defaultTheme } from './themes.mjs?v=baseline-20260930';

const $ = id => document.getElementById(id);
const escape = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const money = (value, decimals = 2) => !Number.isFinite(value) ? '—' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(value);
const number = (value, digits = 0) => Number.isFinite(value) ? new Intl.NumberFormat('en-US', { maximumFractionDigits: digits }).format(value) : '—';
const key = 'vessel-prototype-01';
// Graphite is the approved baseline. Explicit links and the theme picker remain
// available for future theme support without an old study preference overriding it.
let activeTheme = applyTheme(new URL(location.href).searchParams.get('theme') || defaultTheme);
let play = newPlay();
let loadMessage = '';
try {
  const saved = localStorage.getItem(key);
  if (saved) {
    const old = JSON.parse(saved);
    const parsed = migrateDraft(old);
    if (!validDraft(parsed)) throw new Error('Invalid draft');
    play = parsed;
    if (old.schemaVersion !== 3) loadMessage = 'Previous draft restored. Entered quantities are now one total position with entry shares. Prices, captures and notes are preserved.';
    $('save-state').textContent = 'Draft restored';
  }
} catch {
  loadMessage = 'Saved draft could not be loaded. Showing sample data; the stored draft has not been overwritten.';
}
let selected = play.entries[0].id;
play.layout = 'side';
syncAccountBudget(play);
let budgetEditing = false;
let tab = 'thesis';
let drawing = false;
let drawStart = null;
let toastTimer;
const account = () => accounts[play.portfolio].find(item => item.id === play.account);
const selectedEntry = () => play.entries.find(entry => entry.id === selected);
const notify = message => {
  $('toast').textContent = message;
  $('toast').classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $('toast').classList.remove('visible'), 4500);
};
const dirty = () => { $('save-state').textContent = 'Unsaved changes'; };

function renderBudget() {
  $('margin-budget').readOnly = !budgetEditing;
  if (!budgetEditing) $('margin-budget').value = play.marginBudget ?? '';
  $('cancel-budget').hidden = !budgetEditing;
  $('use-account-budget').hidden = budgetEditing || account().equity == null;
  $('add-optional-budget').hidden = budgetEditing || play.marginBudget != null;
  $('edit-budget').innerHTML = budgetEditing ? '✓' : '<svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="m4 13 9-9 3 3-9 9-4 1 1-4Z M11 6l3 3"/></svg>';
  $('edit-budget').setAttribute('aria-label', budgetEditing ? 'Save budget' : 'Edit budget');
  $('edit-budget').title = budgetEditing ? 'Save budget' : 'Edit budget';
  $('budget-source').textContent = budgetEditing ? 'Enter or ✓ to save · Escape to cancel · blank is optional' :
    play.marginBudget == null ? 'No available balance. Add a budget only if useful.' :
    play.budgetSource === 'account' ? 'From sample account value · edit with the pencil' : 'Manual override · account and portfolio values unchanged';
}
function beginBudgetEdit() {
  budgetEditing = true; renderBudget(); renderCalculations(); $('margin-budget').focus(); $('margin-budget').select();
}
function saveBudgetEdit() {
  const input = $('margin-budget'), value = input.value === '' ? null : Number(input.value);
  if (input.validity.badInput || value !== null && (!Number.isFinite(value) || value < 0)) {
    notify('Use a non-negative budget, or leave it blank.'); return;
  }
  play.marginBudget = value; play.budgetSource = 'manual'; budgetEditing = false;
  changed(); $('edit-budget').focus();
}
function cancelBudgetEdit() {
  budgetEditing = false; renderBudget(); renderCalculations(); $('edit-budget').focus();
}
function renderChartView() {
  $('chart-view').innerHTML = '<option value="aggregate">Aggregate · All entries</option>' +
    play.entries.map((entry, i) => `<option value="${entry.id}">Entry ${String(i + 1).padStart(2, '0')} · ${number(entry.allocation, 2)}%</option>`).join('');
  $('chart-view').value = play.chartMode === 'aggregate' ? 'aggregate' : selected;
  $('entry-dialog-select').innerHTML = play.entries.map((entry, i) => `<option value="${entry.id}">Entry ${String(i + 1).padStart(2, '0')} · ${number(entry.allocation, 2)}%</option>`).join('');
  $('entry-dialog-select').value = selected;
  $('entry-dialog-title').textContent = `Entry ${String(play.entries.findIndex(entry => entry.id === selected) + 1).padStart(2, '0')} details`;
}

function selectEntry(id) {
  if (!play.entries.some(entry => entry.id === id)) return;
  selected = id;
  renderEntries();
  if (!$('entry-dialog').open) {
    const panel = document.querySelector('.entries-panel');
    const card = $('entry-list').querySelector(`[data-entry="${selected}"]`);
    const panelBounds = panel.getBoundingClientRect(), cardBounds = card.getBoundingClientRect();
    // Reveal in the bounded editor only. Never scroll the entire page away from
    // the chart when selection comes from a plotted level or the chart legend.
    if (cardBounds.top < panelBounds.top || cardBounds.bottom > panelBounds.bottom) {
      panel.scrollTop += cardBounds.top - panelBounds.top - 12;
    }
  }
}

function syncLeverageControls() {
  const valid = Number.isInteger(play.leverage) && play.leverage >= 1 && play.leverage <= 100;
  if (valid) $('leverage-slider').value = play.leverage;
  $('leverage').setAttribute('aria-invalid', !valid);
  $('leverage-slider').setAttribute('aria-valuetext', `${$('leverage-slider').value} times leverage`);
  document.querySelectorAll('[data-leverage]').forEach(button => button.setAttribute('aria-pressed', Number(button.dataset.leverage) === play.leverage));
}

function renderContext() {
  for (const field of ['title', 'portfolio', 'instrument', 'status', 'risk', 'leverage']) $(field).value = Number.isNaN(play[field]) ? '' : play[field];
  renderBudget();
  $('position-size').value = play.positionSize === 0 || !Number.isFinite(play.positionSize) ? '' : Number(play.positionSize.toPrecision(12));
  $('position-unit').querySelector('[value=quantity]').textContent = `Quantity · ${play.instrument}`;
  $('position-unit').value = play.sizeUnit;
  $('position-size-label').textContent = play.sizeUnit === 'margin' ? 'Your total margin · USD' : `Your total quantity · ${play.instrument}`;
  $('size-basis-help').textContent = play.sizeUnit === 'margin'
    ? 'Leverage changes total exposure and quantity. Your committed margin stays fixed.'
    : 'Leverage changes required margin. Your total quantity stays fixed.';
  syncLeverageControls();
  $('capture-count').textContent = play.captures.length;
  renderChartView();
  $('account').innerHTML = accounts[play.portfolio].map(item => `<option value="${item.id}">${escape(item.name)}</option>`).join('');
  $('account').value = play.account;
  for (const direction of ['long', 'short']) $(direction).setAttribute('aria-pressed', play.direction === direction);
  $('workspace').classList.remove('below');
  const reference = riskReference(play, account().equity);
  $('equity-label').textContent = reference.value == null ? 'Risk reference unavailable' : `Risk reference: ${money(reference.value, 0)} · ${reference.label}`;
  $('chart-symbol').textContent = `${play.instrument} / USD`;
  $('chart-venue').textContent = `${account().name.split(' · ')[0]} · Sample candles`;
  $('coin').textContent = { BTC: '₿', ETH: 'Ξ', SOL: '◎' }[play.instrument];
  $('chart-quote').textContent = number(instruments[play.instrument].entry * 1.00436, 2);
  $('plan').textContent = play.status === 'Planned' ? 'Planned ✓' : 'Mark planned ↗';
  $('plan').disabled = play.status === 'Planned';
  document.querySelectorAll('[data-timeframe]').forEach(button => button.setAttribute('aria-pressed', button.dataset.timeframe === play.timeframe));
  document.querySelectorAll('[data-risk]').forEach(button => button.setAttribute('aria-pressed', Number(button.dataset.risk) === play.risk));
  $('tab-strategy').innerHTML = `Strategy <span>${strategies[play.strategy].version || '—'}</span>`;
}

function renderEntries() {
  $('entry-count').textContent = String(play.entries.length).padStart(2, '0');
  const inputValue = value => Number.isFinite(value) ? Number(value.toPrecision(12)) : '';
  $('entry-list').innerHTML = play.entries.map((entry, i) => {
    const percent = entry.levelUnit === 'percent';
    const displayLevel = level => inputValue(percent ? levelPercent(entry.price, level) : level);
    return `<article class="entry-card ${entry.id === selected ? 'selected' : ''}" data-entry="${entry.id}" style="--entry-color:${entryColor(entry)}">
      <div class="entry-heading" data-select-entry="${entry.id}"><button class="entry-select" data-select="${entry.id}" aria-pressed="${entry.id === selected}" aria-expanded="${entry.id === selected}" aria-controls="entry-details-${entry.id}"><i></i> Entry ${String(i + 1).padStart(2, '0')}</button><div><label class="entry-share-label">Share <input type="number" min="0" max="100" step="any" data-field="allocation" value="${entry.allocation}" aria-label="Entry ${i + 1} position share">%</label><span class="entry-rr" id="rr-${entry.id}"></span><button class="remove" data-remove-entry="${entry.id}" aria-label="Remove entry ${i + 1}" ${play.entries.length === 1 ? 'disabled' : ''}>×</button></div></div>
      <div class="entry-collapsed"><span>Entry ${money(entry.price, instruments[play.instrument].decimals)}</span><span id="collapsed-size-${entry.id}"></span><span>SL ${money(entry.stop, instruments[play.instrument].decimals)} · ${entry.targets.length} target${entry.targets.length === 1 ? '' : 's'}</span><small>Select this entry to edit</small></div>
      <div class="entry-body" id="entry-details-${entry.id}">
        <div class="level-mode"><span>Stop & target input</span><div><button data-level-unit="price" aria-pressed="${!percent}" aria-label="Entry ${i + 1} levels as price">Price</button><button data-level-unit="percent" aria-pressed="${percent}" aria-label="Entry ${i + 1} levels as percentage">% move</button></div></div>
        <div class="price-row"><label>Entry price · USD<input type="number" min="0.000001" step="any" value="${inputValue(entry.price)}" data-field="price" aria-label="Entry ${i + 1} price"></label><label class="stop-label">Stop loss · ${percent ? '% distance' : 'USD'}<input type="number" min="0.000001" step="any" value="${displayLevel(entry.stop)}" data-field="stop" aria-label="Entry ${i + 1} stop loss"><small id="stop-note-${entry.id}" class="level-equivalent"></small></label></div>
        ${entry.targets.map((target, j) => `<div class="target-row" data-target="${j}"><label>Take profit ${j + 1} · ${percent ? '% move' : 'USD'}<input type="number" min="0.000001" step="any" value="${displayLevel(target.price)}" data-target-field="price" aria-label="Entry ${i + 1} target ${j + 1} price"><small id="target-note-${entry.id}-${j}" class="level-equivalent"></small></label><label class="percent">Exit share<input type="number" min="0.01" max="100" step="any" value="${target.allocation}" data-target-field="allocation" aria-label="Entry ${i + 1} target ${j + 1} exit percentage"><span>%</span></label><button class="remove" data-remove-target="${j}" aria-label="Remove entry ${i + 1} target ${j + 1}" ${entry.targets.length === 1 ? 'disabled' : ''}>×</button></div>`).join('')}
        <button class="add-target" data-add-target="${entry.id}" ${entry.targets.length >= 5 ? 'disabled' : ''}>＋ Add target</button>
        <p class="percent-explainer">% is the price move from entry, not leveraged return.</p>
        <div class="entry-actual" id="actual-${entry.id}"></div>
        <div class="entry-meta"><span id="size-${entry.id}"></span><small>Derived from the whole position</small></div>
      </div></article>`;
  }).join('');
  $('add-entry').disabled = play.entries.length >= 8;
  renderCalculations();
}

function renderCalculations() {
  const result = calculate(play, account().equity, 'entered');
  const suggestion = suggestPosition(play, account().equity);
  const capital = capitalContext(play, result);
  const reference = riskReference(play, account().equity);
  renderChartView();
  const signedMoney = (value, sign) => value == null ? '—' : value === 0 ? money(0) : `${sign}${money(value)}`;
  $('budget').textContent = reference.value != null && Number.isFinite(play.risk) && play.risk > 0 && play.risk <= 100 ? money(reference.value * play.risk / 100) : '—';
  const percentText = value => value == null ? '—' : `${number(value, 2)}%`;
  $('portfolio-value').textContent = money(capital.portfolio, 0);
  $('account-value').textContent = money(capital.account, 0);
  $('account-detail').textContent = capital.account == null ? 'Balance unavailable · budget optional' : 'Budget locked by default · pencil to override';
  $('portfolio-detail').textContent = `${accounts[play.portfolio].length} sample account${accounts[play.portfolio].length === 1 ? '' : 's'} · ${capital.portfolio == null ? 'balance unavailable' : 'USD'}`;
  $('portfolio-margin-share').textContent = percentText(capital.marginPercent);
  $('portfolio-exposure-share').textContent = percentText(capital.exposurePercent);
  $('account-margin-share').textContent = `${percentText(capital.accountMarginPercent)} of account value`;
  $('account-exposure-share').textContent = `${percentText(capital.accountExposurePercent)} of account value · can exceed 100%`;
  $('position-margin').textContent = money(result.margin);
  $('position-notional').textContent = money(result.notional);
  $('position-quantity').textContent = result.quantity == null ? '—' : `${number(result.quantity, 8)} ${play.instrument}`;
  $('assistant-budget-value').textContent = Number.isFinite(play.marginBudget) && play.marginBudget > 0 ? money(play.marginBudget, 0) : '—';
  const allocation = play.entries.reduce((sum, entry) => sum + entry.allocation, 0);
  $('allocation-total').textContent = Number.isFinite(allocation) ? `${number(allocation, 4)}% allocated` : 'Check shares';
  $('allocation-total').classList.toggle('invalid', !Number.isFinite(allocation) || Math.abs(allocation - 100) >= .001);
  $('chart-entry-legend').innerHTML = play.entries.map((entry, i) => `<button data-chart-entry="${entry.id}" style="--entry-color:${entryColor(entry)}" aria-pressed="${entry.id === selected}"><i></i>Entry ${String(i + 1).padStart(2, '0')} <span>${number(entry.allocation, 2)}%</span></button>`).join('');
  $('summary-description').textContent = `${play.entries.length} ${play.entries.length === 1 ? 'entry' : 'entries'} · ${play.direction === 'long' ? 'Long' : 'Short'}`;
  $('summary-leverage').textContent = Number.isInteger(play.leverage) && play.leverage >= 1 && play.leverage <= 100 ? `Leverage ${play.leverage}×` : 'Check leverage';
  $('total-risk').textContent = signedMoney(result.risk, '−');
  $('total-reward').textContent = signedMoney(result.reward, '+');
  $('loss-equity').textContent = result.risk == null ? '' : account().equity > 0 ? `${number(result.risk / account().equity * 100, 2)}% of sample equity` : 'Account value unavailable';
  $('profit-equity').textContent = result.reward == null ? '' : account().equity > 0 ? `${number(result.reward / account().equity * 100, 2)}% of sample equity` : 'Account value unavailable';
  $('total-rr').textContent = result.rr == null ? '—' : `${number(result.rr, 2)} : 1`;
  $('total-size').innerHTML = result.quantity == null ? '—' : `${number(result.quantity, 8)} <small>${play.instrument}</small>`;
  $('total-notional').textContent = money(result.notional, 0);
  $('total-margin').textContent = money(result.margin);
  $('total-average').textContent = money(result.average, instruments[play.instrument].decimals);
  $('average-label').textContent = result.average == null ? 'Average entry: check entry shares' : `Planned avg. entry ${money(result.average, instruments[play.instrument].decimals)}`;
  play.entries.forEach((entry, i) => {
    const actual = result.entries[i];
    const suggested = suggestion.entries[i];
    $(`rr-${entry.id}`).textContent = actual?.rr != null ? `${number(actual.rr, 2)}R` : 'No size';
    $(`collapsed-size-${entry.id}`).textContent = actual?.quantity ? `${number(actual.quantity, 8)} ${play.instrument}` : 'No size entered';
    $(`size-${entry.id}`).textContent = suggested && !suggestion.errors.length ? `Suggested ${number(suggested.quantity, 5)} ${play.instrument}` : 'Check assistant';
    $(`actual-${entry.id}`).innerHTML = actual ? `<span>${number(actual.quantity, 8)} ${play.instrument} · ${money(actual.notional, 0)} notional</span><span>${money(actual.margin)} margin</span><span class="negative">SL ${signedMoney(actual.risk, '−')}</span><span class="positive">TP ${signedMoney(actual.reward, '+')}</span>` : '<span>Check position inputs</span>';
    const equivalent = level => !Number.isFinite(level) || !Number.isFinite(entry.price) || entry.price <= 0 ? '—' : entry.levelUnit === 'percent' ? money(level, 2) : `${number(levelPercent(entry.price, level), 3)}% from entry`;
    $(`stop-note-${entry.id}`).textContent = equivalent(entry.stop);
    entry.targets.forEach((target, j) => { $(`target-note-${entry.id}-${j}`).textContent = equivalent(target.price); });
  });
  $('errors').hidden = !result.errors.length;
  $('errors').innerHTML = `<ul>${result.errors.map(error => `<li>${escape(error)}</li>`).join('')}</ul>`;
  $('plan').disabled = budgetEditing || play.status === 'Planned' || !!result.errors.length || !(result.quantity > 0);
  const warnings = [];
  if (!result.errors.length) {
    if (!result.quantity) warnings.push('No position size entered. Enter one total margin or quantity, or apply the assistant. Your available account budget is not automatically committed.');
    else if (play.entries.some(entry => entry.allocation === 0)) warnings.push('Some entries have a 0% share. They appear on the chart but do not contribute to average price or P&L.');
    if (reference.value != null && Number.isFinite(play.risk) && play.risk > 0 && result.risk > reference.value * play.risk / 100 + 1e-8) warnings.push('Your modeled loss at stops exceeds the assistant’s risk budget. Your position has not been changed.');
    if (Number.isFinite(play.marginBudget) && play.marginBudget > 0 && result.margin > play.marginBudget) warnings.push('Committed margin exceeds your editable available budget.');
    if (account().equity != null && Number.isFinite(play.marginBudget) && play.marginBudget > account().equity) warnings.push('Your budget override exceeds the sample account value. Portfolio percentages still use the original sample values.');
    if (account().equity != null && result.margin > account().equity) warnings.push('Required margin exceeds the sample account equity.');
    if (result.entries.some(entry => entry.risk >= entry.margin && entry.quantity > 0)) warnings.push('At least one stop models a loss at or above that entry’s margin. Liquidation may occur before the stop. No liquidation model is included.');
    else if (play.leverage > 1 && result.quantity > 0) warnings.push('Leveraged scenario only. Liquidation may precede the stop; venue limits, maintenance margin and fees are not modeled.');
  }
  $('position-warnings').textContent = warnings.join(' ');
  $('assistant-errors').textContent = suggestion.errors.join(' ');
  $('apply-suggestion').disabled = budgetEditing || !!suggestion.errors.length;
  $('suggestion-headline').textContent = suggestion.errors.length ? 'Check entries & budget' : `${number(suggestion.quantity, 5)} ${play.instrument} · ${suggestion.leverage}× · ${money(suggestion.risk, 0)} risk`;
  $('suggestion-output').innerHTML = suggestion.errors.length ? '' : `<div class="suggestion-metrics"><div><span>Suggested size</span><strong>${number(suggestion.quantity, 5)} ${play.instrument}</strong></div><div><span>Minimum to fit budget</span><strong>${suggestion.leverage}×</strong></div><div><span>Required margin</span><strong>${money(suggestion.margin)}</strong></div><div><span>If all stops fill</span><strong class="negative">−${money(suggestion.risk)}</strong></div></div><div class="suggested-entries">${suggestion.entries.map((entry, i) => `<span>Entry ${i + 1}: ${number(entry.quantity, 5)} ${play.instrument}</span>`).join('')}</div>`;
  renderChart();
}

function renderChart() {
  const width = Math.max($('chart').clientWidth, 300);
  const height = Math.max($('chart').clientHeight, 280);
  const right = width - 89, bottom = height - 35, top = 20;
  const base = instruments[play.instrument];
  const entry = selectedEntry();
  const valid = levelErrors(play).length === 0;
  const aggregate = play.chartMode === 'aggregate';
  const shownEntries = aggregate ? play.entries : [entry];
  const position = calculate(play, account().equity, 'entered');
  const levels = valid ? shownEntries.flatMap(item => [item.price, item.stop, ...item.targets.map(target => target.price)]) : [];
  // Synthetic, deterministic candles. These are not market prices or historical bars.
  const n = width < 440 ? 44 : 65;
  const step = { '1H': 0.55, '4H': 0.85, '1D': 1.2 }[play.timeframe];
  const closes = Array.from({ length: n }, (_, i) => {
    const t = i / (n - 1);
    const trend = t < .65 ? -2 + t * 5.5 : 1.575 - (t - .65) * 4;
    return base.entry + base.distance * (trend + .32 * Math.sin(i * 1.72 * step) + .16 * Math.cos(i * 3.11));
  });
  const low = Math.min(base.entry - base.distance * 2.7, ...levels);
  const high = Math.max(base.entry + base.distance * 3.3, ...levels);
  const spread = high - low;
  const min = low - spread * .10, max = high + spread * .10;
  const y = value => top + (max - value) / (max - min) * (bottom - top);
  const x = i => 20 + i / (n - 1) * (right - 40);
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="Synthetic ${play.instrument} ${play.timeframe} candles and planned levels. Not live data." style="font-family:Arial,sans-serif"><title>Sample ${play.instrument} chart, ${play.timeframe}. Edit levels using the numeric entry fields.</title><rect width="${width}" height="${height}" fill="${activeTheme.canvas}"/>`;
  for (let i = 0; i < 6; i++) {
    const value = min + (max - min) * (i + .5) / 6;
    svg += `<path d="M0 ${y(value)}H${right}" stroke="${activeTheme.border}" stroke-width=".6"/><text x="${width - 9}" y="${y(value) + 3}" text-anchor="end" fill="${activeTheme.muted}" font-size="9">${number(value, base.decimals)}</text>`;
  }
  for (let i = 0; i < 6; i++) {
    const xx = 20 + i / 5 * (right - 40);
    const label = play.timeframe === '1D' ? `Sep ${String(4 + i * 4).padStart(2, '0')}` : `${String(4 + i * 3).padStart(2, '0')}:00`;
    svg += `<path d="M${xx} 0V${bottom}" stroke="${activeTheme.border}" stroke-width=".6" stroke-dasharray="2 5"/><text x="${xx}" y="${height - 12}" fill="${activeTheme.muted}" text-anchor="middle" font-size="9">${label}</text>`;
  }
  if (valid && !aggregate) {
    const start = right * .55, zoneWidth = right - start;
    const farTarget = play.direction === 'long' ? Math.max(...entry.targets.map(t => t.price)) : Math.min(...entry.targets.map(t => t.price));
    svg += `<rect x="${start}" y="${Math.min(y(entry.price), y(farTarget))}" width="${zoneWidth}" height="${Math.abs(y(entry.price) - y(farTarget))}" fill="#7ab974" opacity=".09"/><rect x="${start}" y="${Math.min(y(entry.price), y(entry.stop))}" width="${zoneWidth}" height="${Math.abs(y(entry.price) - y(entry.stop))}" fill="#d07564" opacity=".10"/>`;
  }
  let ema = closes[0];
  const emaPoints = [];
  closes.forEach((close, i) => {
    const open = i ? closes[i - 1] : close - base.distance * .2;
    const candleHigh = Math.max(open, close) + base.distance * (.15 + .1 * Math.abs(Math.sin(i)));
    const candleLow = Math.min(open, close) - base.distance * (.15 + .1 * Math.abs(Math.cos(i)));
    const color = close >= open ? semanticColors.positive : semanticColors.negative;
    const candleWidth = Math.max(3, (right - 40) / n * .57);
    const volume = 8 + 20 * Math.abs(Math.sin(i * 2.3)) + 20 * Math.abs(close - open) / base.distance;
    svg += `<rect x="${x(i) - candleWidth / 2}" y="${bottom - volume}" width="${candleWidth}" height="${volume}" fill="${color}" opacity=".17"/><path d="M${x(i)} ${y(candleHigh)}V${y(candleLow)}" stroke="${color}" stroke-width="1"/><rect x="${x(i) - candleWidth / 2}" y="${Math.min(y(open), y(close))}" width="${candleWidth}" height="${Math.max(1, Math.abs(y(open) - y(close)))}" fill="${color}"/>`;
    ema = close * (2 / 21) + ema * (19 / 21);
    emaPoints.push(`${x(i)},${y(ema)}`);
  });
  svg += `<polyline points="${emaPoints.join(' ')}" fill="none" stroke="${semanticColors.warning}" stroke-width="1.2" opacity=".8"/>`;
  if (valid) {
    if (aggregate) shownEntries.forEach((item, i) => {
      const start = 20 + i / shownEntries.length * (right - 50);
      [{ price: item.stop, label: `E${i + 1} SL`, color: semanticColors.negative },
        ...item.targets.map((target, j) => ({ price: target.price, label: `E${i + 1} TP${j + 1}`, color: semanticColors.positive }))].forEach(level => {
        svg += `<g><title>${level.label}: ${number(level.price, base.decimals)} USD</title><path d="M${start} ${y(level.price)}H${right}" stroke="${level.color}" stroke-width=".7" stroke-dasharray="2 5" opacity=".45"/><circle cx="${start}" cy="${y(level.price)}" r="2.5" fill="${entryColor(item)}"/><text x="${start + 5}" y="${y(level.price) - 4}" fill="${level.color}" font-size="7">${level.label}</text></g>`;
      });
    });
    const tags = (aggregate ? [
      ...shownEntries.map((item, i) => ({ entryId: item.id, value: item.price, label: `ENTRY ${String(i + 1).padStart(2, '0')}`, color: entryColor(item) })),
      ...(position.average == null ? [] : [{ value: position.average, label: 'PLANNED AVG', color: activeTheme.text }]),
    ] : [
      ...entry.targets.map((target, i) => ({ value: target.price, label: `TP ${String(i + 1).padStart(2, '0')}`, color: semanticColors.positive })),
      { entryId: entry.id, value: entry.price, label: `ENTRY ${String(play.entries.indexOf(entry) + 1).padStart(2, '0')}`, color: entryColor(entry) },
      { value: entry.stop, label: 'STOP', color: semanticColors.negative },
    ]).sort((a, b) => b.value - a.value);
    // Offset labels when prices are close; leader lines keep their true levels explicit.
    let previous = top - 26;
    tags.forEach(tag => {
      tag.labelY = Math.max(y(tag.value), previous + 26);
      previous = tag.labelY;
    });
    let nextLabel = bottom + 14;
    [...tags].reverse().forEach(tag => { tag.labelY = Math.min(tag.labelY, nextLabel - 26); nextLabel = tag.labelY; });
    tags.forEach(tag => {
      const yy = y(tag.value), labelY = tag.labelY;
      if (tag.entryId) svg += `<g class="chart-level" data-plot-entry="${tag.entryId}" role="button" tabindex="0" aria-label="Select entry ${play.entries.findIndex(entry => entry.id === tag.entryId) + 1} on chart"><title>Select ${tag.label.toLowerCase()}</title><path d="M18 ${yy}H${right}" stroke="transparent" stroke-width="14" fill="none"/>`;
      svg += `<path d="M18 ${yy}H${right}" stroke="${tag.color}" stroke-width="${tag.entryId === selected ? 2 : 1}" stroke-dasharray="${tag.label.startsWith('ENTRY') ? '0' : '4 4'}" opacity=".8"/><circle cx="${right * .55}" cy="${yy}" r="3" fill="${activeTheme.canvas}" stroke="${tag.color}"/><path d="M${right} ${yy}L${right + 5} ${labelY}" stroke="${tag.color}" stroke-width=".7"/><rect class="level-label" x="${right + 5}" y="${labelY - 13}" width="80" height="26" rx="3" fill="${tag.color}"/><text x="${right + 11}" y="${labelY - 3}" fill="${semanticColors.labelInk}" font-size="6.5" font-weight="bold">${tag.label}</text><text x="${right + 11}" y="${labelY + 8}" fill="${semanticColors.labelInk}" font-size="10" font-weight="bold">${number(tag.value, base.decimals)}</text>`;
      if (tag.entryId) svg += '</g>';
    });
  }
  play.annotations.forEach(line => {
    svg += `<line x1="${line[0] * width}" y1="${line[1] * height}" x2="${line[2] * width}" y2="${line[3] * height}" stroke="${semanticColors.warning}" stroke-width="2" stroke-linecap="round"/>`;
  });
  svg += `<text x="18" y="${height - 39}" fill="${activeTheme.muted}" opacity=".45" font-size="15" font-weight="bold" letter-spacing="-1">vessel</text><text x="18" y="13" fill="${activeTheme.muted}" font-size="7" letter-spacing=".5">${play.instrument}/USD · ${play.timeframe} · ${play.direction.toUpperCase()} · SYNTHETIC</text></svg>`;
  $('chart').innerHTML = svg;
  $('selected-label').textContent = aggregate ? `ALL ${play.entries.length} ENTRIES · ENTRY ${String(play.entries.indexOf(entry) + 1).padStart(2, '0')} FOCUSED` : `ENTRY ${String(play.entries.indexOf(entry) + 1).padStart(2, '0')} SELECTED`;
  $('chart-hint').textContent = drawing ? 'Drag to draw a line. Annotations use chart-relative coordinates.' : valid ? 'Edit prices in the entry panel to move the chart levels.' : 'Fix the entry values to show planned levels.';
  $('undo').disabled = !play.annotations.length;
}

function renderJournal() {
  document.querySelectorAll('[data-tab]').forEach(button => {
    button.setAttribute('aria-selected', button.dataset.tab === tab);
    button.tabIndex = button.dataset.tab === tab ? 0 : -1;
  });
  $('journal-content').setAttribute('aria-labelledby', `tab-${tab}`);
  if (tab === 'thesis') {
    $('journal-content').innerHTML = `<div class="journal-fields"><label>Why this trade?<span>The thesis, in your own words.</span><textarea data-note="thesis" maxlength="10000">${escape(play.thesis)}</textarea></label><label>What invalidates it?<span>Know what would change your mind.</span><textarea data-note="invalidation" maxlength="10000">${escape(play.invalidation)}</textarea></label></div>`;
  } else if (tab === 'strategy') {
    const strategy = strategies[play.strategy];
    $('journal-content').innerHTML = `<div class="strategy-top"><label>Strategy version · sample library<select id="strategy">${Object.entries(strategies).map(([id, item]) => `<option value="${id}" ${id === play.strategy ? 'selected' : ''}>${item.name} ${item.version ? '· ' + item.version : ''}</option>`).join('')}</select></label></div><p class="strategy-copy">A hypothesis to test, not a proven edge. Compare these sample versions without changing the original thesis.</p><ul class="strategy-rules">${strategy.rules.map(rule => `<li>${escape(rule)}</li>`).join('')}</ul>`;
  } else if (tab === 'review') {
    $('journal-content').innerHTML = `<p class="journal-note">A winning trade can be a bad decision. Review the process separately from the outcome.</p><div class="review-fields"><label>Did you follow the plan?<select data-note="adherence"><option value="">Not reviewed yet</option><option value="yes">Yes</option><option value="partly">Partly</option><option value="no">No</option></select></label><label>Outcome · manual note<input data-note="result" maxlength="10000" value="${escape(play.result)}" placeholder="e.g. Stopped out, −1R"></label><label>What changed?<textarea data-note="changes" maxlength="10000" placeholder="A thesis change, a moved stop, an early exit…">${escape(play.changes)}</textarea></label><label>What will you take into the next play?<textarea data-note="lesson" maxlength="10000" placeholder="One specific lesson…">${escape(play.lesson)}</textarea></label></div>`;
    document.querySelector('[data-note=adherence]').value = play.adherence;
  } else {
    $('journal-content').innerHTML = play.captures.length
      ? `<p class="journal-note">Add the context behind each capture. Save draft keeps images and notes in this browser; PNG downloads include the notes.</p><div class="evidence-grid">${play.captures.map((capture, i) => `<div class="evidence-item"><img src="${escape(capture.src)}" alt="Sample chart capture ${i + 1}"><div><span>Capture ${String(i + 1).padStart(2, '0')}</span><button data-download-capture="${i}">Download with notes ↗</button><button data-remove-capture="${i}" aria-label="Remove capture ${i + 1}">×</button></div><label>What should you remember?<textarea data-capture-note="${i}" maxlength="2000" placeholder="What you saw, what changed, why you acted…" aria-label="Capture ${i + 1} notes">${escape(capture.note)}</textarea></label></div>`).join('')}</div>`
      : '<div class="evidence-empty"><span>▧</span><div><strong>Keep the context, not just the result.</strong><p>Capture the chart above, then add your notes here.</p><p>Save draft or export JSON to keep images and notes together.</p></div></div>';
  }
}

function renderAll() { renderContext(); renderEntries(); renderJournal(); }
function changed() { dirty(); renderAll(); }
function download(text, type, name) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement('a');
  link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function save() {
  if (budgetEditing) { notify('Save or cancel the budget edit before saving the draft.'); return; }
  if (!validDraft(play)) { notify('Check incomplete numeric inputs before saving.'); return; }
  try {
    localStorage.setItem(key, JSON.stringify(play));
    $('save-state').textContent = 'Saved in this browser';
    notify('Draft saved in this browser, including captures and their notes.');
  } catch { notify('Browser storage is unavailable. Use Export draft to keep your work.'); }
}

$('title').addEventListener('input', event => { play.title = event.target.value; dirty(); });
for (const field of ['portfolio', 'account', 'status']) $(field).addEventListener('change', event => {
  if (field === 'portfolio' || field === 'account') budgetEditing = false;
  play[field] = event.target.value;
  if (field === 'portfolio') play.account = accounts[play.portfolio][0].id;
  if (field === 'portfolio' || field === 'account') syncAccountBudget(play);
  changed();
});
$('instrument').addEventListener('change', event => {
  const old = instruments[play.instrument], next = instruments[event.target.value];
  play.entries.forEach(entry => {
    const convert = value => +(next.entry + (value - old.entry) / old.distance * next.distance).toFixed(next.decimals);
    entry.price = convert(entry.price); entry.stop = convert(entry.stop);
    entry.targets.forEach(target => { target.price = convert(target.price); });
  });
  play.instrument = event.target.value;
  play.annotations = [];
  changed(); notify('Sample prices translated to the new instrument. Drawings cleared.');
});
$('risk').addEventListener('input', event => {
  play.risk = event.target.value === '' ? NaN : Number(event.target.value);
  dirty(); renderCalculations();
  document.querySelectorAll('[data-risk]').forEach(button => button.setAttribute('aria-pressed', Number(button.dataset.risk) === play.risk));
});
$('leverage').addEventListener('input', event => {
  play.leverage = event.target.value === '' ? NaN : Number(event.target.value);
  syncLeverageControls();
  dirty(); renderCalculations();
});
$('edit-budget').addEventListener('click', () => budgetEditing ? saveBudgetEdit() : beginBudgetEdit());
$('add-optional-budget').addEventListener('click', beginBudgetEdit);
$('cancel-budget').addEventListener('click', cancelBudgetEdit);
$('margin-budget').addEventListener('keydown', event => {
  if (!budgetEditing) return;
  if (event.key === 'Enter') { event.preventDefault(); saveBudgetEdit(); }
  if (event.key === 'Escape') { event.preventDefault(); cancelBudgetEdit(); }
});
$('leverage-slider').addEventListener('input', event => {
  play.leverage = Number(event.target.value); $('leverage').value = play.leverage;
  syncLeverageControls(); dirty(); renderCalculations();
});
document.querySelectorAll('[data-leverage]').forEach(button => button.addEventListener('click', () => {
  play.leverage = Number(button.dataset.leverage); $('leverage').value = play.leverage;
  syncLeverageControls(); dirty(); renderCalculations();
}));
$('position-size').addEventListener('input', event => {
  play.positionSize = event.target.value === '' ? 0 : Number(event.target.value);
  dirty(); renderCalculations();
});
$('position-unit').addEventListener('change', event => {
  const position = calculate(play, account().equity, 'entered');
  if (position.errors.length) { event.target.value = play.sizeUnit; notify('Correct entry prices, shares and leverage before changing the size basis.'); return; }
  play.sizeUnit = event.target.value;
  play.positionSize = play.sizeUnit === 'quantity' ? position.quantity : position.margin;
  changed();
});
$('use-account-budget').addEventListener('click', () => {
  budgetEditing = false;
  play.budgetSource = 'account'; syncAccountBudget(play); changed();
  notify('Budget linked to the sample account value. Your committed position size is unchanged.');
});
$('equalize-entries').addEventListener('click', () => {
  equalize(play.entries); changed(); notify('Quantity shares split equally. The whole-position input stays fixed.');
});
$('chart-entry-legend').addEventListener('click', event => {
  const button = event.target.closest('[data-chart-entry]');
  if (button) {
    selectEntry(button.dataset.chartEntry);
    $('chart-entry-legend').querySelector(`[data-chart-entry="${selected}"]`)?.focus({ preventScroll: true });
  }
});
function selectPlotEntry(event) {
  const trigger = event.target.closest('[data-plot-entry]');
  if (!trigger || drawing) return;
  if (event.type === 'keydown' && !['Enter', ' '].includes(event.key)) return;
  event.preventDefault();
  selectEntry(trigger.dataset.plotEntry);
  if (event.type === 'keydown') $('chart').querySelector(`[data-plot-entry="${selected}"]`)?.focus();
}
$('chart').addEventListener('click', selectPlotEntry);
$('chart').addEventListener('keydown', selectPlotEntry);
$('apply-suggestion').addEventListener('click', () => {
  if (budgetEditing) return;
  if (!applySuggestion(play, account().equity)) return;
  changed();
  notify('Suggested total quantity and leverage applied. Your entry shares are unchanged.');
});
$('chart-view').addEventListener('change', event => {
  if (event.target.value === 'aggregate') play.chartMode = 'aggregate';
  else if (play.entries.some(entry => entry.id === event.target.value)) {
    play.chartMode = 'selected'; selectEntry(event.target.value);
  }
  dirty(); renderEntries();
});
document.querySelectorAll('[data-risk]').forEach(button => button.addEventListener('click', () => { play.risk = Number(button.dataset.risk); changed(); }));
for (const direction of ['long', 'short']) $(direction).addEventListener('click', () => {
  if (direction === play.direction) return;
  play.entries.forEach(entry => {
    entry.stop = 2 * entry.price - entry.stop;
    entry.targets.forEach(target => { target.price = 2 * entry.price - target.price; });
  });
  play.direction = direction; changed(); notify('Stops and targets mirrored for the new direction.');
});
document.querySelectorAll('[data-timeframe]').forEach(button => button.addEventListener('click', () => {
  play.timeframe = button.dataset.timeframe; play.annotations = []; changed();
  notify('Sample timeframe changed. Drawings cleared; no live data is loaded.');
}));
$('entry-list').addEventListener('input', event => {
  const input = event.target;
  if (!input.matches('input')) return;
  const entry = play.entries.find(item => item.id === input.closest('[data-entry]').dataset.entry);
  const value = input.value === '' ? NaN : Number(input.value);
  if (input.dataset.field === 'price') {
    if (entry.levelUnit === 'percent' && Number.isFinite(value) && value > 0 && entry.price > 0) {
      entry.stop = priceFromPercent(value, levelPercent(entry.price, entry.stop), play.direction, 'stop');
      entry.targets.forEach(target => { target.price = priceFromPercent(value, levelPercent(entry.price, target.price), play.direction, 'target'); });
    }
    entry.price = value;
  } else if (input.dataset.field === 'stop') {
    entry.stop = entry.levelUnit === 'percent' ? priceFromPercent(entry.price, value, play.direction, 'stop') : value;
  } else if (input.dataset.field) entry[input.dataset.field] = value;
  else {
    const target = entry.targets[Number(input.closest('[data-target]').dataset.target)];
    target[input.dataset.targetField] = input.dataset.targetField === 'price' && entry.levelUnit === 'percent' ? priceFromPercent(entry.price, value, play.direction, 'target') : value;
  }
  dirty(); renderCalculations();
});
$('entry-list').addEventListener('click', event => {
  const heading = event.target.closest('[data-select-entry]');
  if (heading && !event.target.closest('input,label,select,button:not(.entry-select)')) {
    selectEntry(heading.dataset.selectEntry);
    $('entry-list').querySelector(`[data-select="${selected}"]`)?.focus({ preventScroll: true });
    return;
  }
  const collapsed = event.target.closest('.entry-collapsed');
  if (collapsed) { selectEntry(collapsed.closest('[data-entry]').dataset.entry); return; }
  const button = event.target.closest('button');
  if (!button || button.disabled) return;
  const entry = play.entries.find(item => item.id === button.closest('[data-entry]').dataset.entry);
  if (button.dataset.select) { selectEntry(entry.id); return; }
  if (button.dataset.levelUnit) {
    if (levelErrors({ ...play, entries: [entry] }).length) { notify('Correct this entry’s prices before changing the level input mode.'); return; }
    entry.levelUnit = button.dataset.levelUnit; changed(); return;
  }
  if (button.dataset.removeEntry) {
    play.entries = play.entries.filter(item => item !== entry);
    if (selected === entry.id) selected = play.entries[0].id;
    equalize(play.entries);
  } else if (button.dataset.addTarget) {
    entry.targets.push({ price: +(entry.targets.at(-1).price + (play.direction === 'long' ? 1 : -1) * instruments[play.instrument].distance).toFixed(instruments[play.instrument].decimals), allocation: 0 });
    equalize(entry.targets);
  } else if (button.dataset.removeTarget !== undefined) {
    entry.targets.splice(Number(button.dataset.removeTarget), 1);
    equalize(entry.targets);
  }
  changed();
});
$('add-entry').addEventListener('click', () => {
  if (play.entries.length >= 8) return;
  const base = instruments[play.instrument], sign = play.direction === 'long' ? 1 : -1;
  const price = base.entry - sign * base.distance * .5 * play.entries.length;
  if (price <= 0) { notify('No more positive sample prices for this instrument.'); return; }
  const entry = { id: `e${Date.now()}-${play.entries.length}`, price, stop: price - sign * base.distance, allocation: 0, colorIndex: entryColors.findIndex((_, index) => !play.entries.some(entry => entry.colorIndex === index)), levelUnit: 'price', targets: [{ price: price + sign * base.distance * 3, allocation: 100 }] };
  play.entries.push(entry); equalize(play.entries); selected = entry.id; changed(); notify('Entry added. Quantity shares rebalanced equally; the full-position input stays fixed.');
});
document.querySelectorAll('[data-tab]').forEach(button => button.addEventListener('click', () => { tab = button.dataset.tab; renderJournal(); }));
document.querySelector('.journal-tabs').addEventListener('keydown', event => {
  const tabs = [...document.querySelectorAll('[data-tab]')];
  const current = tabs.findIndex(button => button.dataset.tab === tab);
  const index = event.key === 'ArrowRight' ? (current + 1) % tabs.length : event.key === 'ArrowLeft' ? (current + tabs.length - 1) % tabs.length : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : -1;
  if (index < 0) return;
  event.preventDefault(); tabs[index].click(); tabs[index].focus();
});
$('journal-content').addEventListener('input', event => {
  if (event.target.dataset.note) { play[event.target.dataset.note] = event.target.value; dirty(); }
  if (event.target.dataset.captureNote !== undefined) { play.captures[Number(event.target.dataset.captureNote)].note = event.target.value; dirty(); }
});
$('journal-content').addEventListener('click', async event => {
  const button = event.target.closest('button');
  if (button?.dataset.downloadCapture !== undefined) {
    try { await downloadCapture(Number(button.dataset.downloadCapture)); }
    catch { notify('Capture download failed. Your saved draft and notes are unchanged.'); }
  }
  if (button?.dataset.removeCapture !== undefined) {
    if (!confirm('Remove this capture and its notes from the current draft?')) return;
    play.captures.splice(Number(button.dataset.removeCapture), 1); dirty(); renderContext(); renderJournal();
  }
});
$('journal-content').addEventListener('change', event => {
  if (event.target.id === 'strategy') { play.strategy = event.target.value; changed(); }
});
$('save').addEventListener('click', save);
$('plan').addEventListener('click', () => {
  if (budgetEditing) return;
  const position = calculate(play, account().equity, 'entered');
  if (position.errors.length || !position.quantity) return;
  play.status = 'Planned'; changed(); save();
});
$('export').addEventListener('click', () => {
  if (budgetEditing) { notify('Save or cancel the budget edit before exporting.'); return; }
  if (!validDraft(play)) { notify('Check incomplete numeric inputs before exporting.'); return; }
  download(JSON.stringify({ ...play, prototype: true, exportedAt: new Date().toISOString(), note: 'Sample data. Includes captures and notes. Your position is user-entered planning data, not verified fills or a broker order.' }, null, 2), 'application/json', 'vessel-play.json');
  notify('Draft exported with captures and their notes.');
});
$('reset').addEventListener('click', () => {
  if (!confirm('Reset this workspace to sample data? The saved browser draft stays unchanged until you save again.')) return;
  budgetEditing = false;
  play = newPlay(); selected = play.entries[0].id;
  $('capture-count').textContent = '0'; changed(); notify('Sample restored. Save to replace your stored draft.');
});
$('help').addEventListener('click', () => $('about').showModal());
for (const id of ['close-about', 'close-about-done']) $(id).addEventListener('click', () => $('about').close());
$('draw').addEventListener('click', () => {
  drawing = !drawing; $('draw').setAttribute('aria-pressed', drawing); $('chart').classList.toggle('drawing', drawing); renderChart();
});
const point = event => {
  const rect = $('chart').getBoundingClientRect();
  return [Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)), Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height))];
};
$('chart').addEventListener('pointerdown', event => {
  if (!drawing || event.button !== 0) return;
  if (play.annotations.length >= 50) { notify('Prototype limit: 50 lines. Undo a line to draw another.'); return; }
  event.preventDefault(); drawStart = point(event); $('chart').setPointerCapture(event.pointerId);
});
$('chart').addEventListener('pointermove', event => {
  if (!drawStart) return;
  let line = $('chart').querySelector('#drawing-preview');
  if (!line) {
    line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.id = 'drawing-preview'; line.setAttribute('stroke', semanticColors.warning); line.setAttribute('stroke-width', '2');
    $('chart').querySelector('svg').append(line);
  }
  const end = point(event), width = $('chart').clientWidth, height = $('chart').clientHeight;
  for (const [key, value] of Object.entries({ x1: drawStart[0] * width, y1: drawStart[1] * height, x2: end[0] * width, y2: end[1] * height })) line.setAttribute(key, value);
});
$('chart').addEventListener('pointerup', event => {
  if (!drawStart) return;
  const end = point(event);
  if (Math.hypot(end[0] - drawStart[0], end[1] - drawStart[1]) > .005) { play.annotations.push([...drawStart, ...end]); dirty(); }
  drawStart = null; renderChart();
});
$('chart').addEventListener('pointercancel', () => { drawStart = null; renderChart(); });
$('undo').addEventListener('click', () => { play.annotations.pop(); dirty(); renderChart(); });
$('capture').addEventListener('click', async () => {
  if (play.captures.length >= 8) { notify('Prototype limit: eight captures. Remove a capture to add another.'); return; }
  const snapshotPlay = play;
  $('capture').disabled = true;
  try {
    const svg = $('chart').querySelector('svg').cloneNode(true);
    const viewBox = svg.viewBox.baseVal;
    svg.setAttribute('width', viewBox.width); svg.setAttribute('height', viewBox.height);
    const image = await loadImage(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(svg))}`);
    const canvas = document.createElement('canvas');
    const scale = Math.min(1, 1400 / image.width);
    canvas.width = Math.round(image.width * scale); canvas.height = Math.round(image.height * scale);
    canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
    if (play !== snapshotPlay) return;
    play.captures.push({ src: canvas.toDataURL('image/png'), note: '', at: new Date().toISOString() });
    dirty(); $('capture-count').textContent = play.captures.length;
    tab = 'evidence'; renderJournal(); notify('Chart captured. Add your context in Evidence, then Save draft.');
    if ($('chart-dialog').open) document.querySelector('.expanded-chart-header span').textContent = 'Captured. Close chart to add notes in Evidence.';
  } catch { notify('Chart capture failed. Your play is unchanged.'); }
  finally { $('capture').disabled = false; }
});

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image); image.onerror = reject; image.src = src;
  });
}

async function downloadCapture(index) {
  const capture = play.captures[index];
  const image = await loadImage(capture.src);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(600, image.width);
  const context = canvas.getContext('2d');
  context.font = '14px Arial';
  const lines = [];
  // Wrap by character as well as newline so long URLs or a single unbroken note fit.
  for (const paragraph of (capture.note || 'No additional notes.').split('\n')) {
    let line = '';
    for (const character of paragraph) {
      if (context.measureText(line + character).width > canvas.width - 48) { lines.push(line); line = ''; }
      line += character;
    }
    lines.push(line);
  }
  const imageHeight = Math.round(image.height * canvas.width / image.width);
  canvas.height = imageHeight + 84 + lines.length * 21;
  context.fillStyle = activeTheme.surface; context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, imageHeight);
  context.fillStyle = activeTheme.text; context.font = 'bold 14px Arial';
  context.fillText(`Vessel · Capture ${index + 1} · ${new Date(capture.at).toISOString()}`, 24, imageHeight + 30);
  context.font = '14px Arial';
  lines.forEach((line, i) => context.fillText(line, 24, imageHeight + 60 + i * 21));
  const link = document.createElement('a');
  link.href = canvas.toDataURL('image/png'); link.download = `vessel-chart-${index + 1}-with-notes.png`; link.click();
}
const chartAnchor = document.createComment('Chart returns here after the expanded view closes.');
$('chart-card').before(chartAnchor);
$('fullscreen').addEventListener('click', () => {
  if ($('chart-dialog').open) { $('chart-dialog').close(); return; }
  $('expanded-chart-mount').append($('chart-card'));
  document.querySelector('.expanded-chart-header span').textContent = 'Expanded view · Escape to close';
  $('fullscreen').setAttribute('aria-label', 'Close expanded chart');
  $('chart-dialog').showModal();
  renderChart();
});
$('close-chart').addEventListener('click', () => $('chart-dialog').close());
$('chart-dialog').addEventListener('close', () => {
  chartAnchor.after($('chart-card'));
  $('fullscreen').setAttribute('aria-label', 'Expand chart');
  $('fullscreen').focus(); renderChart();
});
const entryAnchor = document.createComment('Entry editor returns here after the expanded view closes.');
$('entry-list').before(entryAnchor);
$('expand-entry').addEventListener('click', () => {
  $('expanded-entry-mount').append($('entry-list'));
  renderChartView();
  $('entry-dialog').showModal();
});
function restoreEntryEditor() {
  if ($('entry-dialog').open) return;
  entryAnchor.after($('entry-list'));
  $('expand-entry').focus({ preventScroll: true });
}
function closeEntryEditor() {
  $('entry-dialog').close();
  // Restore synchronously as well as on the native close event, so a delayed
  // event never leaves the live editor inside a hidden dialog.
  restoreEntryEditor();
}
$('close-entry').addEventListener('click', closeEntryEditor);
$('entry-dialog').addEventListener('cancel', event => {
  event.preventDefault(); closeEntryEditor();
});
$('entry-dialog-select').addEventListener('change', event => selectEntry(event.target.value));
$('entry-dialog').addEventListener('close', restoreEntryEditor);
$('design-variant').innerHTML = themes.map((theme, i) => `<option value="${theme.id}">${String(i + 1).padStart(2, '0')} · ${theme.name}</option>`).join('');
function refreshDesignLabel() {
  $('design-variant').value = activeTheme.id;
  $('design-name').textContent = `Vessel / ${activeTheme.name} · Layout locked`;
  document.querySelector('meta[name=theme-color]').content = activeTheme.canvas;
}
$('design-variant').addEventListener('change', event => {
  activeTheme = applyTheme(event.target.value);
  const url = new URL(location.href); url.searchParams.set('theme', activeTheme.id); history.replaceState(null, '', url);
  refreshDesignLabel(); renderChart();
});
refreshDesignLabel();
new ResizeObserver(renderChart).observe($('chart'));
renderAll();
if (loadMessage) notify(loadMessage);
