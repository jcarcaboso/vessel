const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const themes = [{ id: 'graphite', scheme: 'dark' }, { id: 'paper', scheme: 'light' }]
const viewports = [{ id: 'desktop', width: 1440, height: 900 }, { id: 'mobile', width: 390, height: 844 }]
const pages = ['overview', 'plays-list', 'plays-editor', 'plays-manual', 'review', 'portfolios', 'accounts', 'account-detail', 'activity', 'settings']
const controls = ['entry-expanded', 'chart-expanded', 'level-popover', 'leverage-confirmation', 'evidence-marked', 'evidence-original', 'evidence-markup', 'execution', 'keyboard-tooltip']
const matrix = names => themes.flatMap(theme => viewports.flatMap(viewport => names.map(name => `${theme.id}-${viewport.id}-${name}.png`))).sort()
const expected = matrix([...pages, ...controls])

function validateReport(report, names = expected) {
  assert.deepEqual(report.errors, [], 'Console/page/network/readiness errors')
  assert.deepEqual(report.blocked, [], 'External or forbidden request attempted')
  assert.equal(report.shots.length, names.length, 'Capture count does not match matrix')
  assert.deepEqual(report.shots.map(shot => shot.file).sort(), names, 'Missing, duplicate or unexpected capture')
  for (const shot of report.shots) assert.equal(shot.overflow, 0, `Horizontal overflow: ${shot.file}`)
}

function comparisonInputs(before, after) {
  const read = dir => {
    const files = fs.readdirSync(dir).filter(file => file.endsWith('.png')).sort()
    assert.ok(files.length, `No PNG inputs in ${dir}`)
    for (const file of files) assert.ok(fs.statSync(path.join(dir, file)).size > 0, `Empty PNG: ${file}`)
    const report = JSON.parse(fs.readFileSync(path.join(dir, 'report.json'), 'utf8'))
    // The retained 40-page baseline remains comparable. New reports require all controls too.
    const names = report.matrix?.expected ?? matrix(pages)
    assert.deepEqual(names, report.matrix ? expected : matrix(pages), 'Unknown capture matrix')
    validateReport(report, names)
    assert.ok(report.status === 'passed' || (!report.matrix && report.status === undefined),
      'Capture report must have passed status; only legacy reports may omit it')
    assert.deepEqual(files, names, 'PNG files do not match capture report/matrix')
    return { files, report }
  }
  const first = read(before), second = read(after)
  assert.deepEqual(second.files, first.files, 'Before/after matrices differ')
  return { files: first.files, reports: [first.report, second.report] }
}

// Sum of absolute RGBA channel differences per pixel. Threshold is a tolerance, not equality.
function pixelMetrics(x, y, width, height, threshold = 24) {
  if (x.length !== y.length || x.length !== width * height * 4 || width <= 0 || height <= 0) throw new Error('Invalid pixel buffers')
  let exact = 0, tolerant = 0, totalDelta = 0, maxDelta = 0
  let exactTop = height, exactBottom = -1, toleranceTop = height, toleranceBottom = -1
  for (let i = 0; i < x.length; i += 4) {
    let delta = 0
    for (let channel = 0; channel < 4; channel++) delta += Math.abs(x[i + channel] - y[i + channel])
    const row = Math.floor(i / 4 / width)
    totalDelta += delta; maxDelta = Math.max(maxDelta, delta)
    if (delta > 0) { exact++; exactTop = Math.min(exactTop, row); exactBottom = Math.max(exactBottom, row) }
    if (delta > threshold) { tolerant++; toleranceTop = Math.min(toleranceTop, row); toleranceBottom = Math.max(toleranceBottom, row) }
  }
  return {
    exact: { changed: exact, ratio: exact / (width * height), rows: exact ? [exactTop, exactBottom] : null },
    tolerance: { threshold, changed: tolerant, ratio: tolerant / (width * height), rows: tolerant ? [toleranceTop, toleranceBottom] : null },
    meanAbsoluteChannelDelta: totalDelta / x.length, maxSummedRgbaDelta: maxDelta,
  }
}
function comparisonLabel(result) {
  const dimensionsEqual = result.before.join('x') === result.after.join('x')
  return `${result.exact.changed === 0 && dimensionsEqual ? 'pixel-identical' : `exact ${(result.exact.ratio * 100).toFixed(3)}% changed`}; ` +
    `tolerance >${result.tolerance.threshold}: ${(result.tolerance.ratio * 100).toFixed(3)}% changed` +
    (dimensionsEqual ? '' : `; dimensions ${result.before.join('x')} -> ${result.after.join('x')}`)
}
module.exports = { themes, viewports, pages, controls, matrix, expected, validateReport, comparisonInputs, pixelMetrics, comparisonLabel }
