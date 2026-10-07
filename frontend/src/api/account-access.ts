/** Credential entry is blocked on plaintext LAN origins, even if the API is on the same host. */
export function credentialTransportAllowed(location: Pick<Location, 'protocol' | 'hostname'> = window.location) {
  return location.protocol === 'https:' || location.protocol === 'http:' &&
    ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname)
}

export const credentialTransportMessage = 'Use HTTPS before entering a read-only token. Token entry is disabled on plain HTTP outside localhost.'
export const credentialSaveMessage = 'The read-only token could not be verified or saved. Check its scope and expiry, and ask the operator to check credential storage. Public account reads remain available.'
export const credentialStorageMessage = 'Credential storage is not configured. Ask the Vessel operator to configure the credential vault on the server. Public account reads remain available.'

export interface DiscoveredAccount {
  sourceId: string
  name: string
  accountType: 'main' | 'subaccount'
  accountValueUsd: string | null
  existingAccountId: string | null
  isEnabled: boolean | null
}

export interface AccountDiscovery {
  venueId: string
  address: string
  accounts: DiscoveredAccount[]
  notice: string
}

export interface AccountCredential {
  storageConfigured: boolean
  credential: {
    scope: 'single' | 'all'
    expiresAt: string
    lastVerifiedAt: string | null
    status: 'valid' | 'expiring' | 'expired' | 'unavailable'
  } | null
}

export const accountIndex = (value: unknown): value is string =>
  typeof value === 'string' && /^(0|[1-9]\d{0,18})$/.test(value) && BigInt(value) <= 9223372036854775807n
