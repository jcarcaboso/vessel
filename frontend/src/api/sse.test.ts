import { describe, expect, it } from 'vitest'
import { SseOverflowError, SseParser, type SseEvent } from './sse'

function parse(chunks: string[], maxBuffer?: number) {
  const events: SseEvent[] = []
  const parser = new SseParser(event => events.push(event), maxBuffer)
  for (const chunk of chunks) parser.push(chunk)
  parser.end()
  return events
}

describe('Server-sent event parser', () => {
  it('dispatches named events and defaults to message', () => {
    expect(parse(['event: candle\ndata: {"a":1}\n\ndata: plain\n\n'])).toEqual([
      { event: 'candle', data: '{"a":1}' }, { event: 'message', data: 'plain' },
    ])
  })

  it('reassembles events, lines and CRLF pairs split across chunks', () => {
    const text = 'event: status\r\ndata: {"state":"live"}\r\n\r\nevent: context\r\ndata: x\r\n\r\n'
    for (let split = 1; split < text.length; split++) {
      expect(parse([text.slice(0, split), text.slice(split)])).toEqual([
        { event: 'status', data: '{"state":"live"}' }, { event: 'context', data: 'x' },
      ])
    }
    expect(parse([...text])).toHaveLength(2)
  })

  it('joins multi-line data with newlines and accepts bare CR and fields without a space', () => {
    expect(parse(['data:first\rdata: second\r\rdata\n\n'])).toEqual([{ event: 'message', data: 'first\nsecond' }, { event: 'message', data: '' }])
  })

  it('ignores comments, unknown fields, empty events and a trailing incomplete event', () => {
    expect(parse([': keepalive\n\nid: 7\nretry: 1000\n\nevent: candle\n\nevent: candle\ndata: 1\n\nevent: candle\ndata: 2'])).toEqual([
      { event: 'candle', data: '1' },
    ])
  })

  it('resets the event type after each dispatch', () => {
    expect(parse(['event: candle\ndata: 1\n\ndata: 2\n\n']).map(e => e.event)).toEqual(['candle', 'message'])
  })

  it('rejects an unterminated line or event that exceeds the buffer', () => {
    const parser = new SseParser(() => undefined, 16)
    expect(() => parser.push('data: 0123456789abcdef')).toThrow(SseOverflowError)
    const lines = new SseParser(() => undefined, 16)
    lines.push('data: 01234\n')
    expect(() => lines.push('data: 56789\ndata: abcde\n')).toThrow(SseOverflowError)
    expect(parse(['data: 0123456789\n\n'.repeat(4)], 16)).toHaveLength(4)
  })
})
