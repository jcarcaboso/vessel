import { useEffect, useRef, useState } from 'react'
import { DropdownMenu } from 'radix-ui'
import { ChevronsUpDown, LogOut, Monitor, UserRound, UsersRound } from 'lucide-react'
import { SourceChip } from '@/components/accounts/AccountIdentity'
import { UserAvatar } from './IdentityParts'
import type { ShellIdentity } from './types'

/**
 * The sidebar owner card in Wallet mode (mockup screen 7). It opens a menu instead of disconnecting at once; Sign out
 * runs the shell's unsaved-Play confirmation. The operator item is only shown to operators and waits for its page.
 */
export function AccountMenu({ identity, onProfile, onSessions, onSignOut }: {
  identity: ShellIdentity; onProfile: () => void; onSessions: () => void; onSignOut: () => void
}) {
  const { user, wallet } = identity.session
  const [open, setOpen] = useState(false)
  const [sessions, setSessions] = useState<number | null>(null)
  const auth = identity.auth
  // An item that moves focus elsewhere (Sessions) keeps the menu from sending it back to the owner card.
  const movesFocus = useRef(false)
  useEffect(() => {
    if (!open) return
    const controller = new AbortController()
    auth.sessions(controller.signal).then(rows => setSessions(rows.length), () => undefined)
    return () => controller.abort()
  }, [open, auth])
  return <DropdownMenu.Root open={open} onOpenChange={setOpen} modal={false}>
    <DropdownMenu.Trigger asChild>
      <button type="button" className="owner-card account-trigger" aria-label={`${user.displayName}, account menu`} title={`${user.displayName} · ${wallet.address}`}>
        <UserAvatar name={user.displayName} address={wallet.address} />
        <span className="sidebar-copy account-trigger-copy"><strong>{user.displayName}</strong><SourceChip source={wallet.address} /></span>
        <ChevronsUpDown size={15} aria-hidden="true" />
      </button>
    </DropdownMenu.Trigger>
    <DropdownMenu.Portal>
      <DropdownMenu.Content className="account-menu" side="top" align="start" sideOffset={8} collisionPadding={12}
        onCloseAutoFocus={event => { if (movesFocus.current) { movesFocus.current = false; event.preventDefault() } }}>
        <div className="account-menu-head">
          <UserAvatar name={user.displayName} address={wallet.address} size="lg" />
          <span><strong>{user.displayName}</strong><small><SourceChip source={wallet.address} />{identity.walletName && <>via {identity.walletName}</>}</small></span>
        </div>
        <DropdownMenu.Item className="account-menu-item" onSelect={onProfile}><UserRound size={16} aria-hidden="true" />Profile &amp; sign-in</DropdownMenu.Item>
        <DropdownMenu.Item className="account-menu-item" onSelect={() => { movesFocus.current = true; onSessions() }}><Monitor size={16} aria-hidden="true" />Sessions
          {sessions !== null && <span className="identity-pill" aria-label={`${sessions} active`}>{sessions}</span>}</DropdownMenu.Item>
        {user.role === 'operator' && <DropdownMenu.Item className="account-menu-item" disabled>
          <UsersRound size={16} aria-hidden="true" />Users &amp; invitations<span className="identity-pill">Soon</span></DropdownMenu.Item>}
        <DropdownMenu.Separator className="account-menu-separator" />
        <DropdownMenu.Item className="account-menu-item" onSelect={onSignOut}><LogOut size={16} aria-hidden="true" />Sign out</DropdownMenu.Item>
      </DropdownMenu.Content>
    </DropdownMenu.Portal>
  </DropdownMenu.Root>
}
