/** Draft estimates accept unsigned plain decimals with surrounding whitespace, never exponents. */
export function planNumber(value: string): number | null {
  return /^\d+(\.\d+)?$/.test(value.trim()) ? Number(value) : null
}

/** Sizing and plan checks historically accept overflow; finite geometry uses the profile below. */
export function positivePlanNumber(value: string): number | null {
  const number = planNumber(value)
  return number !== null && number > 0 ? number : null
}

/** Chart levels and whole-position estimates require a finite display number. */
export function finitePlanNumber(value: string): number | null {
  const number = planNumber(value)
  return number !== null && Number.isFinite(number) ? number : null
}

export function positiveFinitePlanNumber(value: string): number | null {
  const number = finitePlanNumber(value)
  return number !== null && number > 0 ? number : null
}

/** Zero is a valid share; a blank share is unknown. Exact allocation remains the summary's job. */
export function planShare(value: string): number | null {
  const number = planNumber(value)
  return number !== null && number <= 100 ? number : null
}
