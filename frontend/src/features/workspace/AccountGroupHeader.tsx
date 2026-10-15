import { Fingerprint } from 'lucide-react'
import { useVenues } from '@/api/venues'
import { VenueBadge, VenueLogo } from '@/components/venues/VenueBadge'
import { money, shortSource } from '@/lib/format'
import type { AccountGroup, GroupBalance } from './account-groups'

const count = (n: number) => `${n} account${n === 1 ? '' : 's'}`

function balanceLines(balance: GroupBalance): { figure: string; note: string; partial: boolean } {
  if (balance.kind === 'exact') return {
    figure: money(balance.value), partial: false,
    note: balance.enabled === balance.accounts ? 'Nominal balance' : `Nominal balance · ${balance.enabled} of ${balance.accounts} enabled`,
  }
  if (balance.kind === 'partial') return {
    figure: 'Partial', partial: true,
    note: balance.reported === 0 ? 'No balances reported' : `${balance.reported} of ${balance.enabled} balances reported`,
  }
  return { figure: '—', note: 'All accounts disabled', partial: true }
}

/**
 * The header row of one table group. Its cells line up with the account columns: an optional select cell, the group
 * name across Account and Portfolio, the group balance under Balance, and blank space under Sync and Actions.
 */
export function AccountGroupHeader({ group, titleId, selection }: {
  group: AccountGroup; titleId: string
  selection?: { selected: string[]; onChange: (ids: string[]) => void; disabled: boolean }
}) {
  const venues = useVenues()
  const ids = group.accounts.map(a => a.id)
  const chosen = selection ? ids.filter(id => selection.selected.includes(id)).length : 0
  const label = group.kind === 'venue' ? venues.name(group.venueId) : group.kind === 'address' ? shortSource(group.address) ?? group.address : 'No address recorded'
  const { figure, note, partial } = balanceLines(group.balance)
  return <tr className="account-group-row">
    {selection && <td className="account-select-cell"><input type="checkbox" aria-label={`Select all ${group.kind === 'no-address' ? 'accounts without an address' : `${label} accounts`}`}
      disabled={selection.disabled} checked={chosen === ids.length}
      ref={input => { if (input) input.indeterminate = chosen > 0 && chosen < ids.length }}
      onChange={event => selection.onChange(event.target.checked ? [...selection.selected, ...ids.filter(id => !selection.selected.includes(id))]
        : selection.selected.filter(id => !ids.includes(id)))} /></td>}
    <th scope="rowgroup" colSpan={2} className="account-group-heading">
      <div className="account-group-title">
        {group.kind === 'venue' ? <VenueLogo venueId={group.venueId} size="md" /> :
          <span className={`account-group-glyph${group.kind === 'no-address' ? ' is-empty' : ''}`} aria-hidden="true"><Fingerprint size={15} /></span>}
        <span className="account-group-text">
          <span className="account-group-name">
            <strong id={titleId} title={group.kind === 'address' ? group.address : undefined}>{label}</strong>
            {group.kind === 'address' && <span className="account-group-venues">{group.venueIds.map(id => <VenueBadge key={id} venueId={id} compact size="xs" />)}</span>}
          </span>
          <small>{count(group.accounts.length)}{group.kind === 'no-address' ? ' · manual or account-index venues' : ''}</small>
        </span>
      </div>
    </th>
    <td className="numeric account-group-balance" title="Sum of the enabled accounts' venue-reported balances, nominal and not converted. Shown only when every enabled account reports one."><strong className={partial ? 'is-partial' : undefined}>{figure}</strong><small>{note}</small></td>
    <td colSpan={2} />
  </tr>
}
