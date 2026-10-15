// Deterministic UI checks against the production SPA. The release runner separately
// verifies the real worker, admission, event stream and broker recovery.
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')

async function monitorFixture(page, accountId) {
  const now = new Date().toISOString()
  const issue = {
    id: '00000000-0000-4000-8000-0000000000d1', accountId, playId: null,
    contractId: 'BTC', kind: 'position.excess', severity: 'warning', state: 'open',
    openedAtUtc: now, confirmedAtUtc: now, resolvedAtUtc: null, dismissedAtUtc: null, note: null,
    details: { venueQuantity: '0.100000000000000001', playQuantity: '0.1' },
  }
  const monitor = {
    accountId, state: 'stale', lastAttemptAtUtc: now, lastSuccessAtUtc: now,
    nextRunAtUtc: null, manualState: 'idle', nextManualAllowedAtUtc: null, error: null,
    workerOnline: false, discrepancies: [issue],
  }
  let checks = 0, dismissals = 0, finishCheck, startCheck
  const checkStarted = new Promise(resolve => { startCheck = resolve })
  const json = (route, value, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(value) })
  await page.route('**/api/monitor', route => json(route, {
    workerOnline: monitor.workerOnline, heartbeatAtUtc: now, accounts: [monitor],
  }))
  await page.route(`**/api/accounts/${accountId}/monitor`, route => json(route, monitor))
  await page.route(`**/api/accounts/${accountId}/monitor/run`, async route => {
    assert.equal(route.request().method(), 'POST')
    checks++
    await new Promise(resolve => { finishCheck = resolve; startCheck() })
    monitor.workerOnline = true
    monitor.state = 'live'
    monitor.lastSuccessAtUtc = new Date().toISOString()
    monitor.nextRunAtUtc = new Date(Date.now() + 600_000).toISOString()
    monitor.nextManualAllowedAtUtc = new Date(Date.now() + 60_000).toISOString()
    await json(route, { requestId: '00000000-0000-4000-8000-0000000000c1', monitor }, 202)
  })
  await page.route(`**/api/accounts/${accountId}/discrepancies/${issue.id}/dismiss`, async route => {
    assert.equal(route.request().method(), 'POST')
    assert.equal(route.request().postDataJSON().note, 'Reviewed synthetic venue position')
    dismissals++
    issue.state = 'dismissed'
    issue.note = 'Reviewed synthetic venue position'
    issue.dismissedAtUtc = new Date().toISOString()
    await route.fulfill({ status: 204 })
  })
  return async pass => {
    const capture = async name => {
      if (!process.env.VESSEL_RELEASE_CAPTURE_DIR) return
      await fs.mkdir(process.env.VESSEL_RELEASE_CAPTURE_DIR, { recursive: true })
      await page.screenshot({ path: path.join(process.env.VESSEL_RELEASE_CAPTURE_DIR, name + '.png'), fullPage: true })
    }
    // Navigating and receiving events must not request venue checks.
    assert.equal(checks, 0)
    await page.getByRole('link', { name: 'Settings', exact: true }).click()
    await page.getByRole('button', { name: /^Graphite / }).click()
    await page.getByRole('link', { name: 'Accounts', exact: true }).click()
    await page.getByRole('button', { name: 'View Synthetic chart', exact: true }).click()
    const panel = page.getByRole('region', { name: 'Background monitor', exact: true })
    await panel.getByText('Worker offline.', { exact: false }).waitFor()
    await panel.getByText('Monitor stale', { exact: true }).waitFor()
    const warnings = page.getByRole('region', { name: 'Monitor discrepancies', exact: true })
    await warnings.getByText('Recorded details', { exact: true }).click()
    await warnings.getByText('0.100000000000000001', { exact: false }).waitFor()
    await capture('monitor-desktop-dark')
    pass('stored stale/offline monitor and exact discrepancy details render without automatic Check')

    await panel.getByRole('button', { name: 'Check', exact: true }).click()
    await panel.getByRole('button', { name: 'Checking…', exact: true }).waitFor()
    assert.ok(await panel.getByRole('button').isDisabled())
    await checkStarted
    assert.equal(checks, 1)
    finishCheck()
    await panel.getByRole('button', { name: /^Check in \d+s$/ }).waitFor()
    assert.ok(await panel.getByRole('button').isDisabled())
    assert.equal(checks, 1)
    pass('Check is explicit, blocked in flight and blocked during the server cooldown')

    await warnings.getByRole('textbox', { name: 'Dismissal note for position.excess BTC' }).fill('Reviewed synthetic venue position')
    await warnings.getByRole('button', { name: 'Dismiss', exact: true }).click()
    await warnings.getByText('warning · dismissed', { exact: true }).waitFor()
    assert.equal(dismissals, 1)
    assert.equal(await warnings.getByRole('button', { name: 'Dismiss', exact: true }).count(), 0)
    await warnings.getByText('It does not change executions or stop checks', { exact: false }).waitFor()
    pass('dismissal persists its note and explains that monitoring continues')

    await page.getByRole('link', { name: 'Settings', exact: true }).click()
    await page.getByRole('button', { name: /^Paper / }).click()
    await page.getByRole('link', { name: 'Accounts', exact: true }).click()
    await page.getByRole('button', { name: 'View Synthetic chart', exact: true }).click()
    await panel.waitFor()
    await capture('monitor-desktop-light')
    await page.setViewportSize({ width: 390, height: 844 })
    await panel.scrollIntoViewIfNeeded()
    assert.ok(await panel.isVisible())
    assert.ok(await panel.getByRole('button').isDisabled())
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
    await capture('monitor-mobile-light')
    assert.equal(checks, 1)
    pass('monitor controls remain visible at 390px in a light theme without horizontal page overflow')
  }
}

module.exports = monitorFixture
