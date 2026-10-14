import { describe, expect, it } from 'vitest'
import { isImageMarkup, markupLimits } from './markup'
import { isSavedEvidence } from './plays'

/** As the API returns it: ASP.NET writes the fields that do not apply to a kind as null. */
const unused = { width: null, points: null, from: null, to: null, at: null, size: null, text: null }
const pen = { ...unused, id: 'a', kind: 'pen', color: '#ff5c5c', width: 4, points: [{ x: 1, y: 2 }, { x: 3.5, y: 4 }] }
const marker = { ...unused, id: 'b', kind: 'marker', color: '#ffd23f', width: 16, points: [{ x: 10, y: 10 }] }
const arrow = { ...unused, id: 'c', kind: 'arrow', color: '#4ade80', width: 3, from: { x: 0, y: 0 }, to: { x: 800, y: 600 } }
const box = { ...unused, id: 'd', kind: 'box', color: '#60a5fa', width: 3, from: { x: 5, y: 5 }, to: { x: 50, y: 40 } }
const text = { ...unused, id: 'e', kind: 'text', color: '#ffffff', at: { x: 10, y: 20 }, size: 24, text: 'Retest here' }
const markup = (...shapes: unknown[]) => ({ width: 800, height: 600, shapes })

describe('isImageMarkup', () => {
  it.each([
    ['every kind as the server returns it', markup(pen, marker, arrow, box, text)],
    ['the same marks without unused fields', markup({ id: 'a', kind: 'pen', color: '#ff5c5c', width: 4, points: [{ x: 1, y: 2 }] },
      { id: 't', kind: 'text', color: '#111111', at: { x: 0, y: 0 }, size: 1.5, text: 'x' })],
    ['no marks', markup()],
    ['points on the image edge', markup({ ...arrow, from: { x: 800, y: 600 }, to: { x: 0, y: 0 } })],
    ['the largest sizes', { width: 20_000, height: 1, shapes: [
      { ...pen, width: 1000, points: [{ x: 20_000, y: 1 }] }, { ...text, size: 2000, at: { x: 0, y: 1 } }] }],
    ['the most marks and points', markup(...Array.from({ length: markupLimits.shapes - 1 }, (_, i) => ({ ...pen, id: `p${i}` })),
      { ...pen, id: 'long', points: Array.from({ length: markupLimits.points }, () => ({ x: 1, y: 1 })) })],
    ['the longest text', markup({ ...text, text: 'x'.repeat(markupLimits.text) })],
    ['text that is not .NET whitespace', markup({ ...text, text: '﻿' })],
    // The server's .NET `$` also matches before one final newline, so it accepts these.
    ['an ID and colour ending in one newline', markup({ ...pen, id: 'a\n', color: '#ff5c5c\n' })],
    ['IDs that differ only by that newline', markup(pen, { ...pen, id: 'a\n' })],
  ])('accepts %s', (_name, value) => expect(isImageMarkup(value)).toBe(true))

  it.each([
    ['null', null], ['an array', [markup(pen)]], ['missing shapes', { width: 800, height: 600 }], ['shapes that are not a list', { width: 800, height: 600, shapes: {} }],
    ['zero width', { ...markup(), width: 0 }], ['oversized height', { ...markup(), height: 20_001 }], ['fractional width', { ...markup(), width: 1.5 }],
    ['text dimensions', { ...markup(), width: '800' }], ['too many marks', markup(...Array.from({ length: markupLimits.shapes + 1 }, (_, i) => ({ ...pen, id: `p${i}` })))],
    ['a null mark', markup(null)], ['duplicate IDs', markup(pen, { ...arrow, id: 'a' })], ['an empty ID', markup({ ...pen, id: '' })],
    ['an ID with a space', markup({ ...pen, id: 'a b' })], ['a 65-character ID', markup({ ...pen, id: 'a'.repeat(65) })],
    ['an ID with two newlines', markup({ ...pen, id: 'a\n\n' })], ['an uppercase colour', markup({ ...pen, color: '#FF5C5C' })],
    ['a named colour', markup({ ...pen, color: 'red' })], ['an unknown kind', markup({ ...pen, kind: 'circle' })],
    ['a stroke without points', markup({ ...pen, points: [] })], ['too many points', markup({ ...pen, points: Array.from({ length: markupLimits.points + 1 }, () => ({ x: 1, y: 1 })) })],
    ['a point outside the image', markup({ ...pen, points: [{ x: 801, y: 1 }] })], ['a negative point', markup({ ...box, from: { x: -1, y: 0 } })],
    ['a text coordinate', markup({ ...pen, points: [{ x: '1', y: 1 }] })], ['a missing arrow end', markup({ ...arrow, to: null })],
    ['a zero stroke', markup({ ...arrow, width: 0 })], ['an oversized stroke', markup({ ...box, width: 1001 })], ['a stroke without width', markup({ ...pen, width: null })],
    ['a tiny text size', markup({ ...text, size: 0.5 })], ['an oversized text size', markup({ ...text, size: 2001 })], ['text without position', markup({ ...text, at: null })],
    ['empty text', markup({ ...text, text: '' })], ['blank text', markup({ ...text, text: ' 　  ' })], ['a line break', markup({ ...text, text: 'line\nbreak' })],
    ['a C1 control', markup({ ...text, text: 'a\u0085b' })], ['oversized text', markup({ ...text, text: 'x'.repeat(markupLimits.text + 1) })],
  ])('rejects %s', (_name, value) => expect(isImageMarkup(value)).toBe(false))
})

describe('saved evidence', () => {
  const evidence = {
    id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', playId: '11111111-2222-3333-4444-555555555555', source: 'capture', contentType: 'image/png',
    sizeBytes: 10, sha256: 'a'.repeat(64), note: '', createdAtUtc: '2026-10-02T10:00:00Z', updatedAtUtc: '2026-10-02T10:00:00Z', markup: null,
  }
  it('accepts no markup or valid markup, and nothing else', () => {
    expect(isSavedEvidence(evidence)).toBe(true)
    expect(isSavedEvidence({ ...evidence, markup: markup(arrow, text) })).toBe(true)
    expect(isSavedEvidence({ ...evidence, markup: {} })).toBe(false)
    expect(isSavedEvidence({ ...evidence, markup: { width: 800, height: 600 } })).toBe(false)
    expect(isSavedEvidence({ ...evidence, markup: markup({ ...pen, points: null }) })).toBe(false)
    expect(isSavedEvidence({ ...evidence, markup: undefined })).toBe(false)
  })
})
