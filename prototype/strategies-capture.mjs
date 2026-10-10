// Capture studio for the strategy shape prototype. Disposable.
// Draw on a Hyperliquid chart (any perpetual, public info API) or on an uploaded image, then keep the
// result as a strategy illustration. The tools mirror the app's chart drawings and markup editor
// (trend line, horizontal line, zone, long/short position, text, arrow, pen) plus a rule marker that
// ties a numbered pin to a rule of the strategy. Production should reuse the existing chart adapter,
// drawing model and evidence store instead of this canvas.

export const W = 960, H = 540;
const PAD = { l: 12, r: 74, t: 44, b: 30 };
export const INTERVALS = { '15m': 9e5, '1h': 36e5, '4h': 144e5, '1d': 864e5 };
export const COLORS = { red: '#ff5c5c', yellow: '#ffd23f', green: '#4ade80', blue: '#60a5fa', white: '#ffffff' };
const CANDLE_UP = '#e9edf2', CANDLE_DOWN = '#0f1114', CANDLE_EDGE = '#aeb7c4';
const HL = 'https://api.hyperliquid.xyz/info';
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ---------- data sources ---------- */
async function hl(body) {
  const r = await fetch(HL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`Hyperliquid answered ${r.status}`);
  return r.json();
}
let coinCache = null;
export async function hlCoins() {
  if (coinCache) return coinCache;
  const meta = await hl({ type: 'meta' });
  const names = meta.universe.filter(u => !u.isDelisted).map(u => u.name);
  const first = ['BTC', 'ETH', 'SOL', 'HYPE'].filter(n => names.includes(n));
  return (coinCache = [...first, ...names.filter(n => !first.includes(n)).sort()]);
}
export async function hlCandles(coin, interval, count = 300) {
  const step = INTERVALS[interval], end = Date.now();
  const rows = await hl({ type: 'candleSnapshot', req: { coin, interval, startTime: end - count * step, endTime: end } });
  return rows.map(k => ({ t: k.t, o: +k.o, h: +k.h, l: +k.l, c: +k.c }));
}

function mulberry32(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
// Synthetic candles for the sample illustrations only. Labelled as such on the image.
export function synth(pattern, seed = 7) {
  const r = mulberry32(seed), N = 96, step = INTERVALS['4h'], t0 = Date.UTC(2026, 7, 1), n = a => (r() - 0.5) * a;
  const closes = [], over = {};
  for (let i = 0; i < N; i++) {
    let c;
    if (pattern === 'trend-stall') {
      c = i < 58 ? 100 + i * 0.25 + 1.6 * Math.sin(i / 3) + n(0.8) : i < 72 ? 113.6 - (i - 58) * 0.06 + 1.3 * Math.sin(i / 2) + n(0.6) : 112.5 - (i - 72) * 0.32 + n(0.9);
    } else {
      if (i < 52) c = 105 + 4.3 * Math.sin(i / 4) + n(1);
      else if (i < 56) c = 103 - (i - 52) * 0.6;
      else if (pattern === 'reclaim') c = [99, 101.4, 102.2, 100.9, 101.8][i - 56] ?? Math.min(109.5, 101.8 + (i - 60) * 0.26 + n(1.1));
      else c = [95.2, 100.6, 100.2, 98.5, 97.2][i - 56] ?? Math.max(90.5, 97.2 - (i - 60) * 0.22 + n(0.9));
    }
    closes.push(c);
  }
  if (pattern === 'reclaim') { over[56] = { l: 97.8 }; over[59] = { l: 100.15 }; }
  if (pattern === 'deep') { over[56] = { l: 94.1 }; over[58] = { l: 99.6 }; }
  const candles = closes.map((c, i) => { const o = i ? closes[i - 1] : c - 0.4, h = Math.max(o, c) + Math.abs(n(1.1)) * 0.6, l = Math.min(o, c) - Math.abs(n(1.1)) * 0.6; return { t: t0 + i * step, o, h, l, c, ...over[i] }; });
  return { candles, step, t: i => t0 + i * step };
}

/* ---------- geometry ---------- */
function fitImage(img) { const s = Math.min(W / img.naturalWidth, H / img.naturalHeight), w = img.naturalWidth * s, h = img.naturalHeight * s; return { x: (W - w) / 2, y: (H - h) / 2, w, h }; }
export function makeMap(st) {
  if (st.mode === 'image') {
    const f = st.img ? fitImage(st.img) : { x: 0, y: 0, w: W, h: H };
    return { kind: 'image', f, x: p => f.x + p.u * f.w, y: p => f.y + p.v * f.h, inv: (X, Y) => ({ u: (X - f.x) / f.w, v: (Y - f.y) / f.h }), x0: f.x, x1: f.x + f.w };
  }
  const vis = st.candles.slice(st.start, st.start + st.count);
  let lo = Math.min(...vis.map(k => k.l)), hi = Math.max(...vis.map(k => k.h)); const pad = (hi - lo) * 0.08 || 1; lo -= pad; hi += pad;
  const cw = (W - PAD.l - PAD.r) / st.count, t0 = vis[0].t, ph = H - PAD.t - PAD.b;
  return { kind: 'chart', vis, lo, hi, cw, step: st.step,
    x: p => PAD.l + ((p.t - t0) / st.step + 0.5) * cw, y: p => PAD.t + (hi - p.p) / (hi - lo) * ph,
    inv: (X, Y) => ({ t: t0 + ((X - PAD.l) / cw - 0.5) * st.step, p: hi - (Y - PAD.t) / ph * (hi - lo) }), x0: PAD.l, x1: W - PAD.r };
}
const nice = (lo, hi, n = 5) => { const raw = (hi - lo) / n, mag = 10 ** Math.floor(Math.log10(raw)), st = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => s >= raw); const out = []; for (let v = Math.ceil(lo / st) * st; v <= hi; v += st) out.push(+v.toFixed(10)); return out; };
const fmtP = (v, ref) => { const d = ref >= 1000 ? 0 : ref >= 10 ? 2 : ref >= 1 ? 3 : 5; return v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }); };
const fmtT = (t, step) => { const d = new Date(t); return step >= INTERVALS['1d'] ? d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }) : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }) + (step < INTERVALS['4h'] ? ' ' + d.toISOString().slice(11, 16) : ''); };
export const sourceLabel = st => st.mode === 'image' ? 'Uploaded image' : st.synthetic ? 'Sample chart · synthetic candles, not market data' : (() => { const v = st.candles.slice(st.start, st.start + st.count); return `Hyperliquid · ${st.coin} perp · ${st.interval} · ${fmtT(v[0].t, INTERVALS['1d'])} – ${fmtT(v.at(-1).t, INTERVALS['1d'])} ${new Date(v.at(-1).t).getUTCFullYear()}`; })();

