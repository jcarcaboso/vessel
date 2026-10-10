// Shared SAMPLE state for the strategy shape prototypes. Disposable: nothing here is a
// product model, and every number is invented. Pages clone it, so edits stay per page.

// Rule kinds, in the order a trader walks through a setup.
export const KINDS = {
  context: { label: 'Context', hint: 'Where the setup is allowed to exist' },
  trigger: { label: 'Trigger', hint: 'What has to happen before you act' },
  entry: { label: 'Entry', hint: 'How you get in' },
  risk: { label: 'Risk', hint: 'Stop placement and size' },
  exit: { label: 'Exit', hint: 'Targets and management' },
  avoid: { label: 'Avoid', hint: 'When not to take it, even if everything else is there' },
};

// Strategies are generic: scope says what kind of market fits, never a concrete asset.
// `instruments` stays empty for the older idea pages; Plays carry the concrete asset.

// Owner-set stages. A stage is a decision with a reason, never computed from results.
export const STAGES = {
  idea: { label: 'Idea', hint: 'Written down, not used in Plays yet' },
  testing: { label: 'Testing', hint: 'Used in Plays to collect evidence' },
  inuse: { label: 'In use', hint: 'Owner decided to keep using it' },
  shelved: { label: 'Shelved', hint: 'Set aside for now' },
  retired: { label: 'Retired', hint: 'Stopped, with the reason kept' },
};

const rule = (id, kind, text, required = true) => ({ id, kind, text, required });

const reclaimBase = {
  thesis: {
    when: 'An established range is swept below its low and price closes back inside',
    expect: 'price tends to rotate back towards the middle of the range',
    because: 'stops below the low get taken, and late breakout sellers are trapped',
  },
  scope: { instruments: [], markets: 'Any liquid perpetual that has been ranging for days', direction: 'Long', timeframes: { setup: '4H', entry: '1H' }, regime: ['Range'], sessions: 'Any' },
  invalidation: 'Acceptance below the swept low. Do not widen the stop to justify an entry.',
};

