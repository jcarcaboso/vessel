import test from 'node:test';
import assert from 'node:assert/strict';
import { accounts, newPlay, calculate, equalize, validDraft, levelPercent, priceFromPercent, suggestPosition, applySuggestion, migrateDraft, syncAccountBudget, capitalContext, entryColor, riskReference } from './model.mjs';

const near = (a, b) => assert.ok(Math.abs(a - b) < Math.max(1e-8, Math.abs(b) * 1e-10), `${a} != ${b}`);
const entered = play => calculate(play, 25000, 'entered');
const choose = (size = 1, unit = 'quantity', leverage = 1) => ({ ...newPlay(), positionSize: size, sizeUnit: unit, leverage });

test('one total quantity is distributed by entry shares', () => {
  const play = choose(4); play.entries[0].allocation = 25; play.entries[1].allocation = 75;
  const result = entered(play);
  assert.deepEqual(result.errors, []);
  near(result.quantity, 4); near(result.entries[0].quantity, 1); near(result.entries[1].quantity, 3);
  near(result.notional, 255000); near(result.average, 63750); near(result.risk, 4200); near(result.reward, 12600);
});
test('one margin input sets full exposure before distributing quantities', () => {
  const play = choose(2500, 'margin', 6), result = entered(play);
  near(result.margin, 2500); near(result.notional, 15000); near(result.average, 63960);
  near(result.quantity, 15000 / 63960);
  near(result.entries[0].quantity / result.quantity, .6);
  near(result.entries[1].quantity / result.quantity, .4);
  // Margin shares are not the same as quantity shares when prices differ.
  assert.notEqual(result.entries[0].margin / result.margin, .6);
});
test('risk-based suggestion preserves position shares and does not mutate state', () => {
  const play = newPlay(), original = structuredClone(play), result = suggestPosition(play, 25000);
  assert.deepEqual(play, original); assert.deepEqual(result.errors, []);
  near(result.quantity, 250 / 1120); near(result.risk, 250); near(result.reward, 750);
  near(result.entries[0].quantity / result.quantity, .6); assert.equal(result.leverage, 1);
});
test('suggestion uses lowest integer fitting the available budget', () => {
  const play = newPlay(); play.marginBudget = 2500;
  const suggestion = suggestPosition(play, 25000);
  assert.equal(suggestion.leverage, 6); assert.ok(suggestion.margin <= 2500);
  assert.ok(suggestion.notional / 5 > 2500);
});
test('explicit apply copies one total size and leverage, never changes shares', () => {
  const play = newPlay(); play.marginBudget = 2500;
  const shares = play.entries.map(e => e.allocation);
  assert.equal(applySuggestion(play, 25000), true);
  assert.equal(play.leverage, 6); assert.equal(play.sizeUnit, 'quantity');
  near(play.positionSize, 250 / 1120); near(entered(play).risk, 250);
  assert.deepEqual(play.entries.map(e => e.allocation), shares);
  assert.ok(play.entries.every(e => !Object.hasOwn(e, 'size')));
});
test('risk and available-budget changes do not overwrite the entered position', () => {
  const play = choose(2), before = entered(play);
  play.risk = 3; play.marginBudget = 500; suggestPosition(play, 25000);
  assert.deepEqual(entered(play), before); assert.equal(play.positionSize, 2);
});
test('invalid assistant budget does not hide a valid entered position', () => {
  const play = choose(.1); play.risk = NaN; play.marginBudget = 0;
  assert.ok(suggestPosition(play, 25000).errors.length);
  assert.deepEqual(entered(play).errors, []);
  const before = structuredClone(play); assert.equal(applySuggestion(play, 25000), false); assert.deepEqual(play, before);
});
test('fixed margin leverage changes size and P&L, not exit levels', () => {
  const play = choose(2500, 'margin', 1), initial = entered(play), levels = structuredClone(play.entries);
  play.leverage = 10; const next = entered(play);
  near(next.quantity, initial.quantity * 10); near(next.risk, initial.risk * 10); near(next.reward, initial.reward * 10);
  near(next.margin, initial.margin); assert.deepEqual(play.entries, levels);
});
test('fixed quantity leverage changes margin only', () => {
  const play = choose(.25), initial = entered(play); play.leverage = 100;
  const next = entered(play); near(next.margin, initial.margin / 100);
  near(next.quantity, initial.quantity); near(next.risk, initial.risk); near(next.average, initial.average);
});
test('changing shares redistributes one total quantity without changing it', () => {
  const play = choose(2); play.entries[0].allocation = 20; play.entries[1].allocation = 80;
  const result = entered(play); near(result.quantity, 2); near(result.entries[0].quantity, .4); near(result.average, 63720);
});
test('zero quantity share contributes nothing to entry average or P&L', () => {
  const play = choose(2); play.entries[0].allocation = 0; play.entries[1].allocation = 100;
  const result = entered(play); near(result.entries[0].quantity, 0); near(result.average, 63600); near(result.risk, 2000);
});
test('planned weighted entry is visible before entering a total size', () => {
  const result = entered(newPlay()); assert.equal(result.quantity, 0); assert.equal(result.risk, 0); assert.equal(result.rr, null); near(result.average, 63960);
});
test('partial targets weight exit fractions within each quantity share', () => {
  const play = choose(1); play.entries[0].targets = [{ price: 65400, allocation: 50 }, { price: 67800, allocation: 50 }];
  const result = entered(play); near(result.reward, 2640); near(result.risk, 1120); near(result.rr, 2640 / 1120);
});
test('stop changes adjust entered risk but do not resize the position', () => {
  const play = choose(1); play.entries[0].stop = 63600;
  near(entered(play).risk, 760); near(entered(play).quantity, 1); near(suggestPosition(play, 25000).risk, 250);
});
for (const direction of ['long', 'short']) test(`${direction} price/percent round trip`, () => {
  const stop = priceFromPercent(100, 2, direction, 'stop'), target = priceFromPercent(100, 6, direction, 'target');
  near(stop, direction === 'long' ? 98 : 102); near(target, direction === 'long' ? 106 : 94);
  near(levelPercent(100, stop), 2); near(levelPercent(100, target), 6);
});
test('short and long mirrored prices have equal P&L scenarios', () => {
  const play = choose(1), before = entered(play); play.direction = 'short';
  play.entries.forEach(e => { e.stop = 2 * e.price - e.stop; e.targets.forEach(t => { t.price = 2 * e.price - t.price; }); });
  assert.deepEqual(entered(play), before);
});
for (const [name, mutate] of [
  ['stop at entry', p => { p.entries[0].stop = p.entries[0].price; }],
  ['wrong stop side', p => { p.entries[0].stop = 70000; }],
  ['wrong target side', p => { p.entries[0].targets[0].price = 60000; }],
  ['nonpositive price', p => { p.entries[0].price = 0; }],
  ['infinite price', p => { p.entries[0].price = Infinity; }],
  ['no entries', p => { p.entries = []; }],
  ['no targets', p => { p.entries[0].targets = []; }],
  ['wrong exit shares', p => { p.entries[0].targets[0].allocation = 80; }],
  ['wrong position shares', p => { p.entries[0].allocation = 50; }],
  ['negative share', p => { p.entries[0].allocation = -10; p.entries[1].allocation = 110; }],
  ['zero total share', p => { p.entries.forEach(e => { e.allocation = 0; }); }],
  ['NaN share', p => { p.entries[0].allocation = NaN; }],
  ['wrong direction', p => { p.direction = 'other'; }],
]) test(`reject ${name} for both suggested and entered sizing`, () => {
  const play = choose(1); mutate(play);
  for (const mode of ['entered', 'suggested']) { const result = calculate(play, 25000, mode); assert.ok(result.errors.length); assert.equal(result.risk, null); }
});
for (const leverage of [0, -1, 101, 1.5, NaN, Infinity]) test(`reject invalid leverage ${leverage}`, () => {
  const play = choose(1); play.leverage = leverage;
  assert.ok(entered(play).errors.length); assert.equal(entered(play).quantity, null);
});
for (const size of [-1, NaN, Infinity]) test(`reject invalid total size ${size}`, () => assert.ok(entered(choose(size)).errors.length));
for (const risk of [0, -1, 101, NaN, Infinity]) test(`reject invalid suggested risk ${risk}`, () => {
  const play = newPlay(); play.risk = risk; assert.ok(suggestPosition(play, 25000).errors.length);
});
test('impossible budget never partially applies a suggestion', () => {
  for (const budget of [0, -10, NaN, Infinity, 1]) {
    const play = newPlay(); play.marginBudget = budget; const before = structuredClone(play);
    assert.ok(suggestPosition(play, 25000).errors.length); assert.equal(applySuggestion(play, 25000), false); assert.deepEqual(play, before);
  }
});
test('a custom budget may exceed sample equity without rewriting its reference', () => {
  const play = choose(1000, 'margin', 2); play.budgetSource = 'manual'; play.marginBudget = 30000;
  assert.deepEqual(suggestPosition(play, 25000).errors, []);
  const capital = capitalContext(play, entered(play)); assert.equal(capital.account, 25000); assert.equal(capital.portfolio, 43000);
});
test('account-derived budget follows account selection and manual budget persists', () => {
  const play = newPlay(); assert.equal(play.marginBudget, 25000);
  play.account = 'quantfury'; syncAccountBudget(play); assert.equal(play.marginBudget, 18000);
  play.budgetSource = 'manual'; play.marginBudget = 5000;
  play.portfolio = 'intraday'; play.account = 'lighter'; syncAccountBudget(play); assert.equal(play.marginBudget, 5000);
  play.budgetSource = 'account'; syncAccountBudget(play); assert.equal(play.marginBudget, 10000);
});
test('margin and leveraged exposure use separate portfolio and account ratios', () => {
  const play = choose(4300, 'margin', 20), position = entered(play), context = capitalContext(play, position);
  near(context.portfolio, 43000); near(context.account, 25000);
  near(context.marginPercent, 10); near(context.exposurePercent, 200);
  near(context.accountMarginPercent, 17.2); near(context.accountExposurePercent, 344);
});
test('portfolio context sums only the selected portfolio accounts', () => {
  const play = newPlay(); play.portfolio = 'intraday'; play.account = 'lighter';
  assert.equal(capitalContext(play, entered(play)).portfolio, 10000);
  assert.equal(accounts.swing.length, 2);
});
test('invalid position propagates unknown ratios, not false zero exposure', () => {
  const play = choose(-1), context = capitalContext(play, entered(play));
  assert.equal(context.marginPercent, null); assert.equal(context.exposurePercent, null);
});
test('overflow and invalid reference equity produce errors', () => {
  assert.ok(calculate(newPlay(), 0).errors.length); assert.ok(calculate(newPlay(), Infinity).errors.length);
  assert.ok(entered(choose(1e308, 'margin', 100)).errors.length);
});
test('equal shares distribute three entries exactly', () => {
  const items = [{}, {}, {}]; equalize(items); assert.deepEqual(items.map(e => e.allocation), [33.33, 33.33, 33.34]);
});
function legacyV2() {
  const p = newPlay(); p.schemaVersion = 2; p.leverage = 6; p.marginBudget = 2500;
  delete p.positionSize; delete p.sizeUnit; delete p.budgetSource;
  p.entries.forEach((e, i) => { delete e.colorIndex; e.sizeUnit = i === 0 ? 'margin' : 'quantity'; e.size = i === 0 ? 1337.5 : .1; });
  p.thesis = 'Keep my original thesis';
  p.captures = [{ src: 'data:image/png;base64,aGVsbG8=', note: 'Keep this note', at: '2026-09-29T12:00:00.000Z' }];
  return p;
}
test('v2 migration preserves heterogeneous entered quantities, P&L and journal', () => {
  const old = legacyV2(), before = structuredClone(old), migrated = migrateDraft(old);
  assert.equal(validDraft(migrated), true); assert.deepEqual(old, before);
  assert.equal(migrated.sizeUnit, 'quantity'); near(migrated.positionSize, .225);
  const position = entered(migrated); near(position.entries[0].quantity, .125); near(position.entries[1].quantity, .1);
  near(position.notional, 14385); near(position.risk, 250); near(position.reward, 750); near(position.margin, 2397.5);
  assert.equal(migrated.thesis, old.thesis); assert.deepEqual(migrated.captures, old.captures);
  assert.equal(migrated.budgetSource, 'manual'); assert.equal(migrated.marginBudget, 2500);
});
test('v2 migration preserves a zero-size entry as zero share when others have size', () => {
  const old = legacyV2(); old.entries[0].size = 0;
  const p = migrateDraft(old); assert.equal(p.entries[0].allocation, 0); assert.equal(p.entries[1].allocation, 100); near(p.positionSize, .1);
});
test('v2 draft with no entered size remains empty with reviewable shares', () => {
  const old = legacyV2(); old.entries.forEach(e => { e.size = 0; });
  const p = migrateDraft(old); assert.equal(p.positionSize, 0); assert.equal(p.entries[0].allocation, 60); assert.equal(validDraft(p), true);
});
test('original unversioned draft keeps prices and notes without inventing position', () => {
  const old = legacyV2(); delete old.schemaVersion;
  old.entries.forEach(e => { delete e.size; delete e.sizeUnit; delete e.levelUnit; });
  const p = migrateDraft(old); assert.equal(validDraft(p), true); assert.equal(p.positionSize, 0); assert.equal(p.marginBudget, 25000);
  assert.equal(p.thesis, old.thesis); assert.equal(p.entries[0].price, old.entries[0].price);
});
test('malformed old drafts are not silently assigned a new valid position', () => {
  const old = legacyV2(); old.entries[0].size = undefined;
  assert.equal(validDraft(migrateDraft(old)), false);
});
test('entry colors stay attached to entries after deletion or selection', () => {
  const p = newPlay(), color = entryColor(p.entries[1]);
  p.entries.shift(); assert.equal(entryColor(p.entries[0]), color);
});
test('draft validation checks new position and color fields plus capture safety', () => {
  assert.equal(validDraft(newPlay()), true);
  for (const value of [null, {}, { ...newPlay(), entries: [null] }, { ...newPlay(), portfolio: '__proto__' }, { ...newPlay(), sizeUnit: 'unknown' }, { ...newPlay(), budgetSource: 'unknown' }, { ...newPlay(), annotations: [[0, 1, 2, 3]] }]) assert.equal(validDraft(value), false);
  const p = newPlay(); p.entries[1].colorIndex = p.entries[0].colorIndex; assert.equal(validDraft(p), false);
  p.entries[1].colorIndex = 1; p.captures = legacyV2().captures;
  assert.equal(validDraft(p), true); assert.deepEqual(JSON.parse(JSON.stringify(p)).captures, p.captures);
  p.captures[0].src = 'javascript:alert(1)'; assert.equal(validDraft(p), false);
});
test('unknown account balance leaves budget optional and entered position usable', () => {
  const play = choose(2500, 'margin', 2); play.portfolio = 'manual'; play.account = 'manual';
  syncAccountBudget(play);
  assert.equal(play.marginBudget, null); assert.equal(validDraft(play), true);
  const position = calculate(play, null, 'entered');
  assert.deepEqual(position.errors, []); near(position.notional, 5000); near(position.margin, 2500);
  const context = capitalContext(play, position);
  assert.equal(context.account, null); assert.equal(context.portfolio, null);
  assert.equal(context.marginPercent, null); assert.equal(context.exposurePercent, null);
  assert.ok(suggestPosition(play, null).errors.length);
});
test('optional manual budget supplies an explicit risk reference, not fake equity', () => {
  const play = choose(1000, 'margin'); play.portfolio = 'manual'; play.account = 'manual';
  play.budgetSource = 'manual'; play.marginBudget = 5000;
  const reference = riskReference(play, null);
  assert.deepEqual(reference, { value: 5000, label: 'manual budget' });
  const suggestion = suggestPosition(play, null);
  assert.deepEqual(suggestion.errors, []); near(suggestion.risk, 50);
  assert.equal(capitalContext(play, calculate(play, null, 'entered')).portfolio, null);
});
test('a missing budget remains absent through JSON persistence', () => {
  const play = newPlay(); play.marginBudget = null; play.budgetSource = 'manual';
  const roundtrip = JSON.parse(JSON.stringify(play));
  assert.equal(validDraft(roundtrip), true); assert.equal(roundtrip.marginBudget, null);
  assert.equal(entered(roundtrip).errors.length, 0);
  assert.ok(suggestPosition(roundtrip, 25000).errors.length);
});
