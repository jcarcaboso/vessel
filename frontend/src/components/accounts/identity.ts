import { useVenues } from '@/api/venues'
import { venueLogos } from '@/components/venues/venue-logos'
import { shortSource } from '@/lib/format'

/** What identifies an account on screen. `source` is its public address or account index; manual records have none. */
export interface IdentityAccount { id: string; name: string; venueId: string; source?: string | null | undefined }

export const isUnnamed = (account: Pick<IdentityAccount, 'name'>) => account.name.trim() === ''
/** The name, or for an unnamed account its short source, or a plain fallback for an unnamed manual record. */
export const accountLabel = (account: IdentityAccount) => isUnnamed(account) ? shortSource(account.source) ?? 'Unnamed account' : account.name.trim()
/** Full identity for titles and announcements: name, venue and the whole source. */
export const accountTitle = (account: IdentityAccount, venueName: string) =>
  `${isUnnamed(account) ? 'Unnamed account' : account.name.trim()} · ${venueName} · ${account.source ?? 'Manual record'}`

/**
 * IDs of accounts whose name does not tell them apart: blank, or shared with another account (trimmed, ignoring case).
 * Judge it over every account the owner can see, so an account gets its source suffix the same way in every view.
 */
export function ambiguousAccounts(accounts: readonly IdentityAccount[]): Set<string> {
  const counts = new Map<string, number>()
  for (const a of accounts) { const key = a.name.trim().toLowerCase(); counts.set(key, (counts.get(key) ?? 0) + 1) }
  return new Set(accounts.filter(a => isUnnamed(a) || counts.get(a.name.trim().toLowerCase())! > 1).map(a => a.id))
}

/** A stable hue (0–359) for a source, so the same address keeps its colour on every venue and screen. FNV-1a. */
export function sourceHue(source: string): number {
  let hash = 0x811c9dc5
  for (const char of source.trim().toLowerCase()) { hash ^= char.codePointAt(0)!; hash = Math.imul(hash, 0x01000193) >>> 0 }
  return hash % 360
}

/** The venue's brand accent from its bundled logo, if it has one. */
export function useVenueAccent(venueId: string) {
  const key = useVenues().logo(venueId)
  const logo = key ? venueLogos[key] : null
  return logo && 'accent' in logo ? logo.accent : undefined
}