export const strategies = [
  {
    id: 'reclaim', name: 'Range reclaim after a sweep', stage: 'testing', stageReason: 'Second revision; collecting plays on v3.', stageDate: '2026-09-24',
    created: '2026-08-02',
    reviewPlan: {
      predictions: ['Most valid setups reach mid-range before the stop', 'Entries on the retest get stopped less often than entries on the reclaim candle'],
      stopRule: 'Shelve it if 10 rule-following plays on one version show no edge over a coin flip, or if I keep breaking the retest rule.',
      checkEvery: 10,
    },
    examples: [
      { playId: 'P-030', kind: 'setup', caption: 'Clean: two touches each side, shallow sweep, retest fill.' },
      { playId: 'P-023', kind: 'counterexample', caption: 'Swept straight into a daily level and kept going.' },
    ],
    versions: [
      { n: 1, date: '2026-08-04', reason: 'First write-up after watching failed range breaks.', ...reclaimBase,
        rules: [
          rule('a', 'context', 'Range has at least two touches on each side'),
          rule('b', 'trigger', 'Price sweeps below the range low'),
          rule('c', 'entry', 'Enter on the close back inside the range'),
          rule('e', 'risk', 'Stop below the swept low, risk 0.5% of the account'),
        ] },
      { n: 2, date: '2026-08-30', reason: 'Two entries on the reclaim candle were stopped before any retest. Wait for the retest and write the exits down.', ...reclaimBase,
        rules: [
          rule('a', 'context', 'Range has at least two touches on each side'),
          rule('b', 'trigger', 'Price sweeps below the range low'),
          rule('c', 'trigger', 'A 4H candle closes back inside the range'),
          rule('d', 'entry', 'Limit at the retest of the range low, not the reclaim candle'),
          rule('e', 'risk', 'Stop below the swept low, risk 0.5% of the account'),
          rule('g', 'exit', 'Half at mid-range, rest at the range high; stop to entry after mid-range', false),
        ] },
      { n: 3, date: '2026-09-24', reason: 'Sweeps into a daily level and deep sweeps behaved differently. Exclude both, and stay out around news.', ...reclaimBase,
        rules: [
          rule('a', 'context', 'Range has at least two touches on each side'),
          rule('f', 'avoid', 'Skip if the sweep runs into a daily level'),
          rule('b', 'trigger', 'Sweep is shallower than 1.5× the 4H ATR'),
          rule('c', 'trigger', 'A 4H candle closes back inside the range'),
          rule('d', 'entry', 'Limit at the retest of the range low, not the reclaim candle'),
          rule('e', 'risk', 'Stop below the swept low, risk 0.5% of the account'),
          rule('g', 'exit', 'Half at mid-range, rest at the range high; stop to entry after mid-range', false),
          rule('h', 'avoid', 'No new entries within 2h of CPI or FOMC'),
        ] },
    ],
  },
  {
    id: 'funding', name: 'Funding-skew fade', stage: 'testing', stageReason: 'Open-interest condition added; needs more plays.', stageDate: '2026-09-18',
    created: '2026-08-18',
    reviewPlan: { predictions: ['Squeezes through the stop happen when open interest is still rising'], stopRule: 'Shelve after 8 plays on v2 if the open-interest filter removes almost every setup.', checkEvery: 8 },
    examples: [{ playId: 'P-024', kind: 'counterexample', caption: 'Shorted into strength; squeezed through the stop.' }],
    versions: [
      { n: 1, date: '2026-08-20', reason: 'Initial idea from crowded-long funding spikes.',
        thesis: { when: 'Funding is extremely positive and price stalls', expect: 'price mean-reverts over the next hours', because: 'crowded longs pay to hold and exit together' },
        scope: { instruments: [], markets: 'Perpetuals with an active funding market', direction: 'Short', timeframes: { setup: '1H', entry: '15m' }, regime: ['Trend', 'Range'], sessions: 'Any' },
        invalidation: 'A new high with funding still rising.',
        rules: [
          rule('a', 'context', 'Funding in the top 5% of the last 30 days'),
          rule('b', 'trigger', 'Price fails to make a new 1H high'),
          rule('c', 'risk', 'Stop above the local high, risk 0.5% of the account'),
        ] },
      { n: 2, date: '2026-09-18', reason: 'Added an open-interest condition after a squeeze ran through the stop.',
        thesis: { when: 'Funding is extremely positive, price stalls and open interest stops rising', expect: 'price mean-reverts over the next hours', because: 'crowded longs pay to hold and exit together' },
        scope: { instruments: [], markets: 'Perpetuals with an active funding market', direction: 'Short', timeframes: { setup: '1H', entry: '15m' }, regime: ['Trend', 'Range'], sessions: 'Any' },
        invalidation: 'A new high with funding still rising.',
        rules: [
          rule('a', 'context', 'Funding in the top 5% of the last 30 days'),
          rule('d', 'context', 'Open interest flat or falling over 4H'),
          rule('b', 'trigger', 'Price fails to make a new 1H high'),
          rule('c', 'risk', 'Stop above the local high, risk 0.5% of the account'),
        ] },
    ],
  },
  {
    id: 'breakout', name: 'Weekly level breakout retest', stage: 'shelved', stageReason: 'Too few clean weekly levels this quarter to test it.', stageDate: '2026-09-10',
    created: '2026-07-28',
    reviewPlan: { predictions: ['Retests of a clean weekly level hold more often than they fail'], stopRule: 'Retire if the first 6 rule-following plays show nothing.', checkEvery: 6 },
    examples: [],
    versions: [
      { n: 1, date: '2026-07-30', reason: 'First version.',
        thesis: { when: 'Price closes a day above a weekly level touched three times', expect: 'the first retest holds', because: 'former resistance becomes support for trapped shorts' },
        scope: { instruments: [], markets: 'Liquid perpetuals with obvious weekly levels', direction: 'Both', timeframes: { setup: '1D', entry: '4H' }, regime: ['Trend'], sessions: 'Any' },
        invalidation: 'A daily close back below the level.',
        rules: [
          rule('a', 'context', 'Weekly level touched at least three times'),
          rule('b', 'trigger', 'Daily close beyond the level'),
          rule('c', 'entry', 'Enter on the first retest'),
          rule('d', 'risk', 'Stop beyond the retest wick, risk 0.5% of the account'),
        ] },
    ],
  },
  {
    id: 'cpi', name: 'Fade the first CPI spike', stage: 'idea', stageReason: 'Written down after watching two prints.', stageDate: '2026-10-02',
    created: '2026-10-02',
    reviewPlan: { predictions: [], stopRule: '', checkEvery: 10 },
    examples: [],
    versions: [],
    working: {
      thesis: { when: 'The first 5-minute candle after CPI moves more than 1%', expect: 'price retraces part of the move within the hour', because: '' },
      scope: { instruments: [], markets: 'Majors that react to US macro releases', direction: 'Both', timeframes: { setup: '5m', entry: '1m' }, regime: [], sessions: 'US CPI release' },
      invalidation: '',
      rules: [rule('a', 'trigger', 'Wait for the first 5m candle to close')],
    },
  },
];

