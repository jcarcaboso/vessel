export const accounts = {
  swing: [
    { id: 'hyperliquid', name: 'Hyperliquid · Main', equity: 25000 },
    { id: 'quantfury', name: 'Quantfury · Swing', equity: 18000 },
  ],
  intraday: [{ id: 'lighter', name: 'Lighter · Intraday', equity: 10000 }],
  manual: [{ id: 'manual', name: 'Manual account · No balance', equity: null }],
};
export const instruments = {
  BTC: { entry: 64200, distance: 1200, decimals: 0 },
  ETH: { entry: 3200, distance: 80, decimals: 1 },
  SOL: { entry: 145, distance: 5, decimals: 2 },
};
export const strategies = {
  reclaim2: { name: 'Support reclaim', version: 'v2', rules: ['Sweep a previous low, then reclaim the level.', 'Wait for a retest with EMA confluence.', 'Invalidate below the sweep low. Do not chase.'] },
  reclaim1: { name: 'Support reclaim', version: 'v1', rules: ['Sweep a previous low, then reclaim the level.', 'Enter after the reclaim. Invalidate below the sweep low.'] },
  none: { name: 'No strategy', version: '', rules: ['An independent thesis, not linked to a strategy.'] },
};
export const defaultEntries = () => [
  { id: 'e1', colorIndex: 0, price: 64200, stop: 63000, allocation: 60, levelUnit: 'price', targets: [{ price: 67800, allocation: 100 }] },
  { id: 'e2', colorIndex: 1, price: 63600, stop: 62600, allocation: 40, levelUnit: 'price', targets: [{ price: 66600, allocation: 100 }] },
];
export const entryColors = ['#83b9dd', '#d9b36d', '#baa1df', '#80c5ad', '#df9b98', '#78c5cc', '#d3a0c4', '#b7c981'];
export const entryColor = entry => entryColors[entry.colorIndex];
export const newPlay = () => ({
  schemaVersion: 3, leverage: 1, marginBudget: 25000, budgetSource: 'account',
  positionSize: 0, sizeUnit: 'margin', chartMode: 'aggregate', captures: [],
  title: 'BTC reclaim at support', portfolio: 'swing', account: 'hyperliquid',
  instrument: 'BTC', direction: 'long', status: 'Draft', risk: 1, layout: 'side',
  strategy: 'reclaim2', timeframe: '4H', entries: defaultEntries(), annotations: [],
  thesis: 'Sweep of the previous low, then a reclaim of support. Waiting for a retest with EMA confluence.',
  invalidation: 'A sustained move below the sweep low. No chasing if price leaves without a retest.',
  adherence: '', result: '', lesson: '', changes: '',
});
export function equalize(items) {
  const share = Math.floor(10000 / items.length) / 100;
  items.forEach((item, i) => { item.allocation = i === items.length - 1 ? +(100 - share * i).toFixed(2) : share; });
}
const positive = value => Number.isFinite(value) && value > 0;
const totals100 = items => Math.abs(items.reduce((sum, item) => sum + item.allocation, 0) - 100) < 0.001;
export function syncAccountBudget(play) {
  if (play.budgetSource === 'account') play.marginBudget = accounts[play.portfolio].find(account => account.id === play.account).equity;
}
export function capitalContext(play, position) {
  const values = accounts[play.portfolio].map(account => account.equity);
  const portfolio = values.every(value => Number.isFinite(value) && value >= 0) ? values.reduce((sum, value) => sum + value, 0) : null;
  const account = accounts[play.portfolio].find(account => account.id === play.account).equity;
  const ratio = (value, base) => value != null && positive(base) ? value / base * 100 : null;
  return { portfolio, account,
    marginPercent: ratio(position.margin, portfolio), exposurePercent: ratio(position.notional, portfolio),
    accountMarginPercent: ratio(position.margin, account), accountExposurePercent: ratio(position.notional, account) };
}
export function riskReference(play, equity) {
  return positive(equity) ? { value: equity, label: 'account value' } :
    equity == null && positive(play.marginBudget) ? { value: play.marginBudget, label: 'manual budget' } :
    { value: null, label: 'unavailable' };
}
export const levelPercent = (price, level) => Math.abs(level - price) / price * 100;
export function priceFromPercent(price, percent, direction, kind) {
  const sign = (direction === 'long' ? 1 : -1) * (kind === 'stop' ? -1 : 1);
  return price * (1 + sign * percent / 100);
}

