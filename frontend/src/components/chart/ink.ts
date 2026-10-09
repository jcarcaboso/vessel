/** Dark or white text, whichever reads better on a level tag of `color`. */
export function readableInk(color: string) {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})(?:[0-9a-f]{2})?$/i.exec(color.trim())?.[1]
  const rgb = hex
    ? (hex.length === 3 ? [...hex].map(c => c + c) : hex.match(/../g)!).map(value => parseInt(value, 16))
    : /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/i.exec(color.trim())?.slice(1, 4).map(Number)
  if (!rgb) return '#151c20'
  const [r, g, b] = rgb.map(value => value / 255).map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
  return r! * 0.2126 + g! * 0.7152 + b! * 0.0722 > 0.18 ? '#151c20' : '#ffffff'
}
