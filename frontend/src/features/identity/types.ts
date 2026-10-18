import type { SessionAuthApi, SessionDto, UserDto } from '@/api/auth'
import type { SessionCheck } from './session'

/** What the workspace shell gets in Wallet mode. Token mode passes nothing, and the shell behaves as before. */
export interface ShellIdentity {
  session: SessionDto
  auth: SessionAuthApi
  /** The name the sign-in wallet announced in this tab, e.g. "Rabby Wallet"; unknown after a reload. */
  walletName: string | null
  /** A teardown's notice that no screen has shown yet, e.g. after another person signed in from another tab. */
  notice?: string | null
  /** The shell showed `notice`; it is removed from storage so it shows once. */
  noticePresented?(): void
  /** The shell registers how to drop its unsaved-work exit state, so a forced teardown never prompts. */
  registerExitState(clear: () => void): () => void
  /**
   * The profile changed: the shell's greeting and owner card follow it. A lower revision is ignored, except as the
   * `recovery` read after the server refused `conflictedRevision` (e.g. after a restore): it then rebases the profile.
   */
  onProfile(user: UserDto, recovery?: { conflictedRevision: number }): void
  /**
   * Asks the server which session this tab's cookie holds and follows the answer: a 401 tears down like any other,
   * and this tab's session refreshes `session`. Whether a removed wallet ended this tab is the server's to say.
   */
  checkSession(): Promise<SessionCheck>
  /**
   * Hears this tab adopting a newer session of the same user from another tab. The session identity is refreshed
   * meanwhile; anything prepared under the old one (a removal dialog, a loaded wallet list) is out of date.
   */
  onSessionChange(listener: () => void): () => void
}
