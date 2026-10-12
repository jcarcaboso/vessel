/** Lightweight Charts update() may replace only the last timestamp or append newer ones. */
export function createSeriesWriter<T extends { time: number }, D>(
  series: { setData(data: D[]): void; update(point: D): void },
  same: (before: T, after: T) => boolean,
  convert: (point: T) => D,
) {
  // Value snapshots also detect callers mutating an existing array or point in place.
  let loaded: T[] = []
  return (next: readonly T[], reset = false) => {
    const timesChanged = loaded.length !== next.length || loaded.some((point, index) => point.time !== next[index]?.time)
    let changed = 0
    while (changed < loaded.length && changed < next.length && same(loaded[changed]!, next[changed]!)) changed++
    const tail = loaded.length > 0 && next.length >= loaded.length && changed >= loaded.length - 1
      && next[loaded.length - 1]!.time === loaded.at(-1)!.time
    if (reset || !tail) {
      series.setData(next.map(convert))
      loaded = next.map(point => ({ ...point }))
    } else {
      for (let index = changed; index < next.length; index++) {
        const point = next[index]!
        series.update(convert(point))
        loaded[index] = { ...point }
      }
    }
    return timesChanged
  }
}
