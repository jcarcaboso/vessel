import type { SessionDto, SessionAuthApi } from '@/api/auth'
import { ApiError } from '@/api/errors'
import { isGuid, isRecord } from '@/api/guards'
import type { ApiCredentials, AuthFailure } from '@/api/request'

export const noticeKey = 'vessel:device:notice'
export const sessionChannelName = 'vessel-session'

/** The only notices the sign-in screen shows after a reload; anything else in the key is ignored. */
export const notices = {
  ended: 'Your session ended. Sign in again.',
  otherUser: 'Signed in as someone else in another tab.',
  signedOutElsewhere: 'You signed out in another tab.',
} as const
type Notice = typeof notices[keyof typeof notices]

export function writeNotice(notice: Notice) {
  try { sessionStorage.setItem(noticeKey, notice) } catch { /* The reload still happens, without the explanation. */ }
}

/** Reads and removes the notice left by a teardown, so it shows once. */
export function takeNotice(): Notice | null {
  try {
    const value = sessionStorage.getItem(noticeKey)
    sessionStorage.removeItem(noticeKey)
    return (Object.values(notices) as string[]).includes(value ?? '') ? value as Notice : null
  } catch { return null }
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
  /** A teardown before the workspace is shown: the gate returns to sign-in instead of reloading. */
  onEndedEarly?: (notice: Notice) => void
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

  credentials(): Extract<ApiCredentials, { kind: 'session' }> {
    return { kind: 'session', userId: this.userId, sessionId: this.sessionIdValue, generation: () => this.generationValue }
  }

  /** The workspace is on screen; from now on a teardown reloads the page. */
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

  /** Forced teardown: leave the notice, drop the exit state so `beforeunload` never asks, then replace the page. */
  teardown(notice: Notice) {
    if (this.ended) return
    this.ended = true
    if (!this.live) {
      this.dispose()
      this.options.onEndedEarly?.(notice)
      return
    }
    writeNotice(notice)
    this.leave()
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
    }
  }

  private post(message: SessionMessage) {
    try { this.channel?.postMessage(message) } catch { /* Other tabs learn on their next request. */ }
  }

  private leave() {
    for (const clear of [...this.exitStates]) clear()
    this.dispose()
    this.navigate(signInUrl())
  }
}
