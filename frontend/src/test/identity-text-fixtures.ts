/**
 * Cases for the identity text rule, matching the server's IdentityText.Clean: `[input, limit, optional, expected]`,
 * where `expected` is the stored text, `null` for a blank optional value, or `undefined` for a refusal (400).
 */
export const identityTextCases: Array<[name: string, input: string, limit: number, optional: boolean, expected: string | null | undefined]> = [
  ['trims surrounding spaces', '  Sam Rivera ', 60, false, 'Sam Rivera'],
  ['trims what .NET trims, including U+0085 and U+2028 at the edges', '\u0085 Sam \t', 60, false, 'Sam'],
  ['refuses a blank required value', ' \t ', 60, false, undefined],
  ['turns a blank optional value into null', '   ', 40, true, null],
  ['accepts exactly the limit in UTF-16 code units', 'a'.repeat(60), 60, false, 'a'.repeat(60)],
  ['refuses one code unit over the limit', 'a'.repeat(61), 60, false, undefined],
  ['counts an emoji at the boundary as two code units, so it fits', `${'a'.repeat(58)}😀`, 60, false, `${'a'.repeat(58)}😀`],
  ['counts an emoji at the boundary as two code units, so it overflows', `${'a'.repeat(59)}😀`, 60, false, undefined],
  ['refuses a line separator inside the text (Zl)', 'Sam Rivera', 60, false, undefined],
  ['refuses a paragraph separator inside the text (Zp)', 'Sam Rivera', 40, true, undefined],
  ['refuses a zero-width joiner (Cf)', 'Sam‍Rivera', 60, false, undefined],
  ['refuses a byte-order mark, which .NET does not trim (Cf)', '﻿Sam', 60, false, undefined],
  ['refuses a control character (Cc)', 'Sam\u0007', 60, false, undefined],
  ['refuses a lone surrogate (Cs)', 'Sam\ud800', 60, false, undefined],
  ['refuses an unassigned code point (Cn)', 'Sam͸', 60, false, undefined],
  ['accepts a private-use character (Co)', 'Desk ', 40, true, 'Desk '],
  ['accepts a note at its 80-unit limit', 'n'.repeat(80), 80, true, 'n'.repeat(80)],
  ['refuses a note over its limit', 'n'.repeat(81), 80, true, undefined],
]
