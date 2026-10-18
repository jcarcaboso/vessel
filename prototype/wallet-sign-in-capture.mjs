// Captures each state on wallet-sign-in.html. Uses an external Playwright install (PLAYWRIGHT_MODULE) and a
// throwaway static server over the repository root; it does not add a dependency or touch Vessel's API.
import { createServer } from 'node:http'
import { readFile, mkdir } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const out = path.join(root, 'docs/design/wallet-sign-in')
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright')
const types = { '.html': 'text/html', '.mjs': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' }

const server = createServer(async (req, res) => {
  const file = path.join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname))
  if (!file.startsWith(root)) { res.writeHead(403).end(); return }
  try { res.writeHead(200, { 'content-type': types[path.extname(file)] ?? 'application/octet-stream' }).end(await readFile(file)) }
  catch { res.writeHead(404).end() }
}).listen(0, '127.0.0.1')
await new Promise(resolve => server.once('listening', resolve))

const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) })
try {
  const page = await browser.newPage({ viewport: { width: 1300, height: 1000 }, deviceScaleFactor: 2 })
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('requestfailed', request => errors.push(`failed ${request.url()}`))
  await page.goto(`http://127.0.0.1:${server.address().port}/prototype/wallet-sign-in.html`, { waitUntil: 'networkidle' })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.evaluate(() => document.fonts.ready)
  await mkdir(out, { recursive: true })
  for (const element of await page.locator('[data-capture]').all()) {
    const name = await element.getAttribute('data-capture')
    await element.screenshot({ path: path.join(out, `${name}.png`) })
    console.log(`${name}.png`)
  }
  if (errors.length) throw new Error(errors.join('\n'))
} finally {
  await browser.close()
  server.close()
}
