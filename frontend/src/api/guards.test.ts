import { describe, expect, it } from 'vitest'
import {
  hasNoControlCharacters, isCount, isDiaryDecimal, isDiaryNonNegativeDecimal, isDiaryPositiveDecimal, isFilledText, isGuid,
  isIsoTimestamp, isListOf, isNonBlankText, isNonEmptyGuid, isNonNegativeDecimal, isNullOr, isPlainDecimal, isPositiveCount,
  isRecord, isReviewDecimal, isSummaryDecimal, isText, isTimestamp, isUtcTimestamp,
} from './guards'

const guid = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
const nil = '00000000-0000-0000-0000-000000000000'
/** Parsable by `Date.parse`, but longer than the 64 characters most endpoints allow. */
const longDate = 'Tue Oct 14 2026 10:00:00 GMT+0000 (Coordinated Universal Time, a long comment)'

type Case = [name: string, guard: (v: unknown) => boolean, accepted: unknown[], rejected: unknown[]]
const cases: Case[] = [
  ['isRecord', isRecord, [{}, { a: 1 }, Object.create(null)], [null, undefined, [], [1], 'x', 1, true]],
  ['isText', v => isText(v), ['', ' ', 'x'.repeat(100_000)], [null, undefined, 1, {}, ['x']]],
  ['isText, at most 3', v => isText(v, 3), ['', 'abc'], ['abcd']],
  ['isFilledText, at most 3', v => isFilledText(v, 3), ['a', ' ', 'abc'], ['', 'abcd', 1, null]],
  ['isNonBlankText, at most 3', v => isNonBlankText(v, 3), ['a', ' a '], ['', '   ', '\t\n', 'abcd', null]],
  ['isGuid', isGuid, [guid, guid.toUpperCase(), nil], ['', 'not-a-guid', `${guid} `, `{${guid}}`, guid.replaceAll('-', ''), 1, null]],
  ['isNonEmptyGuid', isNonEmptyGuid, [guid], [nil, 'not-a-guid', null]],
  ['isCount', isCount, [0, 1, Number.MAX_SAFE_INTEGER], [-1, 1.5, Number.MAX_SAFE_INTEGER + 1, Number.NaN, Number.POSITIVE_INFINITY, '1', null]],
  ['isPositiveCount', isPositiveCount, [1, 1_790_000_000_000], [0, -1, 0.5, '1']],
  ['isPlainDecimal', v => isPlainDecimal(v), ['0', '-0', '1.25', '-0.0000000000000000000000000001', '1'.repeat(100)],
    ['', '1.', '.5', '+1', '1e3', ' 1', '1,5', 'NaN', 'Infinity', 1, null, '1'.repeat(101)]],
  ['isPlainDecimal, at most 160', v => isPlainDecimal(v, 160), ['1'.repeat(160)], ['1'.repeat(161)]],
  ['isNonNegativeDecimal', v => isNonNegativeDecimal(v), ['0', '1.5', '0.0'], ['-0', '-1', '1e3']],
]
const profiles: Case[] = [
  ['isSummaryDecimal (28 fraction digits, 160 characters)', isSummaryDecimal,
    ['79228162514264337593543950335.0000000000000000000000000001', '-1', `0.${'1'.repeat(28)}`, '1'.repeat(160)],
    [`0.${'1'.repeat(29)}`, '1e4', '+1', '1.', '1'.repeat(161), 1]],
  ['isReviewDecimal (also a finite number)', isReviewDecimal, ['150.123456789', '-1', '9'.repeat(100)], ['1e3', 'NaN', 'Infinity', '9'.repeat(101), 150]],
  ['isDiaryDecimal (sign and short exponent, 96 characters)', isDiaryDecimal,
    ['1', '+1.00E+2', '-1.230e-5', '1e99', '0e+5', '1'.repeat(96)], ['1e100', '1e', '.5', '1.', '1'.repeat(97), 'Infinity', ' 1', 1]],
  ['isDiaryNonNegativeDecimal', isDiaryNonNegativeDecimal, ['0', '+0', '0e+5', '1.5'], ['-0', '-1', '-1e2']],
  ['isDiaryPositiveDecimal', isDiaryPositiveDecimal, ['1', '0.001', '1.230e-5', '+1.00E+2'], ['0', '0.000', '0e+5', '+0', '-1', '1e100']],
  ['isTimestamp (anything Date.parse reads)', v => isTimestamp(v), ['2026-10-14T10:00:00Z', '2026-10-14T10:00:00', 'Oct 14 2026', longDate],
    ['', 'yesterday', '2026-13-01T00:00:00Z', 1_790_000_000_000, null]],
  ['isTimestamp, at most 64', v => isTimestamp(v, 64), ['2026-10-14T10:00:00Z'], [longDate]],
  ['isTimestamp, at most 40', v => isTimestamp(v, 40), ['2026-10-14T10:00:00.123Z'], ['2026-10-14T10:00:00.1234567890123456789012345Z']],
  ['isIsoTimestamp (explicit zone)', isIsoTimestamp, ['2026-10-14T10:00:00Z', '2026-10-14T10:00:00.123+02:00', '2026-02-31T10:00:00Z'],
    ['2026-10-14', '2026-10-14T10:00:00', 'Oct 14 2026 10:00 Z', '2026-13-01T00:00:00Z', longDate]],
  ['isUtcTimestamp (UTC, real calendar date)', isUtcTimestamp, ['2026-10-13T10:00:00Z', '2026-10-13T10:00:00.123456Z', '2026-10-13T10:00:00+00:00'],
    ['2026-02-31T10:00:00Z', '2026-10-13T10:00:00-05:00', '2026-10-13T10:00Z', '2026-10-13 10:00:00Z', '2026-10-13T10:00:00']],
]

describe('guard primitives', () => {
  describe.each(cases)('%s', (_name, guard, accepted, rejected) => {
    it.each(accepted.map(value => [value]))('accepts %j', value => expect(guard(value)).toBe(true))
    it.each(rejected.map(value => [value]))('rejects %j', value => expect(guard(value)).toBe(false))
  })
  it.each([['abc', true], ['é 😀', true], [' ', true], ['\n', false], ['\u0000', false], ['\u007f', false], ['\u0085', false], ['\u009f', false]])(
    'reports control characters in %j', (value, plain) => expect(hasNoControlCharacters(value as string)).toBe(plain))
  it('accepts null as well as what the check accepts', () => {
    expect(isNullOr(null, isGuid)).toBe(true)
    expect(isNullOr(guid, isGuid)).toBe(true)
    expect(isNullOr(undefined, isGuid)).toBe(false)
    expect(isNullOr('x', isGuid)).toBe(false)
  })
  it('bounds lists and checks each item with the item alone', () => {
    expect(isListOf([1, 2], isCount, 2)).toBe(true)
    expect(isListOf([1, 2, 3], isCount, 2)).toBe(false)
    expect(isListOf([1, -1], isCount, 5)).toBe(false)
    expect(isListOf({ length: 0 }, isCount, 5)).toBe(false)
    // Array.every would pass the index as a bound; isListOf must not.
    expect(isListOf(['abc', 'def'], (...args: unknown[]) => args.length === 1 && isText(args[0], 3), 5)).toBe(true)
  })
})

describe('guard profiles', () => {
  describe.each(profiles)('%s', (_name, guard, accepted, rejected) => {
    it.each(accepted.map(value => [value]))('accepts %j', value => expect(guard(value)).toBe(true))
    it.each(rejected.map(value => [value]))('rejects %j', value => expect(guard(value)).toBe(false))
  })
})
