import type { SessionDto, SessionAuthApi } from '@/api/auth'
import { ApiError } from '@/api/errors'
import { isGuid, isRecord } from '@/api/guards'
import type { ApiCredentials, AuthFailure, SessionGeneration } from '@/api/request'

export const noticeKey = 'vessel:device:notice'
/** A one-shot `sign-in` marker: the next load shows the wallet chooser without probing the session. Nothing else. */
export const landingKey = 'vessel:device:landing'
export const sessionChannelName = 'vessel-session'

/** The only notices the sign-in screen shows after a reload; anything else in the key is ignored. */
export const notices = {
  ended: 'Your session ended. Sign in again.',
  otherUser: 'Signed in as someone else in another tab.',
  signedOutElsewhere: 'You signed out in another tab.',
} as const
export type Notice = typeof notices[keyof typeof notices]

/** The same notices when the reload found a signed-in session after all, shown over the workspace. */
export const workspaceNotices: Record<Notice, string> = {
  [notices.ended]: 'Your earlier session in this tab ended.',
  [notices.otherUser]: notices.otherUser,
  [notices.signedOutElsewhere]: notices.signedOutElsewhere,
}

export function writeNotice(notice: Notice) {
  try { sessionStorage.setItem(noticeKey, notice) } catch { /* The reload still happens, without the explanation. */ }
}

/** The notice left by a teardown, if any. It stays stored until `clearNotice`, once a screen has shown it. */
export function readNotice(): Notice | null {
  try {
    const value = sessionStorage.getItem(noticeKey)
    return (Object.values(notices) as string[]).includes(value ?? '') ? value as Notice : null
  } catch { return null }
}

export function clearNotice() {
  try { sessionStorage.removeItem(noticeKey) } catch { /* Shown again on the next load at worst. */ }
}

/** Reads and removes the notice, for a screen that shows it at once. */
export function takeNotice(): Notice | null {
  const notice = readNotice()
  clearNotice()
  return notice
}

/** Reads and removes the landing marker, so only the next load skips the session probe. */
export function takeLanding(): boolean {
  try {
    const value = sessionStorage.getItem(landingKey)
    sessionStorage.removeItem(landingKey)
    return value === 'sign-in'
  } catch { return false }
}

/**
 * Reloads onto the wallet chooser. The marker stops a cookie that still opens the probe (but fails later, or belongs
 * to a suspended journal) from landing on the same screen again; without storage the probe simply runs.
 */
export function reloadToSignIn(navigate: (url: string) => void = url => window.location.replace(url)) {
  try { sessionStorage.setItem(landingKey, 'sign-in') } catch { /* The probe decides instead. */ }
  navigate(signInUrl())
}

/** `{type, userId, sessionId}` on `BroadcastChannel("vessel-session")`. It carries IDs only, never cookies or names. */
export interface SessionMessage { type: 'signed-in' | 'signed-out'; userId: string; sessionId: string }
export interface SessionChannel {
  postMessage(message: SessionMessage): void
  close(): void
  onmessage: ((event: MessageEvent) => void) | null
}
export type SessionChannelFactory = (name: string) => SessionChannel | null

export const browserChannel: SessionChannelFactory = name => typeof BroadcastChannel === 'function' ? new BroadcastChannel(name) as SessionChannel : null

export function isSessionMessage(value: unknown): value is SessionMessage {
  return isRecord(value) && (value.type === 'signed-in' || value.type === 'signed-out') && isGuid(value.userId) && isGuid(value.sessionId)
}

/** Where a teardown lands: this page without its hash, which loads fresh and probes the session again. */
export function signInUrl(location: Pick<Location, 'origin' | 'pathname' | 'search'> = window.location) {
  return `${location.origin}${location.pathname}${location.search}`
}

function openChannel(factory: SessionChannelFactory) {
  try { return factory(sessionChannelName) } catch { return null }
}

export interface SessionControllerOptions {
  session: SessionDto
  channels?: SessionChannelFactory
  /** A full navigation without confirmation; `location.replace` in the browser. */
  navigate?: (url: string) => void
  /** `user-suspended`: the gate swaps the workspace for the suspended screen. */
  onSuspended?: () => void
}

/**
 * Owns one signed-in tab: the session-kind credentials, forced teardown, voluntary sign-out and cross-tab messages.
 * A generation counter discards answers to requests sent before this tab adopted a newer session of the same user;
 * it cannot undo server actions already executed or cookies already set.
 */
