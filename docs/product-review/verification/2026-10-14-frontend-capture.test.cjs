const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const { expected, pages, matrix, validateReport, comparisonInputs, pixelMetrics, comparisonLabel } = require('./2026-10-14-frontend-capture-helpers.cjs')

const report = (names = expected) => ({ status: 'passed', errors: [], blocked: [], shots: names.map(file => ({ file, overflow: 0 })), matrix: { expected: [...names] } })
test('matrix preserves 40 pages and adds 36 controls across both themes and viewports', () => {
  assert.equal(matrix(pages).length, 40)
  assert.equal(expected.length, 76)
  assert.equal(new Set(expected).size, 76)
  for (const file of matrix(pages)) assert.ok(expected.includes(file))
  validateReport(report())
})
for (const [name, mutate] of [
  ['missing capture', r => r.shots.pop()],
  ['duplicate capture', r => { r.shots[0] = r.shots[1] }],
  ['unexpected capture', r => { r.shots[0].file = 'unexpected.png' }],
  ['console error', r => r.errors.push('console error')],
  ['page/readiness error', r => r.errors.push('readiness timeout')],
  ['external request', r => r.blocked.push('https://venue.invalid')],
  ['overflow', r => { r.shots[0].overflow = 1 }],
]) test(`capture rejects ${name}`, () => { const value = report(); mutate(value); assert.throws(() => validateReport(value)) })

