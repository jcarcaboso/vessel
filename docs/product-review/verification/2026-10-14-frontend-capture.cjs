// Before/after screenshots of every page for the October 14 frontend review.
// Runs against the disposable capture stack in 2026-10-14-frontend.md: a built frontend served by
// Vite preview, proxying to a loopback API on an isolated synthetic database. Venue market data and
// every venue-touching route are fulfilled with synthetic data in the browser, and any other origin
// is aborted, so no venue is ever called. Playwright is supplied externally, never installed here.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const config = JSON.parse(fs.readFileSync(process.env.CAPTURE_CONFIG || '/tmp/vessel-fe-review/config.json', 'utf8'))
const fixture = JSON.parse(fs.readFileSync(process.env.CAPTURE_FIXTURE || '/tmp/vessel-fe-review/fixture.json', 'utf8'))
const base = process.env.CAPTURE_URL
const out = process.env.CAPTURE_OUT
assert.ok(base && out, 'Set CAPTURE_URL and CAPTURE_OUT')
fs.mkdirSync(out, { recursive: true })

// One frozen browser clock for every capture, after the seeded facts.
const frozen = new Date(Date.parse(fixture.seededAt) + 90 * 60_000)
const hour = 3_600_000
const lastOpen = Math.floor(frozen.getTime() / hour) * hour
const candles = Array.from({ length: 300 }, (_, i) => {
  const openTime = lastOpen - (299 - i) * hour
  const mid = 63_900 + 900 * Math.sin(i / 17) + 450 * Math.sin(i / 5.3) + i * 2.2
  const open = mid + 120 * Math.sin(i * 1.7)
  const close = mid + 120 * Math.sin(i * 1.7 + 1.1)
  const high = Math.max(open, close) + 60 + 40 * Math.abs(Math.sin(i * 2.3))
  const low = Math.min(open, close) - 60 - 40 * Math.abs(Math.cos(i * 1.9))
  const fixed = value => value.toFixed(1)
  return { openTime, closeTime: openTime + hour - 1, open: fixed(open), high: fixed(high), low: fixed(low), close: fixed(close),
    volume: (40 + 25 * Math.abs(Math.sin(i / 3))).toFixed(3), trades: 300 + i }
})
const catalogue = {
  venueId: 'hyperliquid', marketScope: 'perpetuals', scope: 'venue-perpetuals', notice: 'Synthetic capture catalogue.',
  instruments: [
    { contractId: 'BTC', quantityDecimals: 5, maxLeverage: 40, quoteAsset: 'USDC', priceStep: null, category: null, venueContractId: null, maintenanceMarginFraction: 0.0125 },
    { contractId: 'ETH', quantityDecimals: 4, maxLeverage: 25, quoteAsset: 'USDC', priceStep: null, category: null, venueContractId: null, maintenanceMarginFraction: 0.02 },
    { contractId: 'SOL', quantityDecimals: 2, maxLeverage: 20, quoteAsset: 'USDC', priceStep: null, category: null, venueContractId: null, maintenanceMarginFraction: 0.025 },
  ],
}
const market = instrument => ({ venueId: 'hyperliquid', instrument, markPrice: '64512.5', oraclePrice: '64498.1', midPrice: '64510',
  previousDayPrice: '63870', dayNotionalVolume: '1834567891.25', openInterest: '28450.125', fundingRate: '0.0000125', premium: '-0.0001',
  observedAt: frozen.toISOString(), notice: 'Synthetic capture market context.' })

const themes = [{ id: 'graphite', scheme: 'dark' }, { id: 'paper', scheme: 'light' }]
const viewports = [{ id: 'desktop', width: 1440, height: 900 }, { id: 'mobile', width: 390, height: 844 }]
const sectionIds = ['capital-context', 'workspace', 'chart-panel', 'journal-panel', 'position-panel', 'summary-panel']