/* ---------- drawing ---------- */
const FONT = 'Manrope, system-ui, sans-serif';
export function draw(ctx, st, opts = {}) {
  const map = makeMap(st);
  ctx.save(); ctx.clearRect(0, 0, W, H); ctx.fillStyle = '#111419'; ctx.fillRect(0, 0, W, H);
  if (map.kind === 'image') { if (st.img) ctx.drawImage(st.img, map.f.x, map.f.y, map.f.w, map.f.h); }
  else {
    const ticks = nice(map.lo, map.hi), ref = map.hi;
    ctx.font = `500 11px ${FONT}`; ctx.textBaseline = 'middle';
    ticks.forEach(v => { const y = map.y({ p: v }); ctx.strokeStyle = '#1f252d'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(PAD.l, y); ctx.lineTo(W - PAD.r, y); ctx.stroke(); ctx.fillStyle = '#7f8896'; ctx.textAlign = 'left'; ctx.fillText(fmtP(v, ref), W - PAD.r + 8, y); });
    const every = Math.ceil(map.vis.length / 6); ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    map.vis.forEach((k, i) => { if (i % every === every >> 1) { ctx.fillStyle = '#7f8896'; ctx.fillText(fmtT(k.t, map.step), map.x(k), H - 10); } });
    const bw = Math.max(1, map.cw * 0.62);
    map.vis.forEach(k => { const x = map.x(k), up = k.c >= k.o; ctx.strokeStyle = up ? CANDLE_UP : CANDLE_EDGE; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(Math.round(x) + 0.5, map.y({ p: k.h })); ctx.lineTo(Math.round(x) + 0.5, map.y({ p: k.l })); ctx.stroke(); const y1 = map.y({ p: Math.max(k.o, k.c) }), y2 = map.y({ p: Math.min(k.o, k.c) }); ctx.fillStyle = up ? CANDLE_UP : CANDLE_DOWN; ctx.fillRect(x - bw / 2, y1, bw, Math.max(1, y2 - y1)); if (!up) ctx.strokeRect(x - bw / 2 + 0.5, y1 + 0.5, bw - 1, Math.max(1, y2 - y1 - 1)); });
    const last = map.vis.at(-1); if (last) { const y = map.y({ p: last.c }); ctx.fillStyle = '#c5cfdd'; ctx.fillRect(W - PAD.r + 2, y - 9, PAD.r - 4, 18); ctx.fillStyle = '#11161d'; ctx.font = `600 11px ${FONT}`; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillText(fmtP(last.c, ref), W - PAD.r + 8, y); }
  }
  (st.shapes || []).forEach(s => drawShape(ctx, map, s, opts));
  if (opts.preview) drawShape(ctx, map, opts.preview, opts);
  // Watermark keeps every exported image self-describing.
  const label = sourceLabel(st); ctx.font = `600 12px ${FONT}`; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  const w = ctx.measureText(label).width + 20; ctx.fillStyle = 'rgba(15,17,20,.82)'; ctx.fillRect(10, 10, w, 24); ctx.fillStyle = st.synthetic ? '#edd49e' : '#c5cfdd'; ctx.fillText(label, 20, 22);
  ctx.restore();
  return map;
}
function arrowHead(ctx, x1, y1, x2, y2, size = 12) { const a = Math.atan2(y2 - y1, x2 - x1); ctx.beginPath(); ctx.moveTo(x2, y2); ctx.lineTo(x2 - size * Math.cos(a - 0.45), y2 - size * Math.sin(a - 0.45)); ctx.lineTo(x2 - size * Math.cos(a + 0.45), y2 - size * Math.sin(a + 0.45)); ctx.closePath(); ctx.fill(); }
function pill(ctx, text, x, y, color, align = 'left') {
  ctx.font = `600 13px ${FONT}`; const w = ctx.measureText(text).width + 14, X = align === 'center' ? x - w / 2 : x;
  ctx.fillStyle = 'rgba(15,17,20,.86)'; ctx.fillRect(X, y - 11, w, 22); ctx.strokeStyle = color; ctx.lineWidth = 1; ctx.strokeRect(X + 0.5, y - 10.5, w - 1, 21);
  ctx.fillStyle = color; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillText(text, X + 7, y + 0.5);
}
function drawShape(ctx, map, s, opts) {
  const c = COLORS[s.color] || s.color || COLORS.yellow; ctx.save(); ctx.strokeStyle = c; ctx.fillStyle = c; ctx.lineWidth = 2; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  const P = p => [map.x(p), map.y(p)];
  if (s.type === 'line' || s.type === 'arrow') { const [x1, y1] = P(s.a), [x2, y2] = P(s.b); ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); if (s.type === 'arrow') arrowHead(ctx, x1, y1, x2, y2); }
  if (s.type === 'hline') { const y = map.y(s.a); ctx.setLineDash([7, 5]); ctx.beginPath(); ctx.moveTo(map.x0, y); ctx.lineTo(map.x1, y); ctx.stroke(); ctx.setLineDash([]); if (s.text) pill(ctx, s.text, map.x0 + 8, y - 15, c); }
  if (s.type === 'zone') { const [x1, y1] = P(s.a), [x2, y2] = P(s.b); ctx.globalAlpha = 0.12; ctx.fillRect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1)); ctx.globalAlpha = 1; ctx.lineWidth = 1.5; ctx.strokeRect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1)); if (s.text) pill(ctx, s.text, Math.min(x1, x2) + 6, Math.min(y1, y2) + 16, c); }
  if (s.type === 'position') {
    const [x1, ye] = P(s.a), [x2, yt] = P(s.b), ys = ye + (ye - yt), l = Math.min(x1, x2), w = Math.abs(x2 - x1);
    ctx.globalAlpha = 0.18; ctx.fillStyle = COLORS.green; ctx.fillRect(l, Math.min(ye, yt), w, Math.abs(yt - ye)); ctx.fillStyle = COLORS.red; ctx.fillRect(l, Math.min(ye, ys), w, Math.abs(ys - ye)); ctx.globalAlpha = 1;
    ctx.strokeStyle = '#e9edf2'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(l, ye); ctx.lineTo(l + w, ye); ctx.stroke();
    pill(ctx, (yt < ye ? 'Long' : 'Short') + ' · target 1R', l + 4, Math.min(yt, ys) + 14, '#e9edf2');
  }
  if (s.type === 'pen' && s.pts?.length > 1) { ctx.beginPath(); s.pts.forEach((p, i) => { const [x, y] = P(p); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }); ctx.stroke(); }
  if (s.type === 'text') { const [x, y] = P(s.a); pill(ctx, s.text || 'Note', x, y, c, 'center'); }
  if (s.type === 'marker') {
    const [x, y] = P(s.a), num = opts.ruleNumber ? opts.ruleNumber(s.rule) : '?', hot = opts.highlight && opts.highlight === s.rule;
    if (hot) { ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(x, y, 20, 0, Math.PI * 2); ctx.stroke(); }
    ctx.fillStyle = hot ? '#ffffff' : '#ffd23f'; ctx.beginPath(); ctx.arc(x, y, 13, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#11161d'; ctx.font = `700 13px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(String(num ?? '·'), x, y + 0.5);
  }
  ctx.restore();
}
function distSeg(px, py, x1, y1, x2, y2) { const dx = x2 - x1, dy = y2 - y1, L = dx * dx + dy * dy || 1, t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / L)); return Math.hypot(px - x1 - t * dx, py - y1 - t * dy); }
function hit(map, s, X, Y) {
  const P = p => [map.x(p), map.y(p)];
  if (s.type === 'line' || s.type === 'arrow') return distSeg(X, Y, ...P(s.a), ...P(s.b)) < 9;
  if (s.type === 'hline') return Math.abs(map.y(s.a) - Y) < 8;
  if (s.type === 'zone' || s.type === 'position') { const [x1, y1] = P(s.a), [x2, y2] = P(s.b); const yb = s.type === 'position' ? y1 + (y1 - y2) : y2; return X >= Math.min(x1, x2) - 6 && X <= Math.max(x1, x2) + 6 && Y >= Math.min(y1, y2, yb) - 6 && Y <= Math.max(y1, y2, yb) + 6; }
  if (s.type === 'pen') return s.pts.some((p, i) => i && distSeg(X, Y, ...P(s.pts[i - 1]), ...P(p)) < 9);
  if (s.type === 'text' || s.type === 'marker') { const [x, y] = P(s.a); return Math.hypot(X - x, Y - y) < 22; }
  return false;
}

