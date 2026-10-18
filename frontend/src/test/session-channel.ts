import type { SessionChannel, SessionMessage } from '@/features/identity/session'

/** An in-memory BroadcastChannel: every channel with the same name hears the others, never itself. */
export function channelBus() {
  const channels = new Set<SessionChannel & { name: string }>()
  const posted: SessionMessage[] = []
  const factory = (name: string) => {
    const channel: SessionChannel & { name: string } = {
      name, onmessage: null,
      postMessage(message) {
        posted.push(message)
        for (const peer of channels) if (peer !== channel && peer.name === name) peer.onmessage?.(new MessageEvent('message', { data: message }))
      },
      close() { channels.delete(channel) },
    }
    channels.add(channel)
    return channel
  }
  /** A message from another tab. */
  const send = (message: unknown) => { for (const channel of channels) channel.onmessage?.(new MessageEvent('message', { data: message })) }
  return { factory, posted, send, open: () => channels.size }
}