// Plays reference a strategy version. checks: rule id -> 'met' | 'broken' | 'na'; a missing id is unchecked.
// r is the result in planned-risk multiples, only for Closed plays. Sample numbers.
const all = (ids, over = {}) => Object.assign(Object.fromEntries(ids.map(i => [i, 'met'])), over);
const V1 = ['a', 'b', 'c', 'e'], V2 = ['a', 'b', 'c', 'd', 'e', 'g'], V3 = ['a', 'f', 'b', 'c', 'd', 'e', 'g', 'h'];
export const plays = [
  { id: 'P-012', title: 'BTC first reclaim', inst: 'BTC', dir: 'Long', status: 'Closed', s: 'reclaim', v: 1, date: '2026-08-06', r: -1.0, checks: all(V1), note: 'Stopped on the reclaim candle before any retest.' },
  { id: 'P-014', title: 'ETH sweep and reclaim', inst: 'ETH', dir: 'Long', status: 'Closed', s: 'reclaim', v: 1, date: '2026-08-10', r: 1.8, checks: all(V1) },
  { id: 'P-016', title: 'SOL "range" reclaim', inst: 'SOL', dir: 'Long', status: 'Closed', s: 'reclaim', v: 1, date: '2026-08-15', r: -1.0, checks: all(V1, { a: 'broken' }), note: 'The range was not really a range.' },
  { id: 'P-018', title: 'BTC reclaim close', inst: 'BTC', dir: 'Long', status: 'Closed', s: 'reclaim', v: 1, date: '2026-08-21', r: -1.1, checks: all(V1), note: 'Second stop before the retest. Prompted v2.' },
  { id: 'P-019', title: 'HYPE range reclaim', inst: 'HYPE', dir: 'Long', status: 'Closed', s: 'reclaim', v: 1, date: '2026-08-26', r: 2.4, checks: all(V1) },
  { id: 'P-021', title: 'ETH retest entry', inst: 'ETH', dir: 'Long', status: 'Closed', s: 'reclaim', v: 2, date: '2026-09-01', r: 1.6, checks: all(V2) },
  { id: 'P-022', title: 'BTC reclaim, no retest', inst: 'BTC', dir: 'Long', status: 'Cancelled', s: 'reclaim', v: 2, date: '2026-09-04', r: null, cancel: 'Missed', checks: all(V2, { d: 'na', e: 'na', g: 'na' }), note: 'No retest came; price ran without me.' },
  { id: 'P-023', title: 'SOL sweep into daily level', inst: 'SOL', dir: 'Long', status: 'Closed', s: 'reclaim', v: 2, date: '2026-09-07', r: -1.0, checks: all(V2), note: 'Valid by v2 but swept straight into a daily level. Prompted v3.' },
  { id: 'P-025', title: 'ETH early entry', inst: 'ETH', dir: 'Long', status: 'Closed', s: 'reclaim', v: 2, date: '2026-09-11', r: 0.9, checks: all(V2, { d: 'broken' }), note: 'Entered on the reclaim candle. Worked, but the rule was broken.' },
  { id: 'P-026', title: 'BTC deep sweep', inst: 'BTC', dir: 'Long', status: 'Closed', s: 'reclaim', v: 2, date: '2026-09-15', r: -1.0, checks: all(V2), note: 'Sweep was over 2× ATR. Prompted the depth limit.' },
  { id: 'P-027', title: 'HYPE early exit', inst: 'HYPE', dir: 'Long', status: 'Closed', s: 'reclaim', v: 2, date: '2026-09-18', r: 0.1, checks: all(V2, { g: 'broken' }), note: 'Closed everything at entry out of nerves.' },
  { id: 'P-028', title: 'BTC reclaim, lost the low', inst: 'BTC', dir: 'Long', status: 'Cancelled', s: 'reclaim', v: 2, date: '2026-09-20', r: null, cancel: 'Invalidated before entry', checks: all(V2, { d: 'na', e: 'na', g: 'na' }) },
  { id: 'P-030', title: 'ETH clean retest', inst: 'ETH', dir: 'Long', status: 'Closed', s: 'reclaim', v: 3, date: '2026-09-26', r: 2.1, checks: all(V3) },
  { id: 'P-031', title: 'SOL widened stop', inst: 'SOL', dir: 'Long', status: 'Closed', s: 'reclaim', v: 3, date: '2026-09-29', r: -1.4, checks: all(V3, { e: 'broken', g: 'na' }), note: 'Moved the stop lower mid-trade. Lost more than planned.' },
  { id: 'P-032', title: 'BTC range low retest', inst: 'BTC', dir: 'Long', status: 'Closed', s: 'reclaim', v: 3, date: '2026-10-01', r: 1.2, checks: all(V3) },
  { id: 'P-033', title: 'ETH reclaim near daily', inst: 'ETH', dir: 'Long', status: 'Cancelled', s: 'reclaim', v: 3, date: '2026-10-02', r: null, cancel: 'Chose not to take', checks: all(V3, { d: 'na', e: 'na', g: 'na' }), note: 'Skipped: daily level 0.3% below the sweep.' },
  { id: 'P-034', title: 'BTC range reclaim', inst: 'BTC', dir: 'Long', status: 'Open', s: 'reclaim', v: 3, date: '2026-10-03', r: null, checks: all(['a', 'f', 'b', 'c', 'd', 'e', 'h']) },
  { id: 'P-035', title: 'HYPE reclaim watch', inst: 'HYPE', dir: 'Long', status: 'Planned', s: 'reclaim', v: 3, date: '2026-10-04', r: null, checks: { a: 'met', f: 'met', b: 'met' } },

  { id: 'P-020', title: 'BTC funding fade', inst: 'BTC', dir: 'Short', status: 'Closed', s: 'funding', v: 1, date: '2026-08-24', r: 1.3, checks: all(['a', 'b', 'c']) },
  { id: 'P-024', title: 'ETH funding fade', inst: 'ETH', dir: 'Short', status: 'Closed', s: 'funding', v: 1, date: '2026-09-02', r: -1.0, checks: all(['a', 'c'], { b: 'broken' }), note: 'Shorted into strength; squeezed.' },
  { id: 'P-029', title: 'SOL funding fade', inst: 'SOL', dir: 'Short', status: 'Cancelled', s: 'funding', v: 2, date: '2026-09-21', r: null, cancel: 'Invalidated before entry', checks: { a: 'met', d: 'broken' }, note: 'Open interest kept rising.' },
  { id: 'P-036', title: 'ETH funding fade', inst: 'ETH', dir: 'Short', status: 'Closed', s: 'funding', v: 2, date: '2026-09-30', r: 0.8, checks: all(['a', 'd', 'b', 'c']) },

  { id: 'P-008', title: 'BTC weekly breakout', inst: 'BTC', dir: 'Long', status: 'Closed', s: 'breakout', v: 1, date: '2026-08-01', r: 0.0, checks: all(['a', 'b', 'c', 'd']) },
  { id: 'P-011', title: 'ETH weekly retest', inst: 'ETH', dir: 'Long', status: 'Closed', s: 'breakout', v: 1, date: '2026-08-12', r: -1.0, checks: all(['a', 'b', 'd'], { c: 'broken' }), note: 'Chased the breakout instead of waiting for the retest.' },
];

