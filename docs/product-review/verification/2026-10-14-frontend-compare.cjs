// Compares two capture folders from 2026-10-14-frontend-capture.cjs pixel by pixel in a headless page.
// Writes a diff image (changed pixels in magenta over a dimmed copy of the "after" shot) for every pair
// that differs, and a JSON summary. Playwright is supplied externally.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright')
const fs = require('node:fs')
const path = require('node:path')

const [before, after, out] = process.argv.slice(2)
if (!before || !after || !out) throw new Error('Usage: compare.cjs <before-dir> <after-dir> <diff-dir>')
fs.mkdirSync(out, { recursive: true })

async function main() {
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) })
  const page = await browser.newPage()
  const results = []
  const files = fs.readdirSync(before).filter(file => file.endsWith('.png')).sort()
  for (const file of files) {
    if (!fs.existsSync(path.join(after, file))) { results.push({ file, missing: true }); continue }
    const encode = dir => 'data:image/png;base64,' + fs.readFileSync(path.join(dir, file)).toString('base64')
    const result = await page.evaluate(async ({ a, b }) => {
      const load = src => new Promise((resolve, reject) => { const image = new Image(); image.onload = () => resolve(image); image.onerror = reject; image.src = src })
      const [first, second] = await Promise.all([load(a), load(b)])
      const width = Math.max(first.width, second.width), height = Math.max(first.height, second.height)
      const pixels = image => {
        const canvas = new OffscreenCanvas(width, height), context = canvas.getContext('2d')
        context.drawImage(image, 0, 0)
        return context.getImageData(0, 0, width, height).data
      }
      const x = pixels(first), y = pixels(second)
      const canvas = new OffscreenCanvas(width, height), context = canvas.getContext('2d')
      context.drawImage(second, 0, 0)
      const shown = context.getImageData(0, 0, width, height)
      let changed = 0, top = height, bottom = -1
      for (let i = 0; i < x.length; i += 4) {
        const delta = Math.abs(x[i] - y[i]) + Math.abs(x[i + 1] - y[i + 1]) + Math.abs(x[i + 2] - y[i + 2]) + Math.abs(x[i + 3] - y[i + 3])
        if (delta > 24) {
          changed++
          const row = Math.floor(i / 4 / width)
          top = Math.min(top, row); bottom = Math.max(bottom, row)
          shown.data[i] = 255; shown.data[i + 1] = 0; shown.data[i + 2] = 255; shown.data[i + 3] = 255
        } else {
          shown.data[i] = shown.data[i] * 0.35; shown.data[i + 1] = shown.data[i + 1] * 0.35; shown.data[i + 2] = shown.data[i + 2] * 0.35
        }
      }
      context.putImageData(shown, 0, 0)
      const blob = changed ? await canvas.convertToBlob({ type: 'image/png' }) : null
      const diff = blob ? btoa(String.fromCharCode(...new Uint8Array(await blob.arrayBuffer()))) : null
      return { before: [first.width, first.height], after: [second.width, second.height], changed, ratio: changed / (width * height),
        rows: changed ? [top, bottom] : null, diff }
    }, { a: encode(before), b: encode(after) })
    if (result.diff) fs.writeFileSync(path.join(out, file.replace('.png', '-diff.png')), Buffer.from(result.diff, 'base64'))
    delete result.diff
    results.push({ file, ...result })
  }
  await browser.close()
  fs.writeFileSync(path.join(out, 'summary.json'), JSON.stringify(results, null, 2))
  for (const item of results) {
    if (item.missing) console.log(`${item.file}: missing after`)
    else console.log(`${item.file}: ${item.changed ? `${(item.ratio * 100).toFixed(3)}% changed, rows ${item.rows.join('–')}` : 'identical'}` +
      `${item.before.join('x') !== item.after.join('x') ? `, size ${item.before.join('x')} → ${item.after.join('x')}` : ''}`)
  }
}

main().catch(error => { console.error(error); process.exitCode = 1 })
