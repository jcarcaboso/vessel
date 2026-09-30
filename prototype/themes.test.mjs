import test from 'node:test';
import assert from 'node:assert/strict';
import { themes, contrastRatio, themeContrastChecks, semanticColors, defaultTheme, applyTheme } from './themes.mjs';
import { entryColors } from './model.mjs';

test('ten distinct theme IDs and component combinations', () => {
  assert.equal(themes.length, 10);
  assert.equal(new Set(themes.map(theme => theme.id)).size, 10);
  assert.equal(new Set(themes.map(theme => `${theme.controls}/${theme.tabs}/${theme.buttons}/${theme.buttonRadius}`)).size, 10);
});
test('contrast reference calculations', () => {
  assert.equal(contrastRatio('#000000', '#ffffff'), 21);
  assert.equal(contrastRatio('#171a1f', '#171a1f'), 1);
});
for (const theme of themes) test(`${theme.name}: defined text/surface pairs meet 4.5:1`, () => {
  for (const { name, ratio } of themeContrastChecks(theme)) assert.ok(ratio >= 4.5, `${theme.name} ${name}: ${ratio.toFixed(2)}`);
});
test('chart entry tags have readable dark labels', () => {
  for (const color of entryColors) assert.ok(contrastRatio(color, semanticColors.labelInk) >= 4.5);
});
test('Graphite is the configurable default and unknown theme IDs use it', () => {
  assert.equal(defaultTheme, 'graphite');
  const mockRoot = { dataset: {}, style: { setProperty() {} } };
  assert.equal(applyTheme('unknown', mockRoot).id, 'graphite');
  assert.equal(mockRoot.dataset.theme, 'graphite');
  assert.equal(applyTheme('forest', mockRoot).id, 'forest');
});