function directories(t, names = expected) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vessel-visual-test-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const dirs = ['before', 'after'].map(name => path.join(root, name))
  for (const dir of dirs) {
    fs.mkdirSync(dir)
    const value = report(names)
    if (names.length === 40) delete value.matrix
    fs.writeFileSync(path.join(dir, 'report.json'), JSON.stringify(value))
    for (const file of names) fs.writeFileSync(path.join(dir, file), 'nonempty-test-placeholder')
  }
  return dirs
}
test('comparison accepts complete extended or retained legacy matrices', t => {
  assert.equal(comparisonInputs(...directories(t)).files.length, 76)
  assert.equal(comparisonInputs(...directories(t, matrix(pages))).files.length, 40)
})
test('comparison accepts retained legacy reports without status', t => {
  const dirs = directories(t, matrix(pages))
  for (const dir of dirs) {
    const value = JSON.parse(fs.readFileSync(path.join(dir, 'report.json'), 'utf8'))
    delete value.status
    fs.writeFileSync(path.join(dir, 'report.json'), JSON.stringify(value))
  }
  assert.equal(comparisonInputs(...dirs).files.length, 40)
})
for (const where of [0, 1]) {
  for (const status of [undefined, 'running']) test(`comparison rejects complete extended ${status ?? 'missing'} status in input ${where}`, t => {
    const dirs = directories(t)
    const value = report(); value.status = status
    fs.writeFileSync(path.join(dirs[where], 'report.json'), JSON.stringify(value))
    assert.throws(() => comparisonInputs(...dirs), /must have passed status/)
  })
  for (const status of ['running', 'failed']) test(`comparison rejects complete legacy ${status} status in input ${where}`, t => {
    const dirs = directories(t, matrix(pages))
    const value = report(matrix(pages)); delete value.matrix; value.status = status
    fs.writeFileSync(path.join(dirs[where], 'report.json'), JSON.stringify(value))
    assert.throws(() => comparisonInputs(...dirs), /must have passed status/)
  })
  test(`comparison fails a missing image in input ${where}`, t => {
    const dirs = directories(t); fs.unlinkSync(path.join(dirs[where], expected[0]))
    assert.throws(() => comparisonInputs(...dirs))
  })
  test(`comparison fails an empty image in input ${where}`, t => {
    const dirs = directories(t); fs.truncateSync(path.join(dirs[where], expected[0]))
    assert.throws(() => comparisonInputs(...dirs), /Empty PNG/)
  })
  test(`comparison fails an empty folder in input ${where}`, t => {
    const dirs = directories(t)
    for (const file of expected) fs.unlinkSync(path.join(dirs[where], file))
    assert.throws(() => comparisonInputs(...dirs), /No PNG inputs/)
  })
}
test('comparison fails missing directory and extra after image', t => {
  const dirs = directories(t)
  assert.throws(() => comparisonInputs(dirs[0], path.join(dirs[1], 'absent')), /ENOENT/)
  fs.writeFileSync(path.join(dirs[1], 'unexpected.png'), 'extra')
  assert.throws(() => comparisonInputs(...dirs))
})
test('comparison rejects a failed or incomplete report, not just files', t => {
  const dirs = directories(t)
  const value = report(); value.status = 'failed'
  fs.writeFileSync(path.join(dirs[1], 'report.json'), JSON.stringify(value))
  assert.throws(() => comparisonInputs(...dirs), /must have passed status/)
  delete value.status; value.matrix.expected.pop()
  fs.writeFileSync(path.join(dirs[1], 'report.json'), JSON.stringify(value))
  assert.throws(() => comparisonInputs(...dirs), /Unknown capture matrix/)
})
test('metrics distinguish exact equality, below-threshold changes and summed alpha differences', () => {
  const base = Uint8ClampedArray.from([0, 0, 0, 255, 10, 20, 30, 255])
  const same = pixelMetrics(base, base, 1, 2)
  assert.deepEqual(same.exact, { changed: 0, ratio: 0, rows: null })
  assert.match(comparisonLabel({ before: [1, 2], after: [1, 2], ...same }), /pixel-identical/)
  const other = Uint8ClampedArray.from([1, 0, 0, 255, 10, 20, 30, 230])
  const changed = pixelMetrics(base, other, 1, 2)
  assert.deepEqual(changed.exact, { changed: 2, ratio: 1, rows: [0, 1] })
  assert.deepEqual(changed.tolerance, { threshold: 24, changed: 1, ratio: 0.5, rows: [1, 1] })
  assert.equal(changed.meanAbsoluteChannelDelta, 26 / 8)
  assert.equal(changed.maxSummedRgbaDelta, 25)
  assert.doesNotMatch(comparisonLabel({ before: [1, 2], after: [1, 2], ...changed }), /identical/)
})
test('exact delta 24 is not identical even with zero tolerance changes', () => {
  const result = pixelMetrics([0, 0, 0, 255], [8, 8, 8, 255], 1, 1)
  assert.equal(result.exact.changed, 1); assert.equal(result.tolerance.changed, 0)
  assert.doesNotMatch(comparisonLabel({ before: [1, 1], after: [1, 1], ...result }), /identical/)
  assert.match(comparisonLabel({ before: [1, 1], after: [1, 1], ...result }), /tolerance >24: 0.000%/)
})
test('dimension changes are never labeled identical; invalid buffers fail', () => {
  const result = pixelMetrics([0, 0, 0, 0], [0, 0, 0, 0], 1, 1)
  assert.doesNotMatch(comparisonLabel({ before: [1, 1], after: [1, 2], ...result }), /identical/)
  assert.throws(() => pixelMetrics([], [], 0, 0))
  assert.throws(() => pixelMetrics([0], [], 1, 1))
})
test('CLI rejects nonexistent/empty inputs before requiring Playwright', t => {
  const dirs = directories(t)
  const compare = path.join(__dirname, '2026-10-14-frontend-compare.cjs')
  for (const file of expected) fs.unlinkSync(path.join(dirs[0], file))
  const result = spawnSync(process.execPath, [compare, ...dirs, path.join(dirs[0], 'diff')], {
    env: { ...process.env, PLAYWRIGHT_MODULE: '/does-not-exist' }, encoding: 'utf8',
  })
  assert.equal(result.status, 1); assert.match(result.stderr, /No PNG inputs/)
  assert.doesNotMatch(result.stderr, /Cannot find module/)
})
test('fixture import performs no config or database reads; diagnostic PNG is deterministic', () => {
  const filename = path.join(__dirname, '2026-10-14-frontend-fixture.py')
  const result = spawnSync('python3', ['-c', `import struct\nscope={'__name__':'fixture_test'}\nexec(compile(open(${JSON.stringify(filename)}).read(), 'fixture.py', 'exec'), scope)\na=scope['evidence_png']()\nassert a == scope['evidence_png']()\nassert a[:8] == b'\\x89PNG\\r\\n\\x1a\\n'\nassert struct.unpack('>II', a[16:24]) == (640, 360)\nassert scope['CONFIG'] is None`], { encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
})

test('fixture supplement reuses normalized server marks and refuses altered evidence', () => {
  const filename = path.join(__dirname, '2026-10-14-frontend-fixture.py')
  const result = spawnSync('python3', ['-c', `
import hashlib, pathlib, tempfile
scope={'__name__':'fixture_test'}
exec(compile(open(${JSON.stringify(filename)}).read(), 'fixture.py', 'exec'), scope)
markup={'width':640,'height':360,'shapes':[
 {'id':'fixture-arrow','kind':'arrow','color':'#ffd23f','width':4,'from':{'x':120,'y':210},'to':{'x':340,'y':140},'text':None},
 {'id':'fixture-text','kind':'text','color':'#ffffff','size':22,'at':{'x':40,'y':30},'text':'SYNTHETIC CAPTURE FIXTURE','width':None}]}
evidence={'id':'synthetic-id','note':'Synthetic visual verification image. Diagnostic line only, not financial or venue evidence.','markup':markup,'sha256':hashlib.sha256(scope['evidence_png']()).hexdigest(),'createdAtUtc':'2026-10-14T17:00:00Z'}
scope['api']=lambda path: [evidence]
with tempfile.TemporaryDirectory() as root:
 scope['OUTPUT']=pathlib.Path(root)/'fixture.json'
 fixture={'plays':{'btc':'synthetic-play'},'seededAt':'2026-10-14T16:00:00Z'}
 scope['supplement'](fixture)
 scope['supplement'](fixture)
 assert fixture['seededAt']=='2026-10-14T16:00:00Z'
 assert fixture['visualScenarios']['evidenceId']=='synthetic-id'
 evidence['markup']['shapes'][0]['width']=9
 try: scope['supplement'](fixture)
 except AssertionError: pass
 else: raise AssertionError('changed marks accepted')
`], { encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
})

test('actual browser decoder rejects corrupt PNG inputs', { skip: !process.env.PLAYWRIGHT_MODULE }, async t => {
  const dirs = directories(t, matrix(pages))
  const { main } = require('./2026-10-14-frontend-compare.cjs')
  const out = path.join(path.dirname(dirs[0]), 'diff')
  await assert.rejects(main(...dirs, out), /Invalid PNG input/)
  assert.equal(fs.existsSync(path.join(out, 'summary.json')), false)
})
test('actual browser comparison reports low-delta differences and emits exact diff images', { skip: !process.env.PLAYWRIGHT_MODULE }, async t => {
  const dirs = directories(t, matrix(pages))
  const pngs = spawnSync('python3', ['-c', `import struct,zlib,json,base64
def png(g):
 def chunk(k,d): return struct.pack('>I',len(d))+k+d+struct.pack('>I',zlib.crc32(k+d))
 return base64.b64encode(b'\\x89PNG\\r\\n\\x1a\\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',1,1,8,6,0,0,0))+chunk(b'IDAT',zlib.compress(bytes([0,0,g,0,255])))+chunk(b'IEND',b'')).decode()
print(json.dumps([png(0),png(1)]))`], { encoding: 'utf8' })
  assert.equal(pngs.status, 0, pngs.stderr)
  const images = JSON.parse(pngs.stdout).map(value => Buffer.from(value, 'base64'))
  for (const [i, dir] of dirs.entries()) for (const file of matrix(pages)) fs.writeFileSync(path.join(dir, file), images[i])
  const { main } = require('./2026-10-14-frontend-compare.cjs')
  const out = path.join(path.dirname(dirs[0]), 'diff')
  await main(...dirs, out)
  const summary = JSON.parse(fs.readFileSync(path.join(out, 'summary.json')))
  assert.equal(summary.results.length, 40)
  for (const result of summary.results) {
    assert.equal(result.exact.changed, 1); assert.equal(result.tolerance.changed, 0)
    assert.ok(fs.statSync(path.join(out, result.file.replace('.png', '-diff.png'))).size > 0)
  }
})

test('comparison rejects a missing report and a legacy/extended matrix mismatch', t => {
  const dirs = directories(t)
  fs.unlinkSync(path.join(dirs[1], 'report.json'))
  assert.throws(() => comparisonInputs(...dirs), /ENOENT/)
  const legacy = directories(t, matrix(pages))
  assert.throws(() => comparisonInputs(dirs[0], legacy[1]), /Before\/after matrices differ/)
})
test('CLI refuses to overwrite an input folder', t => {
  const dirs = directories(t)
  const result = spawnSync(process.execPath, [path.join(__dirname, '2026-10-14-frontend-compare.cjs'), ...dirs, dirs[0]], { encoding: 'utf8' })
  assert.equal(result.status, 1); assert.match(result.stderr, /must not overwrite/)
})
