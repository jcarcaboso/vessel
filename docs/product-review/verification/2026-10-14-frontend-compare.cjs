// Exact decoded-pixel equality and tolerance >24 summed RGBA differences are separate metrics.
// Diff PNGs highlight ALL exact differences, never mask server time or rendering changes.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { comparisonInputs, pixelMetrics, comparisonLabel } = require('./2026-10-14-frontend-capture-helpers.cjs')

async function main(before, after, out) {
  if (!before || !after || !out) throw new Error('Usage: compare.cjs <before-dir> <after-dir> <diff-dir>')
  if ([before, after].some(dir => path.resolve(dir) === path.resolve(out))) throw new Error('Diff output must not overwrite capture inputs')
  const { files, reports } = comparisonInputs(before, after)
  const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright')
  fs.mkdirSync(out, { recursive: true })
  assert.equal(fs.readdirSync(out).length, 0, 'Use a fresh diff directory; do not mix comparison runs')
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) })
  const results = []
  try {
    const page = await browser.newPage({ locale: 'en-US', timezoneId: 'UTC' })
    await page.addScriptTag({ content: `window.pixelMetrics = ${pixelMetrics.toString()}` })
    for (const file of files) {
      const encode = dir => 'data:image/png;base64,' + fs.readFileSync(path.join(dir, file)).toString('base64')
      const result = await page.evaluate(async ({ a, b }) => {
        const load = src => new Promise((resolve, reject) => { const image = new Image(); image.onload = () => resolve(image); image.onerror = () => reject(new Error('Invalid PNG input')); image.src = src })
        const [first, second] = await Promise.all([load(a), load(b)])
        const width = Math.max(first.width, second.width), height = Math.max(first.height, second.height)
        const pixels = image => {
          const canvas = new OffscreenCanvas(width, height), context = canvas.getContext('2d')
          context.drawImage(image, 0, 0)
          return context.getImageData(0, 0, width, height)
        }
        const x = pixels(first), shown = pixels(second), y = new Uint8ClampedArray(shown.data)
        const metrics = window.pixelMetrics(x.data, y, width, height)
        for (let i = 0; i < x.data.length; i += 4) {
          const changed = [0, 1, 2, 3].some(channel => x.data[i + channel] !== y[i + channel])
          if (changed) { shown.data[i] = 255; shown.data[i + 1] = 0; shown.data[i + 2] = 255; shown.data[i + 3] = 255 }
          else for (let channel = 0; channel < 3; channel++) shown.data[i + channel] *= 0.35
        }
        const canvas = new OffscreenCanvas(width, height), context = canvas.getContext('2d')
        context.putImageData(shown, 0, 0)
        const blob = metrics.exact.changed ? await canvas.convertToBlob({ type: 'image/png' }) : null
        const diff = blob ? await new Promise(resolve => {
          const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1]); reader.readAsDataURL(blob)
        }) : null
        return { before: [first.width, first.height], after: [second.width, second.height], ...metrics, diff }
      }, { a: encode(before), b: encode(after) })
      if (result.diff) fs.writeFileSync(path.join(out, file.replace('.png', '-diff.png')), Buffer.from(result.diff, 'base64'))
      delete result.diff
      results.push({ file, ...result })
      console.log(`${file}: ${comparisonLabel(result)}`)
    }
    fs.writeFileSync(path.join(out, 'summary.json'), JSON.stringify({
      browser: browser.version(), inputs: reports.map(report => ({ label: report.label, provenance: report.provenance ?? null, clock: report.clock ?? { browserOnlyFrozen: report.frozen, serverTime: 'unfrozen, not recorded by legacy tool' } })),
      note: 'Exact means decoded pixel equality, not PNG byte equality. Tolerance is not identity. All differences require investigation; no time regions are masked.', results,
    }, null, 2))
  } finally { await browser.close() }
}
if (require.main === module) main(...process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1 })
module.exports = { main }
