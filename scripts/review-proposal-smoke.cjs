// Run against the standalone Vite proposal. Uses an external Playwright install;
// does not add a production dependency or connect to Vessel's API.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright')
const assert = require('node:assert/strict')
const { mkdir } = require('node:fs/promises')
const path = require('node:path')

async function main() {
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
  })
  try {
    const page = await browser.newPage({ viewport: { width: 1512, height: 1120 }, deviceScaleFactor: 1, reducedMotion: 'reduce' })
    const errors = [], apiRequests = []
    page.on('pageerror', error => errors.push(error.message))
    page.on('request', request => { if (new URL(request.url()).pathname.startsWith('/api/')) apiRequests.push(request.url()) })
    await page.goto(process.env.REVIEW_PREVIEW_URL || 'http://127.0.0.1:5186/review-proposal.html', { waitUntil: 'networkidle' })
    await page.evaluate(() => document.fonts.ready)
    const out = path.resolve(__dirname, '../docs/design/portfolio-review')
    await mkdir(out, { recursive: true })
    const shot = async name => {
      await page.mouse.move(0, 0)
      await page.evaluate(() => window.scrollTo(0, 0))
      await page.screenshot({ path: path.join(out, name), fullPage: true })
    }
    await shot('desktop-overview.png')
    for (const name of ['1D: Last 24 hours', '7D: Last 7 days', 'Month: Last 30 days', 'Year: Last 365 days', 'All: All recorded']) {
      const button = page.getByRole('button', { name, exact: true })
      await button.click()
      assert.equal(await button.getAttribute('aria-pressed'), 'true')
      const value = await button.locator('strong').innerText()
      assert.equal(await page.locator('.pr-breakdown-table tfoot td').nth(4).innerText(), value)
    }
    await page.getByRole('button', { name: 'Month: Last 30 days', exact: true }).click()
    await page.getByRole('button', { name: 'Assets', exact: true }).click()
    await page.getByRole('button', { name: 'Daily', exact: true }).click()
    await shot('desktop-assets.png')
    const assetClip = await page.evaluate(() => {
      const top = document.querySelector('.pr-insights').getBoundingClientRect()
      const bottom = document.querySelector('.pr-breakdown').getBoundingClientRect()
      return { x: top.left, y: top.top + scrollY, width: top.width, height: bottom.bottom - top.top }
    })
    await page.screenshot({ path: path.join(out, 'asset-breakdown.png'), fullPage: true, clip: assetClip })
    await page.getByRole('button', { name: 'Inspect HYPE', exact: true }).click()
    assert.equal(await page.getByRole('dialog').count(), 1)
    await page.screenshot({ path: path.join(out, 'asset-plays.png') })
    await page.keyboard.press('Escape')
    await page.getByRole('dialog').waitFor({ state: 'hidden' })
    await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'Inspect HYPE')
    assert.equal(await page.getByRole('button', { name: 'Inspect HYPE', exact: true }).evaluate(el => el === document.activeElement), true)

    await page.getByRole('combobox', { name: 'Account', exact: true }).selectOption('core')
    await page.getByRole('combobox', { name: 'Portfolio', exact: true }).selectOption('intraday')
    assert.equal(await page.getByRole('combobox', { name: 'Account', exact: true }).inputValue(), 'all')
    assert.equal(await page.getByRole('combobox', { name: 'Account', exact: true }).locator('option[value=core]').count(), 0)
    await page.getByRole('button', { name: 'Reset', exact: true }).click()
    await page.getByRole('combobox', { name: 'Portfolio', exact: true }).selectOption('swing')
    await page.getByRole('button', { name: 'Accounts', exact: true }).click()
    await page.getByRole('button', { name: 'P&L', exact: true }).click()
    await shot('portfolio-accounts.png')
    await page.getByRole('button', { name: 'Drawdown', exact: true }).click()
    assert.equal(await page.locator('.pr-chart h2').innerText(), 'Daily-closing drawdown')
    await page.getByRole('combobox', { name: 'Play origin', exact: true }).selectOption('imported')
    assert.match(await page.locator('.pr-outcome-details').innerText(), /N\/A/)

    await page.getByRole('button', { name: 'Reset', exact: true }).click()
    await page.getByRole('combobox', { name: 'Account', exact: true }).selectOption('satellite')
    await page.getByRole('combobox', { name: 'Asset', exact: true }).selectOption('HYPE')
    assert.equal(await page.getByText('No closed Plays in this selection', { exact: true }).count(), 1)
    assert.equal(await page.locator('.pr-chart-caption strong').innerText(), 'N/A')
    await page.getByRole('button', { name: 'Reset view', exact: true }).click()
    await page.getByRole('button', { name: 'Portfolios', exact: true }).click()

    const widths = [320, 390, 540, 768, 1024, 1280, 1512]
    for (const width of widths) {
      await page.setViewportSize({ width, height: 1000 })
      const geometry = await page.evaluate(() => {
        const rect = el => {
          const r = el.getBoundingClientRect()
          return { width: r.width, height: r.height, right: r.right, center: r.top + r.height / 2 }
        }
        return {
          viewport: innerWidth, document: document.documentElement.scrollWidth,
          filters: [...document.querySelectorAll('.pr-select')].map(el => ({
            select: rect(el.querySelector('select')), arrow: rect(el.querySelector('svg')),
          })),
          reset: rect(document.querySelector('.pr-reset')),
          segmented: [...document.querySelectorAll('.pr-segmented button')].map(rect),
        }
      })
      assert.ok(geometry.document <= geometry.viewport, `Document overflow at ${width}: ${JSON.stringify(geometry)}`)
      assert.ok(geometry.filters.every(({ select }) => select.width > 90), `Clipped filter at ${width}`)
      assert.ok(geometry.filters.every(({ select, arrow }) => Math.abs(select.center - arrow.center) < .5 && Math.abs(select.right - arrow.right - 12) < .5), `Misaligned dropdown arrow at ${width}`)
      assert.ok(geometry.filters.every(({ select }) => select.height === geometry.reset.height), `Unequal filter/Reset heights at ${width}`)
      if (width > 800) assert.ok(Math.abs(geometry.filters[0].select.center - geometry.reset.center) < .5, `Misaligned Reset button at ${width}`)
      assert.ok(geometry.segmented.every(button => button.height === 28), `Unequal segmented buttons at ${width}`)
      await page.getByRole('button', { name: 'Definitions', exact: true }).click()
      assert.ok(await page.getByRole('dialog').evaluate(el => {
        const r = el.getBoundingClientRect()
        return r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight
      }), `Dialog outside viewport at ${width}`)
      await page.keyboard.press('Escape')
    }
    await page.setViewportSize({ width: 390, height: 1000 })
    await page.getByRole('button', { name: 'P&L', exact: true }).click()
    await shot('mobile-overview.png')
    await page.screenshot({ path: path.join(out, 'mobile-first-screen.png') })
    assert.deepEqual(errors, [])
    assert.deepEqual(apiRequests, [])
    console.log(JSON.stringify({
      passed: true, widths, apiRequests, errors,
      checked: 'Period totals; all filters; asset/account breakdowns; daily/drawdown charts; missing risk; empty state; dialog bounds; Escape/focus return; responsive overflow; selector arrows and Reset alignment',
      captures: out,
    }, null, 2))
  } finally {
    await browser.close()
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
