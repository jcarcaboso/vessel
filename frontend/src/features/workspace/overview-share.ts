// Only display percentages are rounded. Neither balance nor its exact ratio is converted to a float.
export function balanceShare(share: { numerator: string; denominator: string } | null): { label: string; width: string } {
  if (!share) return { label: '—', width: '0%' }
  const units = (value: string) => {
    const [whole, fraction = ''] = value.split('.')
    return BigInt(whole + fraction.padEnd(28, '0'))
  }
  const numerator = units(share.numerator), denominator = units(share.denominator)
  if (denominator <= 0n) return { label: '—', width: '0%' }
  const negative = numerator < 0n
  const hundredths = ((negative ? -numerator : numerator) * 10_000n + denominator / 2n) / denominator
  const label = `${negative && hundredths > 0n ? '-' : ''}${hundredths / 100n}.${String(hundredths % 100n).padStart(2, '0')}%`
  return { label, width: negative ? '0%' : hundredths > 10_000n ? '100%' : label }
}
