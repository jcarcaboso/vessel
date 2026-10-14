// Selected image-markup outline probe for the October 14 frontend review.
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


  const browser = await chromium.launch({ headless:true, executablePath:process.env.CHROMIUM_PATH });
  const report={status:'running',sourceCommit,browser:browser.version(),errors:[],blocked:[],intercepted:{},shots:[]};
  try { for (const theme of themes) for (const viewport of viewports) {
    const context=await browser.newContext({viewport:{width:viewport.width,height:viewport.height},locale:'en-US',timezoneId:'UTC',reducedMotion:'reduce',serviceWorkers:'block'});
    const page=await context.newPage(), origin=new URL(base).origin;
    await page.clock.setFixedTime(frozen);
    await page.addInitScript(theme=>{localStorage.setItem('vessel.appearance',JSON.stringify({themeId:theme,custom:{},saved:[],draft:null}));localStorage.setItem('vessel.chart.preferences.v1',JSON.stringify({live:false,schemaVersion:2}))},theme.id);
    page.on('pageerror',e=>report.errors.push(redact(e.message)));
    page.on('console',m=>{if(m.type()==='error')report.errors.push(redact(m.text()))});
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
    await page.goto(base);await page.getByLabel('API token').fill(config.token);await page.getByRole('button',{name:'Connect',exact:true}).click();
    await page.getByRole('region',{name:'Overview summary',exact:true}).waitFor();
    await page.evaluate(()=>location.hash='plays');
    await page.getByRole('button',{name:'Open BTC trend continuation',exact:true}).click();
    await page.getByRole('region',{name:'Play draft workspace',exact:true}).waitFor();
    await page.getByRole('tab',{name:/^Evidence/}).click();
    await page.getByRole('button',{name:/^Open Image 1:/}).click();
    const dialog=page.getByRole('dialog');await dialog.getByRole('button',{name:'Edit marks',exact:true}).click();
    await dialog.getByRole('button',{name:'Select and move',exact:true}).click();
    const stage=dialog.locator('.markup-stage');await stage.scrollIntoViewIfNeeded();
    const box=await stage.boundingBox();assert.ok(box);
    await page.mouse.click(box.x+100/640*box.width,box.y+40/360*box.height);
    await page.waitForFunction(()=>!document.querySelector('[aria-label="Delete selected mark"]').disabled);
    const selection=await page.evaluate(()=>{
      const src=document.querySelector('[data-testid="markup-overlay"]').src;
      const svg=new DOMParser().parseFromString(decodeURIComponent(src.slice(src.indexOf(',')+1)),'image/svg+xml');
      return {stroke:svg.querySelector('rect[stroke-dasharray]')?.getAttribute('stroke'),token:getComputedStyle(document.documentElement).getPropertyValue('--chart-drawing').trim(),overflow:document.documentElement.scrollWidth>innerWidth};
    });
    assert.ok(selection.stroke);assert.equal(selection.overflow,false);
    if(process.env.VERIFY_THEME==='1')assert.equal(selection.stroke,selection.token,'Selection must use current theme token');
    await page.evaluate(async()=>{await document.fonts.ready;await Promise.all([...document.images].map(i=>i.decode()));await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))});
    const file=`${theme.id}-${viewport.id}-selected-markup.png`;
    await page.screenshot({path:path.join(out,file),animations:'disabled',caret:'hide'});
    report.shots.push({file,...selection});await context.close();
  }
  assert.deepEqual(report.errors,[]);assert.deepEqual(report.blocked,[]);assert.equal(report.shots.length,4);report.status='passed';
  }catch(e){report.status='failed';report.failure=redact(e.message);throw e}finally{await browser.close();fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2))}
  console.log('Selected-markup probe passed:',report.shots.length,'screenshots');
}
main().catch(e=>{console.error(e.message);process.exitCode=1});
