/** One dispatched server-sent event. `event` defaults to `message`; multi-line data is joined with `\n`. */
export interface SseEvent {
  event: string
  data: string
}

export class SseOverflowError extends Error {
  constructor() {
    super('The event stream exceeded its buffer limit.')
    this.name = 'SseOverflowError'
  }
}

/**
 * Incremental `text/event-stream` parser (WHATWG rules for `event` and `data`; `id` and `retry` are ignored).
 * Chunks may split lines, CRLF pairs or events anywhere. Pending text is bounded so a peer that never
 * ends a line or an event cannot grow memory without limit.
 */
export class SseParser {
  private buffer = ''
  private data: string[] = []
  private dataSize = 0
  private type = ''

  constructor(private readonly onEvent: (event: SseEvent) => void, private readonly maxBuffer = 1024 * 1024) {}

  push(chunk: string) {
    this.buffer += chunk
    let start = 0
    for (let index = 0; index < this.buffer.length; index++) {
      const char = this.buffer[index]
      if (char !== '\n' && char !== '\r') continue
      // A trailing CR may be the first half of a CRLF split across chunks.
      if (char === '\r' && index === this.buffer.length - 1) break
      this.line(this.buffer.slice(start, index))
      if (char === '\r' && this.buffer[index + 1] === '\n') index++
      start = index + 1
    }
    this.buffer = this.buffer.slice(start)
    if (this.buffer.length + this.dataSize > this.maxBuffer) {
      this.reset()
      throw new SseOverflowError()
    }
  }

  /** The stream ended. A trailing incomplete event is discarded, as the specification requires. */
  end() {
    if (this.buffer.endsWith('\r')) this.push('\n')
    this.reset()
  }

  private reset() {
    this.buffer = ''
    this.data = []
    this.dataSize = 0
    this.type = ''
  }

  private line(line: string) {
    if (line === '') {
      if (this.data.length) this.onEvent({ event: this.type || 'message', data: this.data.join('\n') })
      this.data = []
      this.dataSize = 0
      this.type = ''
      return
    }
    if (line.startsWith(':')) return
    const colon = line.indexOf(':')
    const field = colon < 0 ? line : line.slice(0, colon)
    let value = colon < 0 ? '' : line.slice(colon + 1)
    if (value.startsWith(' ')) value = value.slice(1)
    if (field === 'event') this.type = value
    else if (field === 'data') {
      this.data.push(value)
      this.dataSize += value.length + 1
    }
  }
}
