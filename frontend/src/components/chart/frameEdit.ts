/** Draft publications are frame-batched; the renderer keeps its own immediate preview. */
export class FrameEdit<T> {
  private frame: number | null = null
  private pending: T | null = null
  private published: T | null

  /** `start` is the value already shown, so a first move that rounds to it publishes nothing. */
  constructor(private readonly publish: (value: T, phase: 'move' | 'end') => void,
    private readonly same?: (before: T, after: T) => boolean, start: T | null = null) {
    this.published = start
  }

  move(value: T) {
    this.pending = value
    if (this.frame !== null) return
    this.frame = requestAnimationFrame(() => {
      this.frame = null
      const next = this.pending!
      this.pending = null
      if (this.published !== null && this.same?.(this.published, next)) return
      this.published = next
      this.publish(next, 'move')
    })
  }

  /** End carries the final value itself, even if no animation frame has run yet. */
  end(value: T) {
    this.cancel()
    this.publish(value, 'end')
  }

  cancel() {
    if (this.frame !== null) cancelAnimationFrame(this.frame)
    this.frame = null
    this.pending = null
    this.published = null
  }
}

/** Same rounding as chart-plan edits: venue tick, otherwise five significant figures / eight decimals. */
export function roundedLevelPrice(price: number, step?: number | null) {
  if (step != null && step > 0) {
    let places = 0
    while (places < 12 && Math.abs(Math.round(step * 10 ** places) - step * 10 ** places) > 1e-9) places++
    return Number((Math.round(price / step) * step).toFixed(places))
  }
  return Number(price.toFixed(Math.min(8, Math.max(0, 4 - Math.floor(Math.log10(price))))))
}