/* ---------- studio ---------- */
const STUDIO_CSS = `
.studio{width:min(1320px,96vw);max-width:none;max-height:94dvh;padding:0;overflow:auto}
.studio header{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:14px 18px;border-bottom:1px solid var(--border);position:sticky;top:0;background:var(--card);z-index:1}.studio header h2{font-size:15px;margin:0}
.st-body{display:grid;grid-template-columns:minmax(0,1fr) 300px;gap:0}.st-main{padding:14px 18px;min-width:0;display:grid;gap:10px;align-content:start}.st-side{border-left:1px solid var(--border);padding:14px 18px;display:grid;gap:14px;align-content:start}
.st-row{display:flex;gap:8px;flex-wrap:wrap;align-items:center;font-size:10px;color:var(--muted-fg)}.st-row select,.st-row input[type=text]{font-size:11px;padding:6px 8px}
.st-tools{display:flex;gap:4px;flex-wrap:wrap;align-items:center}.st-tools button{font-size:10px;padding:6px 9px}.st-tools button[aria-pressed=true]{background:#2a313c;border-color:#7c8da7;color:var(--foreground)}
.st-sw{width:22px;height:22px;padding:0;border-radius:50%;border:2px solid transparent}.st-sw[aria-pressed=true]{border-color:#e9edf2;box-shadow:0 0 0 2px #0f1114 inset}
.st-canvas{width:100%;height:auto;aspect-ratio:16/9;border:1px solid var(--line);border-radius:6px;touch-action:none;cursor:crosshair;display:block;background:#111419}
.st-status{font-size:10px;color:var(--muted-fg);min-height:16px}.st-status.err{color:var(--warning)}
.st-side .rules{display:grid;gap:6px;max-height:220px;overflow:auto}.st-side .rules label{display:flex;gap:8px;font-size:11px;line-height:1.5;align-items:flex-start;color:#d6dde7}
.st-drop{border:1px dashed #4c596b;border-radius:6px;padding:10px;font-size:11px;color:var(--muted-fg)}
@media(max-width:980px){.st-body{grid-template-columns:1fr}.st-side{border-left:0;border-top:1px solid var(--border)}}
`;
let styled = false;
const TOOLS = [['line', 'Trend line'], ['hline', 'Horizontal line'], ['zone', 'Zone'], ['position', 'Long/short'], ['arrow', 'Arrow'], ['text', 'Text'], ['marker', 'Rule marker'], ['pen', 'Pen'], ['erase', 'Eraser']];