export class SessionController {
  readonly userId: string
  private sessionIdValue: string
  private generationValue = 0
  private ended = false
  private live = false
  private exitStates = new Set<() => void>()
  private generationListeners = new Set<() => void>()
  private readonly channel: SessionChannel | null
  private readonly navigate: (url: string) => void

  constructor(private readonly options: SessionControllerOptions) {
    this.userId = options.session.user.id
    this.sessionIdValue = options.session.session.id
    this.navigate = options.navigate ?? (url => window.location.replace(url))
    this.channel = openChannel(options.channels ?? browserChannel)
    if (this.channel) this.channel.onmessage = event => this.receive(event.data)
  }

  get sessionId() { return this.sessionIdValue }
  get generation() { return this.generationValue }

  /** Read by every client of this tab before it publishes an answer; generation-bound streams reopen on a change. */
  readonly sessionGeneration: SessionGeneration = {
    current: () => this.generationValue,
    subscribe: listener => {
      this.generationListeners.add(listener)
      return () => { this.generationListeners.delete(listener) }
    },
  }

  credentials(): Extract<ApiCredentials, { kind: 'session' }> {
    return { kind: 'session', userId: this.userId, sessionId: this.sessionIdValue, generation: this.sessionGeneration }
  }

  /** The workspace is on screen; until then a teardown reloads onto the wallet chooser, which skips the probe. */
  markLive() { this.live = true }

  /** The shell registers how to drop its unsaved-work exit state, so a forced teardown never prompts. */
  registerExitState(clear: () => void) {
    this.exitStates.add(clear)
    return () => { this.exitStates.delete(clear) }
  }

  /** Every 401 and 403 of this tab's clients. Only a current 401 or `user-suspended` ends anything. */
  readonly handleFailure = (failure: AuthFailure) => {
    if (this.ended || failure.generation !== undefined && failure.generation < this.generationValue) return
    if (failure.status === 401) this.teardown(notices.ended)
    else if (failure.code === 'user-suspended') this.options.onSuspended?.()
  }

  /**
   * Forced teardown: leave the notice, drop the exit state so `beforeunload` never asks, then replace the page. The
   * stores already switched to this user, so even a teardown before the workspace is shown reloads; it lands on the
   * chooser, because the probe that let it in would only let it in again.
   */
  teardown(notice: Notice) {
    if (this.ended) return
    this.ended = true
    writeNotice(notice)
    this.leave(!this.live)
  }

  /** Tells other tabs this tab signed in. */
  announceSignIn() {
    this.post({ type: 'signed-in', userId: this.userId, sessionId: this.sessionIdValue })
  }

  /**
   * Voluntary sign-out, after the shell's unsaved-work confirmation. Revokes only this tab's session; if the cookie
   * now belongs to another session (409 `session-changed`), it reloads without telling other tabs. Other failures
   * are thrown so the caller can offer a retry.
   */
  async signOut(auth: Pick<SessionAuthApi, 'signOut'>) {
    if (this.ended) return
    const sessionId = this.sessionIdValue
    try {
      await auth.signOut(sessionId)
    } catch (cause) {
      if (!(cause instanceof ApiError && cause.code === 'session-changed')) throw cause
      this.ended = true
      this.leave()
      return
    }
    this.post({ type: 'signed-out', userId: this.userId, sessionId })
    this.ended = true
    this.leave()
  }

  dispose() {
    if (this.channel) {
      this.channel.onmessage = null
      try { this.channel.close() } catch { /* Already closed. */ }
    }
  }

  private receive(data: unknown) {
    if (this.ended || !isSessionMessage(data)) return
    if (data.type === 'signed-out') {
      if (data.sessionId === this.sessionIdValue) this.teardown(notices.signedOutElsewhere)
    } else if (data.userId !== this.userId) {
      // Another person's cookie now rides every request: reload before adopting any state.
      this.ended = true
      writeNotice(notices.otherUser)
      this.leave()
    } else if (data.sessionId !== this.sessionIdValue) {
      this.sessionIdValue = data.sessionId
      this.generationValue++
      for (const listener of [...this.generationListeners]) listener()
    }
  }

  private post(message: SessionMessage) {
    try { this.channel?.postMessage(message) } catch { /* Other tabs learn on their next request. */ }
  }

  private leave(toChooser = false) {
    for (const clear of [...this.exitStates]) clear()
    this.dispose()
    if (toChooser) reloadToSignIn(this.navigate)
    else this.navigate(signInUrl())
  }
}
