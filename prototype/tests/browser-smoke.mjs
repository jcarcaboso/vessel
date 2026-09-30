// Run from an isolated browser tab's console:
// await (await import('/tests/browser-smoke.mjs')).runSmokeChecks()
// Restores existing stored drafts; this intentionally exercises the sample UI.
export async function runSmokeChecks() {
  const $ = selector => document.querySelector(selector);
  const check = (condition, message) => { if (!condition) throw new Error(message); };
  const pause = () => new Promise(resolve => setTimeout(resolve, 40));
  const input = (selector, value, type = 'input') => {
    $(selector).value = value;
    $(selector).dispatchEvent(new Event(type, { bubbles: true }));
  };
  const click = selector => {
    check(!!$(selector), `Missing ${selector}`);
    if (typeof $(selector).click === 'function') $(selector).click();
    else $(selector).dispatchEvent(new MouseEvent('click', { bubbles: true }));
  };
  const selected = () => $('.entry-card.selected')?.dataset.entry;
  const visible = selector => $(selector)?.getClientRects().length > 0;
  const storedKey = 'vessel-prototype-01';
  const stored = localStorage.getItem(storedKey);
  const themePreference = localStorage.getItem('vessel-design');
  const originalConfirm = window.confirm;
  const results = [];
  const errors = [];
  const captureError = event => errors.push(event.message || String(event.reason));
  window.addEventListener('error', captureError);
  window.addEventListener('unhandledrejection', captureError);
  const test = async (name, run) => {
    await run(); await pause();
    check(!errors.length, `Browser errors: ${errors.join(', ')}`);
    results.push(name);
  };
  try {
    window.confirm = () => true;
    click('#reset');
    window.confirm = originalConfirm;
    input('#position-size', '2500');
    input('#leverage', '6');
    await test('Chart legend opens the corresponding editor without leaving aggregate', () => {
      const pageScroll = scrollY;
      click('[data-chart-entry=e2]');
      check(selected() === 'e2' && visible('#entry-details-e2') && !visible('#entry-details-e1'), 'Legend/editor selection mismatch');
      check($('#chart-view').value === 'aggregate', 'Aggregate unexpectedly changed');
      check(Math.abs(scrollY - pageScroll) < 1, 'Selection scrolled the page away from the chart');
    });
    await test('Full entry header and collapsed summary select the editor', () => {
      click('[data-entry=e1] .entry-heading');
      check(selected() === 'e1' && visible('#entry-details-e1'), 'Header background did not select entry');
      click('[data-entry=e2] .entry-collapsed');
      check(selected() === 'e2' && visible('#entry-details-e2'), 'Collapsed summary did not select entry');
      check($('[data-entry=e2] .entry-select').getAttribute('aria-expanded') === 'true', 'Expanded state not announced');
    });
    await test('Shares and removal controls do not accidentally change selection', () => {
      input('[data-entry=e1] [data-field=allocation]', '50');
      input('[data-entry=e2] [data-field=allocation]', '50');
      check(selected() === 'e2', 'Share input changed selection');
      check($('#errors').hidden, 'Balanced shares should calculate');
    });
    await test('Plotted levels, keyboard and dropdown use the same selected entry', () => {
      click('[data-plot-entry=e1] .level-label');
      check(selected() === 'e1' && visible('#entry-details-e1'), 'Plot/editor selection mismatch');
      $('[data-plot-entry=e2]').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      check(selected() === 'e2' && visible('#entry-details-e2'), 'Keyboard/editor selection mismatch');
      input('#chart-view', 'e1', 'change');
      check(selected() === 'e1' && visible('#entry-details-e1'), 'Dropdown/editor selection mismatch');
      input('#chart-view', 'aggregate', 'change');
    });
    await test('Expanded entry editor reuses the actual editor and persists changes', async () => {
      click('#expand-entry');
      check($('#entry-dialog').open && $('#expanded-entry-mount #entry-list'), 'Entry dialog did not receive the editor');
      check(document.querySelectorAll('#entry-list').length === 1, 'Duplicate entry editor');
      input('#entry-dialog-select', 'e2', 'change');
      check(selected() === 'e2' && visible('#entry-details-e2') && !visible('#entry-details-e1'), 'Expanded selection mismatch');
      input('[data-entry=e2] [data-field=stop]', '62500');
      click('[data-entry=e2] [data-add-target]');
      check(document.querySelectorAll('[data-entry=e2] .target-row').length === 2, 'Adding a target failed in expanded editor');
      click('#close-entry');
      await pause();
      check(!$('#entry-dialog').open && $('.entries-panel #entry-list'), 'Editor not returned to sidebar');
      check(document.activeElement === $('#expand-entry'), 'Expanded editor did not restore focus');
      check($('[data-entry=e2] [data-field=stop]').value === '62500', 'Modal edit lost on close');
      click('#save');
      const saved = JSON.parse(localStorage.getItem(storedKey));
      check(saved.entries[1].stop === 62500 && saved.entries[1].targets.length === 2, 'Modal edits were not saved');
      click('#expand-entry');
      $('#entry-dialog').dispatchEvent(new Event('cancel', { cancelable: true }));
      check(!$('#entry-dialog').open && $('.entries-panel #entry-list'), 'Escape/cancel did not restore editor');
      check(document.activeElement === $('#expand-entry'), 'Escape/cancel did not restore focus');
    });
    await test('Sidebar scroll is bounded and the journal meets it above the summary', () => {
      if (innerWidth <= 800) return;
      const panel = $('.entries-panel'), journal = $('.journal-card');
      const p = panel.getBoundingClientRect(), j = journal.getBoundingClientRect();
      check(Math.abs(p.bottom - j.bottom) < 2, 'Journal/sidebar bottoms are not aligned');
      check($('#journal-content').getBoundingClientRect().height >= 250, 'Journal remains too small');
      check(getComputedStyle(panel).overflowY === 'auto', 'Sidebar has no overflow control');
      const sizeBefore = $('.workspace').getBoundingClientRect().height;
      for (let i = 0; i < 6; i++) click('#add-entry');
      check(document.querySelectorAll('.entry-card').length === 8, 'Eight-entry fixture failed');
      check(panel.scrollHeight > panel.clientHeight, 'Long editor should scroll internally');
      check(Math.abs($('.workspace').getBoundingClientRect().height - sizeBefore) < 1, 'Entries increased workspace height');
      check(Math.abs(panel.getBoundingClientRect().bottom - journal.getBoundingClientRect().bottom) < 2, 'Long editor reintroduced gap');
    });
    await test('Graphite is configurable without layout or data changes across all themes', () => {
      const geometry = () => [...document.querySelectorAll('#chart-card,.journal-card,.entries-panel,.summary')]
        .map(element => { const r = element.getBoundingClientRect(); return [r.x, r.y, r.width, r.height]; });
      const before = geometry();
      const quantity = $('#position-size').value;
      for (const option of $('#design-variant').options) {
        input('#design-variant', option.value, 'change');
        const current = geometry();
        check(current.every((rect, i) => rect.every((value, j) => Math.abs(value - before[i][j]) < 1)), `${option.value} changed baseline geometry`);
        check($('#position-size').value === quantity, 'Theme switch changed sizing');
      }
      input('#design-variant', 'graphite', 'change');
      check(document.documentElement.dataset.theme === 'graphite', 'Graphite not selected');
    });
    await test('Budget remains read-only with deliberate save/cancel; unknown value stays optional', () => {
      check($('#margin-budget').readOnly, 'Budget should be read-only');
      click('#edit-budget'); input('#margin-budget', '5000'); click('#cancel-budget');
      check($('#margin-budget').value === '25000', 'Cancel lost original budget');
      click('#edit-budget'); input('#margin-budget', '4000'); click('#edit-budget');
      check($('#margin-budget').readOnly && $('#margin-budget').value === '4000', 'Budget override not locked');
      click('#use-account-budget');
      input('#portfolio', 'manual', 'change');
      check($('#margin-budget').value === '' && $('#account-value').textContent === '—', 'Unknown budget invented equity');
      check($('#errors').hidden, 'Entered sizing should not depend on unknown account value');
      check(!$('#add-optional-budget').hidden, 'Optional budget action missing');
      input('#portfolio', 'swing', 'change');
    });
    await test('Separate journal input, captures and summary still work', async () => {
      click('#tab-thesis');
      input('[data-note=thesis]', 'Baseline review: do not chase.');
      click('#tab-review'); input('[data-note=lesson]', 'Wait for confirmation.');
      click('#tab-thesis');
      check($('[data-note=thesis]').value === 'Baseline review: do not chase.', 'Journal tab switch lost thesis');
      click('#capture');
      for (let i = 0; i < 30 && !visible('[data-capture-note]'); i++) await pause();
      check(visible('[data-capture-note]'), 'Capture not created');
      input('[data-capture-note]', 'Notes remain attached to the captured chart.');
      click('#save');
      check(JSON.parse(localStorage.getItem(storedKey)).captures[0].note.includes('Notes remain attached'), 'Capture note not saved');
      check($('#summary-leverage').textContent === 'Leverage 6×', 'Summary leverage missing');
      check(document.documentElement.scrollWidth <= innerWidth, 'Horizontal overflow');
    });
    return { passed: results.length, checks: results, viewport: { width: innerWidth, height: innerHeight } };
  } finally {
    window.confirm = originalConfirm;
    window.removeEventListener('error', captureError);
    window.removeEventListener('unhandledrejection', captureError);
    if (stored == null) localStorage.removeItem(storedKey); else localStorage.setItem(storedKey, stored);
    if (themePreference == null) localStorage.removeItem('vessel-design'); else localStorage.setItem('vessel-design', themePreference);
  }
}