// opts: { rules:[{id,text,kind}], ruleNumber(id), version, initial? (an illustration to edit) } → Promise<illustration|null>
export function openStudio(opts) {
  if (!styled) { const s = document.createElement('style'); s.textContent = STUDIO_CSS; document.head.append(s); styled = true; }
  const ill = opts.initial;
  const st = ill ? structuredClone({ ...ill.state, img: undefined }) : { mode: 'chart', coin: 'BTC', interval: '4h', candles: [], start: 0, count: 90, step: INTERVALS['4h'], shapes: [], synthetic: false };
  if (ill?.state.mode === 'image') st.img = ill.state.img;
  const ui = { tool: 'line', color: 'yellow', text: '', rule: opts.rules[0]?.id ?? null, drag: null, preview: null, history: [] };
  const meta = { kind: ill?.kind ?? 'setup', caption: ill?.caption ?? '', rules: new Set(ill?.rules ?? []) };
  const dlg = document.createElement('dialog'); dlg.className = 'studio'; document.body.append(dlg);
  dlg.innerHTML = `<header><h2>${ill ? 'Edit illustration' : 'New illustration'}</h2><div class="row" style="gap:6px"><span class="seg" role="group" aria-label="Source"><button type="button" data-src="chart" aria-pressed="${st.mode === 'chart'}">Hyperliquid chart</button><button type="button" data-src="image" aria-pressed="${st.mode === 'image'}">Upload image</button></span><button type="button" data-close>Cancel</button></div></header>
  <div class="st-body"><div class="st-main">
   <div class="st-row" data-for="chart"><label>Asset <select data-coin><option>${esc(st.coin || 'BTC')}</option></select></label><span class="seg" role="group" aria-label="Interval">${Object.keys(INTERVALS).map(k => `<button type="button" data-int="${k}" aria-pressed="${st.interval === k}">${k}</button>`).join('')}</span><button type="button" data-load>Load</button><label style="flex:1;min-width:160px;display:flex;gap:8px;align-items:center">Earlier <input type="range" data-pan min="0" max="0" value="0" style="flex:1"> Now</label></div>
   <div class="st-row" data-for="image"><label class="st-drop">Choose an image (a screenshot from any chart, a TradingView export, a photo of a sketch) <input type="file" accept="image/*" data-file></label></div>
   <div class="st-tools" role="toolbar" aria-label="Drawing tools">${TOOLS.map(([k, l]) => `<button type="button" data-tool="${k}" aria-pressed="${ui.tool === k}">${l}</button>`).join('')}<span style="width:8px"></span>${Object.entries(COLORS).map(([k, v]) => `<button type="button" class="st-sw" data-color="${k}" aria-pressed="${ui.color === k}" aria-label="${k}" title="${k}" style="background:${v}"></button>`).join('')}<span style="width:8px"></span><button type="button" data-undo>Undo</button><button type="button" data-clear>Clear</button></div>
   <div class="st-row" data-opt="text"><label>Text <input type="text" data-text value="${esc(ui.text)}" maxlength="60"></label><span>Click the chart to place it. Also used as a label for horizontal lines and zones.</span></div>
   <div class="st-row" data-opt="marker"><label>Rule <select data-rule>${opts.rules.map(r => `<option value="${esc(r.id)}">${esc(opts.ruleNumber(r.id))} · ${esc(r.text.slice(0, 60))}</option>`).join('')}</select></label><span>Click where the chart shows this rule. The pin carries the rule's number.</span></div>
   <canvas class="st-canvas" width="${W}" height="${H}" aria-label="Drawing canvas"></canvas>
   <div class="st-status" aria-live="polite"></div>
  </div>
  <aside class="st-side">
   <label class="field">What does it show?<span class="seg" role="group">${[['setup', 'Example'], ['counterexample', 'Counterexample'], ['explain', 'Explains rules']].map(([k, l]) => `<button type="button" data-kind="${k}" aria-pressed="${meta.kind === k}">${l}</button>`).join('')}</span></label>
   <label class="field">Caption<textarea data-caption rows="3" maxlength="300" placeholder="What should someone notice here?">${esc(meta.caption)}</textarea></label>
   <div class="field" style="display:grid;gap:6px;font-size:10px;color:var(--muted-fg)">Rules it illustrates<div class="rules">${opts.rules.map(r => `<label><input type="checkbox" data-rcheck="${esc(r.id)}" ${meta.rules.has(r.id) ? 'checked' : ''}> <span><b>${esc(opts.ruleNumber(r.id))}</b> ${esc(r.text)}</span></label>`).join('') || '<small>No rules yet. You can still add pictures.</small>'}</div><small class="faint">Placing a rule marker ticks its rule.</small></div>
   <small class="muted" style="line-height:1.7">Drawn for v${esc(opts.version ?? '—')}. The picture explains the idea; adding or editing one does not create a new version. The asset is only the example; the strategy stays generic.</small>
   <button type="button" class="primary" data-save>${ill ? 'Save changes' : 'Add to strategy'}</button>
  </aside></div>`;
  const $ = s => dlg.querySelector(s), cv = $('canvas'), ctx = cv.getContext('2d'), status = (m, err) => { const e = $('.st-status'); e.textContent = m; e.classList.toggle('err', !!err); };
  const ready = () => st.mode === 'image' ? !!st.img : st.candles.length > 0;
  const syncMode = () => { dlg.querySelectorAll('[data-for]').forEach(e => e.hidden = e.dataset.for !== st.mode); dlg.querySelectorAll('[data-src]').forEach(b => b.setAttribute('aria-pressed', b.dataset.src === st.mode)); };
  const syncOpts = () => dlg.querySelectorAll('[data-opt]').forEach(e => e.hidden = !(e.dataset.opt === ui.tool || (e.dataset.opt === 'text' && (ui.tool === 'hline' || ui.tool === 'zone'))));
  const redraw = () => { if (!ready()) { ctx.fillStyle = '#111419'; ctx.fillRect(0, 0, W, H); ctx.fillStyle = '#7f8896'; ctx.font = `500 15px ${FONT}`; ctx.textAlign = 'center'; ctx.fillText(st.mode === 'image' ? 'Choose an image to draw on' : 'Loading…', W / 2, H / 2); return; } draw(ctx, st, { preview: ui.preview, ruleNumber: opts.ruleNumber }); };
  const pan = $('[data-pan]');
  const syncPan = () => { const max = Math.max(0, st.candles.length - st.count); pan.max = max; pan.value = max - st.start; pan.disabled = !max || st.synthetic; };
  async function load() {
    st.mode = 'chart'; syncMode(); status(`Loading ${st.coin} ${st.interval} from Hyperliquid…`); ctx.fillStyle = '#111419'; ctx.fillRect(0, 0, W, H);
    try { st.candles = await hlCandles(st.coin, st.interval); st.step = INTERVALS[st.interval]; st.synthetic = false; st.count = Math.min(90, st.candles.length); st.start = st.candles.length - st.count; status(`${st.candles.length} candles loaded. Drag “Earlier” to find an example in the past. Drawings stay pinned to time and price.`); }
    catch (e) { const s = synth('reclaim', 3); Object.assign(st, { candles: s.candles, step: s.step, synthetic: true, count: s.candles.length, start: 0 }); status(`Could not reach Hyperliquid (${e.message}). Showing synthetic sample candles instead.`, true); }
    syncPan(); redraw();
  }
  async function loadCoins() { try { const coins = await hlCoins(); $('[data-coin]').innerHTML = coins.map(c => `<option ${c === st.coin ? 'selected' : ''}>${esc(c)}</option>`).join(''); } catch { /* keep current option */ } }
  const pt = e => { const r = cv.getBoundingClientRect(); return [(e.clientX - r.left) * W / r.width, (e.clientY - r.top) * H / r.height]; };
  const push = s => { st.shapes.push(s); ui.history.push(() => st.shapes.splice(st.shapes.indexOf(s), 1)); if (s.type === 'marker') { meta.rules.add(s.rule); const cb = dlg.querySelector(`[data-rcheck="${CSS.escape(s.rule)}"]`); if (cb) cb.checked = true; } };
  cv.addEventListener('pointerdown', e => {
    if (!ready()) return; const map = makeMap(st), [X, Y] = pt(e), at = map.inv(X, Y), color = ui.color;
    if (ui.tool === 'erase') { const i = st.shapes.findLastIndex(s => hit(map, s, X, Y)); if (i >= 0) { const [s] = st.shapes.splice(i, 1); ui.history.push(() => st.shapes.splice(i, 0, s)); redraw(); } return; }
    if (ui.tool === 'text') { push({ type: 'text', a: at, text: ui.text.trim() || 'Note', color }); return redraw(); }
    if (ui.tool === 'marker') { if (!ui.rule) return status('This strategy has no rules to pin yet.', true); push({ type: 'marker', a: at, rule: ui.rule }); return redraw(); }
    if (ui.tool === 'hline') { push({ type: 'hline', a: at, color, text: ui.text.trim() }); return redraw(); }
    cv.setPointerCapture(e.pointerId); ui.drag = { a: at, pts: [at] };
  });
  cv.addEventListener('pointermove', e => {
    if (!ui.drag) return; const map = makeMap(st), [X, Y] = pt(e), b = map.inv(X, Y), color = ui.color;
    if (ui.tool === 'pen') { ui.drag.pts.push(b); ui.preview = { type: 'pen', pts: ui.drag.pts, color }; }
    else ui.preview = { type: ui.tool, a: ui.drag.a, b, color, text: ui.tool === 'zone' ? ui.text.trim() : '' };
    redraw();
  });
  const end = () => { if (!ui.drag) return; if (ui.preview) push(ui.preview); ui.drag = null; ui.preview = null; redraw(); };
  cv.addEventListener('pointerup', end); cv.addEventListener('pointercancel', end);
  dlg.addEventListener('input', e => { const t = e.target; if (t.dataset.pan != null) { st.start = Math.max(0, st.candles.length - st.count - +t.value); redraw(); } if (t.dataset.text != null) ui.text = t.value; if (t.dataset.caption != null) meta.caption = t.value; });
  dlg.addEventListener('change', e => {
    const t = e.target;
    if (t.dataset.coin != null) { st.coin = t.value; load(); }
    if (t.dataset.rule != null) ui.rule = t.value;
    if (t.dataset.rcheck != null) t.checked ? meta.rules.add(t.dataset.rcheck) : meta.rules.delete(t.dataset.rcheck);
    if (t.dataset.file != null && t.files[0]) { const fr = new FileReader(); fr.onload = () => { const img = new Image(); img.onload = () => { st.mode = 'image'; st.img = img; st.imgSrc = fr.result; st.shapes = []; ui.history = []; status('Image loaded. Drawings are kept relative to the picture.'); redraw(); }; img.src = fr.result; }; fr.readAsDataURL(t.files[0]); }
  });
  return new Promise(resolve => {
    const close = v => { dlg.close(); dlg.remove(); resolve(v); };
    dlg.addEventListener('cancel', e => { e.preventDefault(); close(null); });
    dlg.addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return; const d = b.dataset;
      if ('close' in d) return close(null);
      if (d.src) { if (d.src !== st.mode) { if (st.shapes.length && !confirm('Switching source clears the drawings. Continue?')) return; st.shapes = []; ui.history = []; st.mode = d.src; syncMode(); if (d.src === 'chart' && !st.candles.length) load(); else redraw(); } return; }
      if (d.int) { st.interval = d.int; dlg.querySelectorAll('[data-int]').forEach(x => x.setAttribute('aria-pressed', x === b)); return load(); }
      if ('load' in d) return load();
      if (d.tool) { ui.tool = d.tool; dlg.querySelectorAll('[data-tool]').forEach(x => x.setAttribute('aria-pressed', x === b)); syncOpts(); cv.style.cursor = d.tool === 'erase' ? 'not-allowed' : 'crosshair'; return; }
      if (d.color) { ui.color = d.color; dlg.querySelectorAll('[data-color]').forEach(x => x.setAttribute('aria-pressed', x === b)); return; }
      if ('undo' in d) { ui.history.pop()?.(); return redraw(); }
      if ('clear' in d) { const old = st.shapes; st.shapes = []; ui.history.push(() => { st.shapes = old; }); return redraw(); }
      if (d.kind) { meta.kind = d.kind; dlg.querySelectorAll('[data-kind]').forEach(x => x.setAttribute('aria-pressed', x === b)); return; }
      if ('save' in d) {
        if (!ready()) return status('Load a chart or choose an image first.', true);
        if (!meta.caption.trim()) { status('Add a caption: what should someone notice?', true); return $('[data-caption]').focus(); }
        draw(ctx, st, { ruleNumber: opts.ruleNumber });
        const state = { ...structuredClone({ ...st, img: undefined }), img: st.img };
        close({ id: ill?.id ?? 'ill-' + Math.random().toString(36).slice(2, 8), kind: meta.kind, caption: meta.caption.trim(), rules: [...meta.rules], forVersion: ill?.forVersion ?? opts.version, coin: st.mode === 'chart' && !st.synthetic ? st.coin : null, source: sourceLabel(st), png: cv.toDataURL('image/png'), state });
      }
    });
    syncMode(); syncOpts(); dlg.showModal();
    if (st.mode === 'chart') { loadCoins(); if (st.candles.length) { syncPan(); redraw(); } else load(); } else redraw();
  });
}