export const clone = () => structuredClone({ strategies, plays });

// Helpers shared by the pages.
export const latest = s => s.versions.at(-1) ?? null;
export const versionOf = (s, n) => s.versions.find(v => v.n === n) ?? null;
export const definitionOf = s => latest(s) ?? s.working;
export function outcomeOf(p) {
  if (p.status === 'Cancelled') return 'No trade';
  if (p.status !== 'Closed') return 'In progress';
  return p.r > 0.2 ? 'Positive' : p.r < -0.2 ? 'Negative' : 'Flat';
}
// Process comes only from the per-rule checks, so it can never contradict them.
export function processOf(p, s) {
  const v = versionOf(s, p.v);
  if (!v) return 'Not reviewed';
  const vals = v.rules.map(r => p.checks[r.id]);
  if (vals.includes('broken')) return 'Deviated';
  if (vals.some(x => !x)) return p.status === 'Closed' || p.status === 'Cancelled' ? 'Not reviewed' : 'In progress';
  return 'Followed';
}
export const sampleNote = n => n < 10
  ? `n = ${n}. Too few plays to say anything about the hypothesis. Read the individual reviews instead.`
  : `n = ${n}. Descriptive counts only. Market conditions differed between plays.`;
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const thesisSentence = t => [t.when && `When ${lc(t.when)}`, t.expect && `, ${t.expect}`, t.because && `, because ${t.because}`].filter(Boolean).join('') + '.';
const lc = s => s.charAt(0).toLowerCase() + s.slice(1);