async function main() {
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) })
  const report = { label: process.env.CAPTURE_LABEL || path.basename(out), base, frozen: frozen.toISOString(), shots: [], geometry: {},
    errors: [], blocked: [], intercepted: {} }
  try {
    for (const theme of themes) for (const viewport of viewports) {
      const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height }, deviceScaleFactor: 1,
        reducedMotion: 'reduce', colorScheme: theme.scheme })
      const page = await context.newPage()
      await page.clock.setFixedTime(frozen)
      await page.addInitScript(({ theme }) => {
        localStorage.setItem('vessel.appearance', JSON.stringify({ themeId: theme, custom: {}, saved: [], draft: null }))
        localStorage.setItem('vessel.chart.preferences.v1', JSON.stringify({ interval: '1h', favorites: ['5m', '1h', '4h', '1d'], magnet: false,
          live: false, drawingFavorites: ['trend-line', 'horizontal-line', 'fibonacci'], toolChoice: {}, schemaVersion: 2 }))
      }, { theme: theme.id })
      const tag = `${theme.id}/${viewport.id}`
      page.on('console', message => { if (message.type() === 'error') report.errors.push(`${tag}: ${message.text()}`) })
      page.on('pageerror', error => report.errors.push(`${tag}: ${error.message}`))
      const origin = new URL(base).origin
      await page.route(url => url.origin !== origin, route => { report.blocked.push(route.request().url()); return route.abort() })
      // Venue reads: synthetic market data. Venue writes or refreshes are refused before they reach the API.
      await page.route(/\/api\/accounts\/[^/]+\/(instruments|candles|market-context|market-stream|sync)(\?|$)/, async route => {
        const url = new URL(route.request().url())
        const kind = url.pathname.split('/').at(-1)
        report.intercepted[kind] = (report.intercepted[kind] ?? 0) + 1
        if (kind === 'sync') return route.fulfill({ status: 502, contentType: 'application/problem+json', body: '{"title":"Synthetic capture"}' })
        if (kind === 'market-stream') return route.fulfill({ status: 200, contentType: 'text/event-stream', body: '' })
        const instrument = url.searchParams.get('instrument') ?? 'BTC'
        const body = kind === 'instruments' ? catalogue : kind === 'market-context' ? market(instrument) : {
          venueId: 'hyperliquid', instrument, interval: url.searchParams.get('interval'), priceSource: 'trades',
          candles: url.searchParams.has('endTime') ? [] : candles, requestedFrom: candles[0].openTime, requestedTo: lastOpen + hour - 1,
          retrievedAt: frozen.toISOString(), historyExhausted: true, notice: 'Synthetic capture candles.' }
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
      })
      // The execution check refreshes the venue; answer it with the stored execution instead.
      await page.route(/\/api\/plays\/[^/]+\/execution\/check$/, async route => {
        report.intercepted.check = (report.intercepted.check ?? 0) + 1
        const response = await route.fetch({ url: route.request().url().replace(/\/check$/, ''), method: 'GET' })
        return route.fulfill({ response })
      })
      await page.route(/\/api\/venues\//, route => { report.intercepted.venues = (report.intercepted.venues ?? 0) + 1; return route.abort() })

      await page.goto(base)
      await page.getByLabel('API token').fill(config.token)
      await page.getByRole('button', { name: 'Connect', exact: true }).click()
      await page.getByRole('region', { name: 'Overview summary', exact: true }).waitFor()
      await page.evaluate(() => document.fonts.ready)

      const settle = async () => {
        await page.waitForFunction(() => !document.querySelector('[role="status"].workspace-loading, .pr-loading'), null, { timeout: 15_000 }).catch(() => {})
        await page.waitForTimeout(400)
      }
      const shot = async name => {
        await page.mouse.move(0, 0)
        await settle()
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
        const file = `${theme.id}-${viewport.id}-${name}.png`
        await page.screenshot({ path: path.join(out, file), fullPage: true })
        report.shots.push({ file, theme: theme.id, viewport: viewport.id, page: name, overflow })
      }
      const go = async hash => {
        await page.evaluate(target => { window.location.hash = target }, hash)
        await page.waitForTimeout(150)
      }

      await page.getByRole('table', { name: /Overview summary by/ }).waitFor().catch(() => {})
      await page.getByRole('button', { name: /^Open BTC trend continuation/ }).first().waitFor()
      await shot('overview')

      await go('plays')
      await page.getByRole('region', { name: 'Saved plays' }).waitFor()
      await page.getByRole('button', { name: 'Open BTC trend continuation', exact: true }).waitFor()
      await shot('plays-list')
      await page.getByRole('button', { name: 'Open BTC trend continuation', exact: true }).click()
      await page.getByRole('region', { name: 'Play draft workspace' }).waitFor()
      await page.locator('.candle-chart canvas').first().waitFor()
      await page.getByText(/Updated \d\d:\d\d:\d\d UTC/).first().waitFor()
      await page.waitForTimeout(800)
      report.geometry[tag] = await page.evaluate(ids => Object.fromEntries(ids.map(id => {
        const element = document.querySelector(`[data-testid="${id}"]`)
        if (!element) return [id, null]
        const box = element.getBoundingClientRect()
        return [id, { x: Math.round(box.x), y: Math.round(box.y + window.scrollY), width: Math.round(box.width), height: Math.round(box.height) }]
      })), sectionIds)
      await shot('plays-editor')
      await page.getByRole('button', { name: 'All plays', exact: true }).click()
      await page.getByRole('button', { name: 'Open ETH breakout retest', exact: true }).click()
      await page.getByRole('region', { name: 'Play draft workspace' }).waitFor()
      await page.locator('.chart-placeholder').waitFor()
      await shot('plays-manual')
      await page.getByRole('button', { name: 'All plays', exact: true }).click()

      await go('review')
      await page.getByRole('region', { name: 'Performance scorecard' }).waitFor()
      await shot('review')

      await go('portfolios')
      await page.locator('.portfolio-grid').waitFor()
      await shot('portfolios')

      await go('accounts')
      await page.getByRole('button', { name: 'View HL synthetic', exact: true }).waitFor()
      await shot('accounts')
      await page.getByRole('button', { name: 'View HL synthetic', exact: true }).click()
      await page.getByRole('heading', { name: 'Perpetual positions' }).waitFor()
      await shot('account-detail')

      await go('activity')
      await page.locator('.operations-table').waitFor()
      await shot('activity')

      await go('settings')
      await page.getByRole('heading', { name: 'Appearance', exact: true }).waitFor()
      await shot('settings')
      await context.close()
    }
  } finally {
    await browser.close()
    fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2))
  }
  console.log(`Captured ${report.shots.length} screenshots; errors ${report.errors.length}; blocked ${report.blocked.length}; intercepted ${JSON.stringify(report.intercepted)}`)
  const overflow = report.shots.filter(shot => shot.overflow > 0)
  if (overflow.length) console.log('Horizontal overflow:', overflow.map(shot => `${shot.file} ${shot.overflow}px`).join(', '))
  if (report.errors.length) console.log(report.errors.join('\n'))
  assert.deepEqual(report.blocked, [], 'An external request was attempted')
}

main().catch(error => { console.error(error); process.exitCode = 1 })