/* ---------- samples ---------- */
// Builds the sample illustrations on synthetic candles so the prototype shows the idea without a network.
export function sampleIllustrations() {
  const mk = (pattern, seed, shapes) => { const s = synth(pattern, seed); return { mode: 'chart', synthetic: true, coin: null, interval: '4h', candles: s.candles, step: s.step, start: 0, count: s.candles.length, shapes: shapes(s) }; };
  const reclaim = mk('reclaim', 7, s => {
    const k = s.candles, hiIdx = k.slice(0, 50).reduce((b, x, i) => x.h > k[b].h ? i : b, 0), sweepLow = k[56].l;
    return [
      { type: 'zone', a: { t: s.t(0), p: 110.3 }, b: { t: s.t(55), p: 99.7 }, color: 'blue', text: 'Range: 2+ touches each side' },
      { type: 'marker', a: { t: s.t(hiIdx), p: k[hiIdx].h + 1.1 }, rule: 'a' },
      { type: 'marker', a: { t: s.t(53), p: sweepLow + 0.2 }, rule: 'b' },
      { type: 'marker', a: { t: s.t(57), p: k[57].h + 1.0 }, rule: 'c' },
      { type: 'position', a: { t: s.t(59), p: 100.2 }, b: { t: s.t(78), p: 105 }, color: 'white' },
      { type: 'marker', a: { t: s.t(59), p: 98.9 }, rule: 'd' },
      { type: 'hline', a: { t: s.t(56), p: sweepLow - 0.3 }, color: 'red', text: 'Stop below the swept low' },
      { type: 'marker', a: { t: s.t(84), p: sweepLow - 0.3 }, rule: 'e' },
      { type: 'text', a: { t: s.t(84), p: 108.6 }, text: 'Rest at the range high', color: 'green' },
      { type: 'marker', a: { t: s.t(78), p: 106.3 }, rule: 'g' },
    ];
  });
  const deep = mk('deep', 11, s => [
    { type: 'zone', a: { t: s.t(0), p: 110.3 }, b: { t: s.t(55), p: 99.7 }, color: 'blue', text: 'Same kind of range' },
    { type: 'hline', a: { t: s.t(0), p: 94.5 }, color: 'red', text: 'Daily level just below' },
    { type: 'marker', a: { t: s.t(56), p: 92.9 }, rule: 'f' },
    { type: 'arrow', a: { t: s.t(59), p: 101.6 }, b: { t: s.t(80), p: 93.2 }, color: 'red' },
    { type: 'text', a: { t: s.t(76), p: 101.5 }, text: 'Reclaim failed, kept going', color: 'red' },
  ]);
  const stall = mk('trend-stall', 5, s => [
    { type: 'line', a: { t: s.t(57), p: 116.2 }, b: { t: s.t(71), p: 115.2 }, color: 'yellow' },
    { type: 'text', a: { t: s.t(42), p: 118.4 }, text: 'Funding top 5% here', color: 'yellow' },
    { type: 'marker', a: { t: s.t(66), p: 117.4 }, rule: 'b' },
    { type: 'position', a: { t: s.t(72), p: 113 }, b: { t: s.t(90), p: 108.6 }, color: 'white' },
  ]);
  return {
    reclaim: [
      { id: 'ill-1', kind: 'explain', caption: 'The whole setup on one chart: range, shallow sweep, 4H close back inside, entry on the retest, stop under the swept low, targets.', rules: ['a', 'b', 'c', 'd', 'e', 'g'], forVersion: 3, coin: null, state: reclaim },
      { id: 'ill-2', kind: 'counterexample', caption: 'Looks the same until you see the daily level under the sweep. This is why v3 skips sweeps into a daily level.', rules: ['f'], forVersion: 3, coin: null, state: deep },
    ],
    funding: [
      { id: 'ill-3', kind: 'explain', caption: 'Funding stretched while price stops making new highs. Short the failure, not the strength.', rules: ['b'], forVersion: 2, coin: null, state: stall },
    ],
  };
}
// Renders an illustration's state to a PNG data URL (used for samples and thumbnails).
export function renderPng(state, ruleNumber) { const c = document.createElement('canvas'); c.width = W; c.height = H; draw(c.getContext('2d'), state, { ruleNumber }); return c.toDataURL('image/png'); }
