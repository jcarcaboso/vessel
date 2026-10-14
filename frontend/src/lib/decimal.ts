/** Sign of a validated plain decimal string, without floating-point rounding. Null is unknown. */
export function decimalSign(value: string | null): -1 | 0 | 1 {
  if (value === null || !/[1-9]/.test(value)) return 0
  return value.startsWith('-') ? -1 : 1
}

/** Compare validated plain decimals without rounding an authoritative value. */
export function decimalLess(a: string, b: string): boolean {
  const scale = Math.max(a.split('.')[1]?.length ?? 0, b.split('.')[1]?.length ?? 0)
  const integer = (value: string) => {
    const [whole, fraction = ''] = value.split('.')
    return BigInt(`${whole}${fraction.padEnd(scale, '0')}`)
  }
  return integer(a) < integer(b)
}
