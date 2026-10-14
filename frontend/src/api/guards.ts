/**
 * Runtime guard primitives for API responses and requests. Every `api/*.ts` module builds its guards
 * from these, so the same name always means the same rule. Where an endpoint's contract really differs
 * (a decimal grammar, a timestamp form) a named profile below says so.
 *
 * Bounds are explicit: each call states the length its endpoint has always accepted. Call bounded
 * primitives with one value, never as an `Array.every` callback, which would pass the index as the bound;
 * use `isListOf` instead.
 */

/** A plain object. Arrays are rejected. */
export const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** A string of at most `max` UTF-16 code units. Empty is allowed. */
export const isText = (v: unknown, max = Number.POSITIVE_INFINITY): v is string => typeof v === 'string' && v.length <= max

/** A non-empty string of at most `max` code units. */
export const isFilledText = (v: unknown, max = Number.POSITIVE_INFINITY): v is string => isText(v, max) && v.length > 0

/** A string of at most `max` code units with at least one character `String.prototype.trim` keeps. */
export const isNonBlankText = (v: unknown, max = Number.POSITIVE_INFINITY): v is string => isText(v, max) && v.trim().length > 0

/** True when the text has no C0 or C1 control character (what .NET's `char.IsControl` reports). */
export function hasNoControlCharacters(v: string) {
  for (let index = 0; index < v.length; index++) {
    const code = v.charCodeAt(index)
    if (code < 32 || code >= 127 && code <= 159) return false
  }
  return true
}

/** A GUID in its 8-4-4-4-12 hexadecimal form, either case. */
export const isGuid = (v: unknown): v is string => typeof v === 'string' && /^[\da-f]{8}(-[\da-f]{4}){3}-[\da-f]{12}$/i.test(v)

/** A GUID other than the all-zero one, which no server record uses. */
export const isNonEmptyGuid = (v: unknown): v is string => isGuid(v) && !/^0{8}(-0{4}){3}-0{12}$/.test(v)

/** A whole number from 0 to `Number.MAX_SAFE_INTEGER`. */
export const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0

/** A count above zero, such as a revision or a Unix time in milliseconds. */
export const isPositiveCount = (v: unknown): v is number => isCount(v) && v > 0

/** The invariant text of a C# decimal, `-?digits[.digits]`, of at most `max` characters. */
export const isPlainDecimal = (v: unknown, max = 100): v is string => isText(v, max) && /^-?\d+(\.\d+)?$/.test(v)

/** A plain decimal without a minus sign (`-0` included). */
export const isNonNegativeDecimal = (v: unknown, max = 100): v is string => isPlainDecimal(v, max) && !v.startsWith('-')

/** Overview summary profile: a plain decimal of at most 160 characters and 28 fraction digits, the C# decimal scale. */
export const isSummaryDecimal = (v: unknown): v is string => isText(v, 160) && /^-?\d+(\.\d{1,28})?$/.test(v)

/** Review profile: a plain decimal that is also a finite JavaScript number, because the page charts it. */
export const isReviewDecimal = (v: unknown): v is string => isPlainDecimal(v) && Number.isFinite(Number(v))

/**
 * Manual execution profile: owner-entered decimals are kept exactly as typed, so a leading `+` and a
 * one- or two-digit exponent are allowed (at most 96 characters). The server checks the precision.
 */
export const isDiaryDecimal = (v: unknown): v is string => isText(v, 96) && /^[+-]?\d+(?:\.\d+)?(?:[eE][+-]?\d{1,2})?$/.test(v)

/** A manual execution decimal without a minus sign. */
export const isDiaryNonNegativeDecimal = (v: unknown): v is string => isDiaryDecimal(v) && !v.startsWith('-')

/** A manual execution decimal above zero: a non-zero digit before any exponent. */
export const isDiaryPositiveDecimal = (v: unknown): v is string => isDiaryNonNegativeDecimal(v) && /[1-9]/.test(v.split(/[eE]/)[0]!)

/** Any string of at most `max` characters that `Date.parse` reads. */
export const isTimestamp = (v: unknown, max = Number.POSITIVE_INFINITY): v is string => isText(v, max) && Number.isFinite(Date.parse(v))

/** ISO 8601 date and time with an explicit zone (`Z` or `±hh:mm`), at most 64 characters. Activity and the Overview summary. */
export const isIsoTimestamp = (v: unknown): v is string =>
  isText(v, 64) && /^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(v) && Number.isFinite(Date.parse(v))

/**
 * UTC only (`Z` or `+00:00`) with a real calendar date and time, at most 64 characters. Manual executions,
 * where the owner types the time and a rolled-over date such as February 31 must not be accepted.
 */
export const isUtcTimestamp = (v: unknown): v is string =>
  isText(v, 64) && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|\+00:00)$/.test(v) &&
  Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0, 19) === v.slice(0, 19)

/** Null, or what `check` accepts. */
export const isNullOr = (v: unknown, check: (v: unknown) => boolean) => v === null || check(v)

/** An array of at most `max` items that each pass `check`. */
export const isListOf = (v: unknown, check: (item: unknown) => boolean, max: number): v is unknown[] =>
  Array.isArray(v) && v.length <= max && v.every(item => check(item))