export function levelErrors(play) {
  const errors = [];
  if (!['long', 'short'].includes(play.direction)) errors.push('Choose a direction.');
  if (!play.entries.length) errors.push('Add at least one entry.');
  const sign = play.direction === 'long' ? 1 : -1;
  play.entries.forEach((entry, i) => {
    const name = `Entry ${i + 1}`;
    if (!positive(entry.price) || !positive(entry.stop)) errors.push(`${name}: prices must be positive.`);
    if (sign * (entry.price - entry.stop) <= 0) errors.push(`${name}: stop must be ${sign === 1 ? 'below' : 'above'} entry.`);
    if (!entry.targets.length || !totals100(entry.targets)) errors.push(`${name}: target exit allocations must total 100%.`);
    entry.targets.forEach((target, j) => {
      if (!positive(target.price) || sign * (target.price - entry.price) <= 0) errors.push(`${name}, target ${j + 1}: price must be ${sign === 1 ? 'above' : 'below'} entry and positive.`);
      if (!positive(target.allocation)) errors.push(`${name}, target ${j + 1}: exit allocation must be positive.`);
    });
  });
  return errors;
}

// The assistant and entered position share payoff math, but never share sizing state.
export function calculate(play, equity, mode = 'suggested') {
  const entered = mode === 'entered';
  const errors = levelErrors(play);
  const invalid = () => ({ errors, entries: [], risk: null, reward: null, rr: null, quantity: null, notional: null, margin: null, average: null });
  if (!totals100(play.entries)) errors.push('Entry shares must total 100% of the position.');
  play.entries.forEach((entry, i) => {
    if (!Number.isFinite(entry.allocation) || entry.allocation < 0 || entry.allocation > 100) errors.push(`Entry ${i + 1}: position share must be from 0% to 100%.`);
  });
  if (entered) {
    if (!Number.isInteger(play.leverage) || play.leverage < 1 || play.leverage > 100) errors.push('Leverage must be a whole number from 1× to 100×.');
    if (!Number.isFinite(play.positionSize) || play.positionSize < 0) errors.push('Total position size must be zero or positive.');
    if (!['margin', 'quantity'].includes(play.sizeUnit)) errors.push('Choose margin or quantity for the whole position.');
  } else {
    if (!positive(riskReference(play, equity).value)) errors.push('Risk sizing needs an account value or an optional manual budget.');
    if (!positive(play.risk) || play.risk > 100) errors.push('Play risk must be above 0% and no more than 100%.');
  }
  if (errors.length) return invalid();
  const budget = riskReference(play, equity).value * play.risk / 100;
  const sign = play.direction === 'long' ? 1 : -1;
  // Shares allocate quantity, not margin or independent per-entry risk budgets.
  const average = play.entries.reduce((sum, entry) => sum + entry.allocation / 100 * entry.price, 0);
  const riskPerUnit = play.entries.reduce((sum, entry) => sum + entry.allocation / 100 * Math.abs(entry.price - entry.stop), 0);
  const totalQuantity = entered
    ? play.sizeUnit === 'margin' ? play.positionSize * play.leverage / average : play.positionSize
    : budget / riskPerUnit;
  const entries = play.entries.map(entry => {
    const quantity = totalQuantity * entry.allocation / 100;
    const risk = quantity * Math.abs(entry.price - entry.stop);
    const reward = entry.targets.reduce((sum, target) => sum + quantity * target.allocation / 100 * sign * (target.price - entry.price), 0);
    const notional = quantity * entry.price;
    return { risk, quantity, reward, notional, margin: notional / (entered ? play.leverage : 1), rr: risk > 0 ? reward / risk : null };
  });
  const sum = key => entries.reduce((total, entry) => total + entry[key], 0);
  const result = { errors, entries, risk: sum('risk'), reward: sum('reward'), quantity: sum('quantity'), notional: sum('notional'), margin: sum('margin') };
  result.rr = result.risk > 0 ? result.reward / result.risk : null;
  // The configured quantity shares define a planned average even before size is entered.
  result.average = average;
  if (!entries.every(entry => Object.values(entry).every(value => value === null || Number.isFinite(value))) ||
      !Object.values(result).filter(value => typeof value === 'number').every(Number.isFinite)) {
    errors.push('Values are too large to calculate. Reduce prices or risk.');
    return invalid();
  }
  return result;
}

export function suggestPosition(play, equity) {
  const result = calculate(play, equity);
  const errors = [...result.errors];
  if (!positive(play.marginBudget)) errors.push('Available budget must be positive.');
  if (errors.length) return { ...result, errors, leverage: null };
  // Risk alone cannot determine leverage. Use the lowest integer fitting the chosen
  // margin budget, without pretending to model venue margin tiers or liquidation.
  const leverage = Math.max(1, Math.ceil(result.notional / play.marginBudget - 1e-12));
  if (leverage > 100) return { ...result, errors: ['This size needs more than 100× for that margin budget. Lower the risk budget or increase the margin budget.'], leverage: null };
  return { ...result, errors, leverage, margin: result.notional / leverage,
    entries: result.entries.map(entry => ({ ...entry, margin: entry.notional / leverage })) };
}

