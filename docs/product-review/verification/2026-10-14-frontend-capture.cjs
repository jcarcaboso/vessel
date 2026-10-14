// Before/after screenshots of every page for the October 14 frontend review.
// Runs against the disposable capture stack in 2026-10-14-frontend.md: a built frontend served by
// Vite preview, proxying to a loopback API on an isolated synthetic database. Venue market data and
// venue-touching reads are intercepted in the browser, and external origins/refresh writes
// are aborted. API HTTP(S) uses the parent's verified unreachable proxy, not a firewall.
// Playwright is supplied externally, never installed here.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { execFileSync } = require('node:child_process')
const { themes, viewports, controls, expected, validateReport } = require('./2026-10-14-frontend-capture-helpers.cjs')

async function main() {
  const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright')

  const config = JSON.parse(fs.readFileSync(process.env.CAPTURE_CONFIG || '/tmp/vessel-fe-review/config.json', 'utf8'))
  const fixture = JSON.parse(fs.readFileSync(process.env.CAPTURE_FIXTURE || '/tmp/vessel-fe-review/fixture.json', 'utf8'))
  const base = process.env.CAPTURE_URL
  const out = process.env.CAPTURE_OUT
  assert.ok(base && out, 'Set CAPTURE_URL and CAPTURE_OUT')
  assert.equal(new URL(base).hostname, '127.0.0.1', 'Use only the disposable loopback stack')
  assert.equal(config.container, 'vessel-fe-review-20261014')
  assert.equal(config.db, 'vesselfe')
  assert.ok(typeof config.token === 'string' && config.token.length > 0, 'Missing disposable API token')
  assert.ok(process.env.CAPTURE_SOURCE_REF, 'Set CAPTURE_SOURCE_REF to the commit used to build the served frontend')
  const sourceCommit = execFileSync('git', ['rev-parse', `${process.env.CAPTURE_SOURCE_REF}^{commit}`], { encoding: 'utf8' }).trim()
  const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex')
  const redact = text => String(text).replaceAll(config.token, '[redacted]')
  fs.mkdirSync(out, { recursive: true })
  assert.equal(fs.readdirSync(out).filter(file => file.endsWith('.png')).length, 0, 'Use a fresh output directory; do not mix capture runs')

  // One frozen browser clock for every capture, after the seeded facts.
  const frozen = new Date(Date.parse(fixture.seededAt) + 90 * 60_000)
  assert.ok(Number.isFinite(frozen.getTime()), 'Invalid fixture seededAt')
  assert.ok(fixture.visualScenarios?.evidenceId, 'Run fixture.py --supplement before capturing controls')
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

  const sectionIds = ['capital-context', 'workspace', 'chart-panel', 'journal-panel', 'position-panel', 'summary-panel']

  const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) })
  const report = { label: process.env.CAPTURE_LABEL || path.basename(out), base, frozen: frozen.toISOString(), shots: [], geometry: {},
    errors: [], blocked: [], intercepted: {}, status: 'running', matrix: { expected, initialPageShots: 40, targetedShots: 36 },
    provenance: { sourceCommit, sourceClaim: 'Caller-specified build commit; served asset hashes recorded, not an independent build attestation',
      toolingCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
      toolingDirty: execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim() !== '',
      captureScriptSha256: sha(fs.readFileSync(__filename)), fixtureSha256: sha(fs.readFileSync(process.env.CAPTURE_FIXTURE || '/tmp/vessel-fe-review/fixture.json')), browserVersion: browser.version(),
      executablePath: process.env.CHROMIUM_PATH ?? chromium.executablePath(), playwrightVersion: require(path.join(path.dirname(require.resolve(process.env.PLAYWRIGHT_MODULE || 'playwright')), 'package.json')).version,
      locale: 'en-US', timezoneId: 'UTC', deviceScaleFactor: 1, reducedMotion: 'reduce', screenshotAnimations: 'disabled', screenshotCaret: 'hide', platform: process.platform, node: process.version, servedAssets: {},
      isolation: JSON.parse(fs.readFileSync(process.env.CAPTURE_ISOLATION || '/tmp/vessel-fe-review/runtime-isolation.json', 'utf8')) },
    clock: { browserDateOnly: frozen.toISOString(), timersFrozen: false, serverClockFrozen: false, evidenceCreatedAtServerUtc: fixture.visualScenarios.evidenceCreatedAtServerUtc,
      exceptions: ['Review asOfUtc and request-window dates use live server time.', 'Evidence creation time uses server time persisted by the synthetic supplement.'],
      masking: 'None. Server timestamps and all render/text differences stay visible and must be investigated.', reviewResponses: [] } }
  let activePage
  try {
    for (const theme of themes) for (const viewport of viewports) {
      const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height }, deviceScaleFactor: 1,
        reducedMotion: 'reduce', colorScheme: theme.scheme, locale: 'en-US', timezoneId: 'UTC', serviceWorkers: 'block' })
      const page = await context.newPage()
      activePage = page
      await page.clock.setFixedTime(frozen)
      await page.addInitScript(({ theme }) => {
        localStorage.setItem('vessel.appearance', JSON.stringify({ themeId: theme, custom: {}, saved: [], draft: null }))
        localStorage.setItem('vessel.chart.preferences.v1', JSON.stringify({ interval: '1h', favorites: ['5m', '1h', '4h', '1d'], magnet: false,
          live: false, drawingFavorites: ['trend-line', 'horizontal-line', 'fibonacci'], toolChoice: {}, schemaVersion: 2 }))
      }, { theme: theme.id })
      const tag = `${theme.id}/${viewport.id}`
      page.on('console', message => { if (message.type() === 'error') report.errors.push(redact(`${tag}: console: ${message.text()}`)) })
      page.on('pageerror', error => report.errors.push(redact(`${tag}: page: ${error.message}`)))
      const origin = new URL(base).origin
      const pendingResponses = new Set()
      page.on('response', response => {
        const url = new URL(response.url())
        if (response.status() >= 400) report.errors.push(`${tag}: HTTP ${response.status()} ${url.pathname}`)
        const task = (async () => {
          if (url.pathname === '/api/review') {
            const body = await response.json()
            report.clock.reviewResponses.push({ tag, asOfUtc: body.asOfUtc, fromUtc: body.fromUtc, observedAtRealUtc: new Date().toISOString() })
          } else if (url.origin === origin && !url.pathname.startsWith('/api/') && (/\.(js|css|woff2)$/.test(url.pathname) || url.pathname === '/')) {
            report.provenance.servedAssets[url.pathname] = sha(await response.body())
          }
        })().catch(error => report.errors.push(redact(`${tag}: response inspection ${url.pathname}: ${error.message}`)))
        pendingResponses.add(task)
        task.finally(() => pendingResponses.delete(task))
      })
      page.on('requestfailed', request => report.errors.push(`${tag}: request failed ${new URL(request.url()).pathname}: ${request.failure()?.errorText}`))
      await page.route('**/*', async route => {
        const request = route.request(), url = new URL(request.url())
        // Check origin FIRST, including requests whose paths resemble our synthetic handlers.
        if (url.origin !== origin || /^\/api\/venues\//.test(url.pathname)) {
          report.blocked.push(`${url.origin}${url.pathname}`)
          return route.abort()
        }
        const accountRead = /^\/api\/accounts\/[^/]+\/(instruments|candles|market-context|market-stream|sync)$/.exec(url.pathname)
        if (accountRead) {
          const kind = accountRead[1]
          report.intercepted[kind] = (report.intercepted[kind] ?? 0) + 1
          if (kind === 'sync' || request.method() !== 'GET') {
            report.blocked.push(`${request.method()} ${url.pathname}`)
            return route.abort()
          }
          if (kind === 'market-stream') return route.fulfill({ status: 200, contentType: 'text/event-stream', body: '' })
          const instrument = url.searchParams.get('instrument') ?? 'BTC'
          const body = kind === 'instruments' ? catalogue : kind === 'market-context' ? market(instrument) : {
            venueId: 'hyperliquid', instrument, interval: url.searchParams.get('interval'), priceSource: 'trades',
            candles: url.searchParams.has('endTime') ? [] : candles, requestedFrom: candles[0].openTime, requestedTo: lastOpen + hour - 1,
            retrievedAt: frozen.toISOString(), historyExhausted: true, notice: 'Synthetic capture candles.' }
          return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
        }
        if (/^\/api\/plays\/[^/]+\/execution\/check$/.test(url.pathname)) {
          report.intercepted.check = (report.intercepted.check ?? 0) + 1
          const response = await route.fetch({ url: request.url().replace(/\/check$/, ''), method: 'GET' })
          return route.fulfill({ response })
        }
        return route.continue()
      })

      await page.goto(base)
      await page.getByLabel('API token').fill(config.token)
      await page.getByRole('button', { name: 'Connect', exact: true }).click()
      await page.getByRole('region', { name: 'Overview summary', exact: true }).waitFor()
      await page.evaluate(() => document.fonts.ready)
      const environment = await page.evaluate(() => ({ userAgent: navigator.userAgent, locale: navigator.language, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone }))
      assert.equal(environment.locale, 'en-US')
      assert.equal(environment.timezone, 'UTC')
      report.provenance.browserEnvironment = environment

      const settle = async () => {
        await page.waitForFunction(() => !document.querySelector('.workspace-loading, .pr-loading, .plays-loading, [aria-busy="true"]') &&
          ![...document.querySelectorAll('.chart-state, .execution-panel [role="status"]')].some(el => /Loading|Checking/.test(el.textContent)), null, { timeout: 15_000 })
        await page.evaluate(async () => {
          let timer
          const ready = async () => {
            await document.fonts.ready
            await Promise.all([...document.images].map(image => image.decode()))
            await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
          }
          try {
            await Promise.race([ready(), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Font/image/frame readiness timed out')), 15_000) })])
          } finally { clearTimeout(timer) }
        })
        await Promise.all([...pendingResponses])
        await page.waitForFunction(() => !document.getAnimations().some(animation =>
          animation.playState === 'running' && animation.effect?.getComputedTiming().iterations !== Infinity), null, { timeout: 15_000 })
        await page.waitForTimeout(250)
        assert.deepEqual(report.errors, [], 'Browser/network errors before capture')
        assert.deepEqual(report.blocked, [], 'Forbidden requests before capture')
      }
      const shot = async (name, keepPointer = false) => {
        if (!keepPointer) await page.mouse.move(0, 0)
        await settle()
        const file = `${theme.id}-${viewport.id}-${name}.png`
        const layout = await page.evaluate(() => {
          const width = document.documentElement.clientWidth
          return { overflow: document.documentElement.scrollWidth - width,
            controls: [...document.querySelectorAll('[role="dialog"], .level-editor, [role="tooltip"]')].map(el => {
              const rect = el.getBoundingClientRect()
              return { name: el.getAttribute('aria-label') ?? el.getAttribute('role') ?? 'level-editor', left: rect.left, right: rect.right, width: rect.width }
            }).filter(rect => rect.width > 0),
          }
        })
        const { overflow } = layout
        for (const control of layout.controls) assert.ok(control.left >= -1 && control.right <= viewport.width + 1, `${file}: control outside viewport: ${control.name}`)
        assert.equal(overflow, 0, `${file}: horizontal overflow ${overflow}px`)
        // Full-page capture temporarily resizes the viewport. Keep the original page shots,
        // but capture dialogs/chart controls at their real viewport geometry.
        const fullPage = !controls.includes(name)
        await page.screenshot({ path: path.join(out, file), fullPage, animations: 'disabled', caret: 'hide' })
        report.shots.push({ file, theme: theme.id, viewport: viewport.id, page: name, fullPage, overflow, controls: layout.controls,
          renderedTextSha256: sha(await page.locator('body').innerText()),
          fontState: await page.evaluate(() => ({ status: document.fonts.status,
            loaded: [...document.fonts].filter(font => font.status === 'loaded').map(font => ({ family: font.family, weight: font.weight, style: font.style })) })),
          reviewServerTime: name === 'review' ? report.clock.reviewResponses.filter(item => item.tag === tag).at(-1) : undefined })
      }
      const go = async hash => {
        await page.evaluate(target => { window.location.hash = target }, hash)
        await page.waitForTimeout(150)
      }

      await page.getByRole('table', { name: /Overview summary by/ }).waitFor()
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
      assert.ok(Object.values(report.geometry[tag]).every(Boolean), 'Missing approved layout sections')

      await page.getByRole('button', { name: 'Expand selected entry', exact: true }).click()
      const entryDialog = page.getByRole('dialog', { name: 'Expanded entry editor', exact: true })
      await entryDialog.waitFor()
      await entryDialog.getByLabel('Entry 1 planned entry price (quote units)', { exact: true }).waitFor()
      await shot('entry-expanded')
      await page.keyboard.press('Escape')
      await entryDialog.waitFor({ state: 'hidden' })
      assert.equal(await page.getByRole('button', { name: 'Expand selected entry', exact: true }).evaluate(el => el === document.activeElement), true, 'Expanded entry focus was not restored')

      await page.getByRole('button', { name: 'Expand chart', exact: true }).click()
      const chartDialog = page.getByRole('dialog', { name: 'BTC chart', exact: true })
      await chartDialog.waitFor()
      await chartDialog.locator('.candle-chart canvas').first().waitFor()
      await shot('chart-expanded')

      // Find the entry's actual plot tag, beyond the 4px accent strips on exit tags.
      // Axis labels can be displaced to avoid collisions, so cannot locate a price in the plot.
      const chart = chartDialog.locator('.candle-chart')
      await chart.scrollIntoViewIfNeeded()
      await settle()
      const tagPoint = await chart.evaluate(element => {
        for (const canvas of element.querySelectorAll('canvas')) {
          const box = canvas.getBoundingClientRect(), parent = element.getBoundingClientRect()
          const context = canvas.getContext('2d')
          if (!context || canvas.width === 0 || box.width < 150 || Math.abs(box.x - parent.x) > 1) continue
          const x = Math.round(12 * canvas.width / box.width)
          const data = context.getImageData(x, 0, 1, canvas.height).data
          let run = 0
          for (let y = 0; y < canvas.height; y++) {
            const at = y * 4
            run = data[at] === 185 && data[at + 1] === 201 && data[at + 2] === 228 && data[at + 3] === 255 ? run + 1 : 0
            if (run >= 14) {
              const point = { x: 14, y: box.y - parent.y + (y - (run - 1) / 2) * box.height / canvas.height }
              const hit = document.elementFromPoint(parent.x + point.x, parent.y + point.y)
              if (hit?.tagName === 'CANVAS') return point
            }
          }
        }
        return null
      })
      assert.ok(tagPoint, 'Entry tag not rendered on chart')
      report.levelInteractions ??= {}
      report.levelInteractions[tag] = { tagPoint, chartBox: await chart.boundingBox() }
      await chart.click({ position: tagPoint })
      const levelEditor = page.getByRole('form', { name: 'Edit Entry 1', exact: true })
      await levelEditor.waitFor()
      report.levelInteractions[tag].editor = await levelEditor.getAttribute('aria-label')
      await levelEditor.getByLabel('Price', { exact: true }).fill('63810')
      await shot('level-popover')
      await levelEditor.getByRole('button', { name: 'Close level editor', exact: true }).click()
      await levelEditor.waitFor({ state: 'hidden' })
      await page.keyboard.press('Escape')
      await chartDialog.waitFor({ state: 'hidden' })
      await settle()

      // Percentage scenario stays in the browser draft; Cancel preserves leverage, and the
      // original price unit/value is restored before the remaining page-level captures.
      const targetUnits = page.getByRole('group', { name: 'Entry 1 target 2 units', exact: true })
      const targetPrice = page.getByLabel('Entry 1 planned target 2 price (quote units)', { exact: true })
      const originalTarget = await targetPrice.inputValue()
      await targetUnits.getByRole('button', { name: '% return at leverage', exact: true }).click()
      await page.getByLabel('Entry 1 planned target 2 return at 5× leverage (%)', { exact: true }).fill(fixture.visualScenarios.percentageLevel.value)
      const leverage = page.getByLabel('Leverage (×)', { exact: true })
      await leverage.fill('10')
      await leverage.press('Tab')
      const leverageDialog = page.getByRole('dialog', { name: 'Change leverage from 5× to 10×?', exact: true })
      await leverageDialog.waitFor()
      await leverageDialog.getByRole('button', { name: 'Keep prices', exact: true }).waitFor()
      await shot('leverage-confirmation')
      await leverageDialog.getByRole('button', { name: 'Cancel', exact: true }).click()
      await leverageDialog.waitFor({ state: 'hidden' })
      assert.equal(await leverage.inputValue(), '5')
      await targetUnits.getByRole('button', { name: 'Price', exact: true }).click()
      await page.getByLabel('Entry 1 planned target 2 price (quote units)', { exact: true }).fill(originalTarget)

      await page.getByRole('tab', { name: /^Evidence/ }).click()
      await page.getByRole('button', { name: /^Open Image 1:/ }).click()
      const evidenceDialog = page.getByRole('dialog')
      await evidenceDialog.waitFor()
      const marked = evidenceDialog.getByRole('button', { name: 'Marked', exact: true })
      assert.equal(await marked.getAttribute('aria-pressed'), 'true', 'Marked must be the default viewer state')
      await evidenceDialog.getByTestId('marks-overlay').waitFor()
      await shot('evidence-marked')
      await evidenceDialog.getByRole('button', { name: 'Original', exact: true }).click()
      await evidenceDialog.getByTestId('marks-overlay').waitFor({ state: 'hidden' })
      await shot('evidence-original')
      await marked.click()
      await evidenceDialog.getByRole('button', { name: 'Edit marks', exact: true }).click()
      await evidenceDialog.getByRole('toolbar', { name: 'Markup tools', exact: true }).waitFor()
      await evidenceDialog.locator('.markup-stage img:not(.markup-overlay)').waitFor()
      await evidenceDialog.getByTestId('markup-overlay').waitFor()
      await shot('evidence-markup')
      await evidenceDialog.getByRole('button', { name: 'Done', exact: true }).click()
      assert.equal(await marked.getAttribute('aria-pressed'), 'true')
      await page.keyboard.press('Escape')
      await evidenceDialog.waitFor({ state: 'hidden' })

      await page.getByRole('tab', { name: 'Execution', exact: true }).click()
      await page.locator('.execution-totals').waitFor()
      await page.locator('.execution-panel').scrollIntoViewIfNeeded()
      await shot('execution')
      await page.getByRole('tab', { name: 'Thesis', exact: true }).click()

      // Enter the chart using focus(), then navigate to its following toolbar action with Tab.
      // Preserve keyboard focus and hover the trigger to open its real Radix tooltip.
      const expandChart = page.getByRole('button', { name: 'Expand chart', exact: true })
      await expandChart.scrollIntoViewIfNeeded()
      await expandChart.focus()
      await page.keyboard.press('Shift+Tab')
      await page.keyboard.press('Tab')
      assert.equal(await expandChart.evaluate(el => el === document.activeElement && el.matches(':focus-visible')), true, 'Keyboard focus ring missing')
      await expandChart.hover()
      await page.getByRole('tooltip', { name: /Expand chart/ }).waitFor()
      await shot('keyboard-tooltip', true)
      await page.keyboard.press('Escape')
      await page.getByRole('button', { name: 'All plays', exact: true }).click()
      await page.getByRole('button', { name: 'Open ETH breakout retest', exact: true }).click()
      await page.getByRole('region', { name: 'Play draft workspace' }).waitFor()
      await page.locator('.chart-placeholder').waitFor()
      await shot('plays-manual')
      await page.getByRole('button', { name: 'All plays', exact: true }).click()
      await page.getByRole('button', { name: 'Open BTC trend continuation', exact: true }).waitFor()
      await settle()

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
    validateReport(report)
    assert.ok(Object.keys(report.provenance.servedAssets).length, 'No served source assets recorded')
    assert.equal(report.clock.reviewResponses.length, 4, 'Missing live server Review timestamps')
    report.status = 'passed'
  } catch (error) {
    report.status = 'failed'
    report.errors.push(redact(error.message))
    if (activePage && !activePage.isClosed()) {
      report.failureDiagnostic = await activePage.evaluate(() => ({ dialogs: [...document.querySelectorAll('[role="dialog"]')].map(el => el.textContent), forms: [...document.querySelectorAll('form')].map(el => el.getAttribute('aria-label')) }))
      await activePage.screenshot({ path: path.join(out, 'failure.png'), fullPage: false, animations: 'disabled' })
    }
    throw new Error(redact(error.message))
  } finally {
    await browser.close()
    if (report.errors.length || report.blocked.length) report.status = 'failed'
    fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2))
  }
  console.log(`Captured ${report.shots.length} screenshots; errors ${report.errors.length}; blocked ${report.blocked.length}; intercepted ${JSON.stringify(report.intercepted)}`)
  validateReport(report)
}

if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1 })
module.exports = { main }
