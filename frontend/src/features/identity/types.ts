import type { SessionAuthApi, SessionDto, UserDto } from '@/api/auth'

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
  /** The profile changed: the shell's greeting and owner card follow it. */
  onProfile(user: UserDto): void
  /** This tab's session ended on purpose (its wallet was removed): leave like a forced teardown. */
  endSession(): void
}