export function applySuggestion(play, equity) {
  const suggestion = suggestPosition(play, equity);
  if (suggestion.errors.length) return false;
  play.leverage = suggestion.leverage;
  play.sizeUnit = 'quantity'; play.positionSize = suggestion.quantity;
  return true;
}

export function migrateDraft(value) {
  if (!value || ![undefined, 2].includes(value.schemaVersion) || !Array.isArray(value.entries)) return value;
  const old = value.schemaVersion === 2;
  const leverage = old ? value.leverage : 1;
  const quantities = value.entries.map(entry => !old ? 0 : !entry ? NaN :
    entry.sizeUnit === 'margin' ? entry.size * leverage / entry.price : entry.size);
  const total = quantities.reduce((sum, quantity) => sum + quantity, 0);
  const migrated = { ...value, schemaVersion: 3, leverage, positionSize: total, sizeUnit: 'quantity',
    marginBudget: old ? value.marginBudget : 0, budgetSource: old ? 'manual' : 'account',
    chartMode: 'aggregate', captures: old ? value.captures : [],
    entries: value.entries.map((entry, i) => {
      if (!entry) return entry;
      const { size, sizeUnit, ...rest } = entry;
      return { ...rest, colorIndex: i, allocation: total > 0 ? quantities[i] / total * 100 : entry.allocation,
        levelUnit: old ? entry.levelUnit : 'price' };
    }) };
  if (Object.hasOwn(accounts, migrated.portfolio) && accounts[migrated.portfolio].some(account => account.id === migrated.account)) syncAccountBudget(migrated);
  return migrated;
}

// Browser storage can be edited externally. Reject malformed drafts before rendering.
export function validDraft(value) {
  if (!value || typeof value !== 'object') return false;
  if (value.schemaVersion !== 3 || !Number.isFinite(value.leverage) || (value.marginBudget !== null && !Number.isFinite(value.marginBudget)) ||
      !Number.isFinite(value.positionSize) || !['margin', 'quantity'].includes(value.sizeUnit) ||
      !['account', 'manual'].includes(value.budgetSource) ||
      !['selected', 'aggregate'].includes(value.chartMode)) return false;
  for (const [key, item] of Object.entries(newPlay())) {
    if (typeof item === 'string' && (typeof value[key] !== 'string' || value[key].length > 10000)) return false;
  }
  if (!Object.hasOwn(accounts, value.portfolio) ||
      !accounts[value.portfolio].some(account => account.id === value.account) ||
      !Object.hasOwn(instruments, value.instrument) || !Object.hasOwn(strategies, value.strategy) ||
      !['long', 'short'].includes(value.direction) || !['side', 'below'].includes(value.layout) ||
      !['1H', '4H', '1D'].includes(value.timeframe) ||
      !['Draft', 'Planned', 'Active', 'Closed', 'Cancelled'].includes(value.status) ||
      !['', 'yes', 'partly', 'no'].includes(value.adherence) || !Number.isFinite(value.risk)) return false;
  if (!Array.isArray(value.entries) || value.entries.length < 1 || value.entries.length > 8) return false;
  if (!value.entries.every(entry => entry && typeof entry.id === 'string' && /^[a-z0-9-]{1,60}$/.test(entry.id) &&
      ['price', 'stop', 'allocation'].every(key => Number.isFinite(entry[key])) &&
      Number.isInteger(entry.colorIndex) && entry.colorIndex >= 0 && entry.colorIndex < entryColors.length &&
      ['price', 'percent'].includes(entry.levelUnit) &&
      Array.isArray(entry.targets) && entry.targets.length > 0 && entry.targets.length <= 5 &&
      entry.targets.every(target => target && Number.isFinite(target.price) && Number.isFinite(target.allocation)))) return false;
  if (new Set(value.entries.map(entry => entry.id)).size !== value.entries.length) return false;
  if (new Set(value.entries.map(entry => entry.colorIndex)).size !== value.entries.length) return false;
  if (!Array.isArray(value.captures) || value.captures.length > 8 ||
      !value.captures.every(capture => capture && typeof capture.src === 'string' && capture.src.length < 2000000 &&
        /^data:image\/png;base64,[a-zA-Z0-9+/=]+$/.test(capture.src) &&
        typeof capture.note === 'string' && capture.note.length <= 2000 &&
        typeof capture.at === 'string' && Number.isFinite(Date.parse(capture.at)))) return false;
  return Array.isArray(value.annotations) && value.annotations.length <= 50 &&
    value.annotations.every(line => Array.isArray(line) && line.length === 4 && line.every(n => Number.isFinite(n) && n >= 0 && n <= 1));
}
