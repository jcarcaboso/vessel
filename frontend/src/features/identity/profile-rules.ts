import { displayNameLimit, walletLabelLimit } from '@/api/auth'

// The server's rules (§4): trimmed, printable Unicode only, counted in characters. It decides; this only saves a trip.
const unprintable = /[\p{Cc}\p{Cf}\p{Cs}\p{Co}\p{Cn}]/u
const characters = (text: string) => [...text].length

export function validDisplayName(value: string) {
  const name = value.trim()
  return characters(name) >= 1 && characters(name) <= displayNameLimit && !unprintable.test(name)
}

/** A label is optional: blank becomes null. */
export function validLabel(value: string) {
  const label = value.trim()
  return characters(label) <= walletLabelLimit && !unprintable.test(label)
}
