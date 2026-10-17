import { displayNameLimit, walletLabelLimit } from '@/api/auth'

// Mirrors the server's IdentityText.Clean, which decides; this only saves a trip. It trims what .NET's Trim trims
// (Unicode separators, \t–\r and U+0085), counts UTF-16 code units like `string.length`, and refuses control, format,
// surrogate, unassigned, line and paragraph separator characters. Private-use characters pass.
const space = '[\\p{Zs}\\p{Zl}\\p{Zp}\\t\\n\\v\\f\\r\\u0085]'
const edges = new RegExp(`^${space}+|${space}+$`, 'gu')
const refused = /[\p{Cc}\p{Cf}\p{Cs}\p{Cn}\p{Zl}\p{Zp}]/u

/** The stored form of a text, `null` for a blank optional one, or `undefined` when the server would refuse it. */
export function cleanIdentityText(value: string, limit: number, optional: boolean): string | null | undefined {
  const text = value.replace(edges, '')
  if (!text) return optional ? null : undefined
  return text.length <= limit && !refused.test(text) ? text : undefined
}

export const cleanDisplayName = (value: string) => cleanIdentityText(value, displayNameLimit, false) ?? undefined
/** A label is optional: blank becomes null. */
export const cleanLabel = (value: string) => cleanIdentityText(value, walletLabelLimit, true)
