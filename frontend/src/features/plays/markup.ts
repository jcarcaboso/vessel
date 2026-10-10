/**
 * Vector marks drawn over an evidence image. Coordinates are natural image pixels, so marks keep
 * their place at any display size. The original image is never modified; the marked version is
 * rendered from these shapes (as SVG on screen, flattened to PNG for download).
 */

export type MarkupTool = 'select' | 'pen' | 'marker' | 'arrow' | 'box' | 'text'
export type MarkupSize = 's' | 'm' | 'l'
export interface MarkupPoint { x: number; y: number }

export type MarkupShape =
  | { id: string; kind: 'pen' | 'marker'; color: string; width: number; points: MarkupPoint[] }
  | { id: string; kind: 'arrow' | 'box'; color: string; width: number; from: MarkupPoint; to: MarkupPoint }
  | { id: string; kind: 'text'; color: string; size: number; at: MarkupPoint; text: string }

export interface ImageMarkup {
  width: number
  height: number
  shapes: MarkupShape[]
}

/** Mirrors the server validation of saved markup. */
export const markupLimits = { shapes: 200, points: 2000, text: 280 }

export const markupColors = ['#ff5c5c', '#ffd23f', '#4ade80', '#60a5fa', '#ffffff', '#111111'] as const
const strokeScale: Record<MarkupSize, number> = { s: 0.003, m: 0.005, l: 0.009 }
const textScale: Record<MarkupSize, number> = { s: 0.022, m: 0.032, l: 0.048 }
const markerFactor = 4

const round = (value: number) => Math.round(value * 10) / 10
// Time plus randomness rather than a bare counter, so marks added later never collide with IDs in markup saved by
// an earlier session. Not crypto.randomUUID, which plain-HTTP LAN previews lack.
let nextId = 0
export const markupId = () => `mk-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}-${++nextId}`

export function strokeWidth(markup: Pick<ImageMarkup, 'width' | 'height'>, size: MarkupSize, kind: 'pen' | 'marker' | 'arrow' | 'box') {
  const width = Math.max(1.5, Math.max(markup.width, markup.height) * strokeScale[size])
  return round(kind === 'marker' ? width * markerFactor : width)
}

export const textSize = (markup: Pick<ImageMarkup, 'width' | 'height'>, size: MarkupSize) =>
  round(Math.max(10, Math.max(markup.width, markup.height) * textScale[size]))

export const clampPoint = (markup: Pick<ImageMarkup, 'width' | 'height'>, point: MarkupPoint): MarkupPoint => ({
  x: round(Math.min(markup.width, Math.max(0, point.x))), y: round(Math.min(markup.height, Math.max(0, point.y))),
})

export const hasMarks = (markup: ImageMarkup | null | undefined): markup is ImageMarkup => !!markup && markup.shapes.length > 0

/** Approximate box of a shape, used for selection and text hit testing. */
export function shapeBounds(shape: MarkupShape) {
  if (shape.kind === 'text') {
    const lines = shape.text.split('\n')
    const width = Math.max(...lines.map(line => line.length)) * shape.size * 0.58
    return { x: shape.at.x, y: shape.at.y, width, height: lines.length * shape.size * 1.25 }
  }
  const points = 'points' in shape ? shape.points : [shape.from, shape.to]
  const xs = points.map(point => point.x)
  const ys = points.map(point => point.y)
  const pad = shape.width / 2
  const x = Math.min(...xs) - pad
  const y = Math.min(...ys) - pad
  return { x, y, width: Math.max(...xs) + pad - x, height: Math.max(...ys) + pad - y }
}

function segmentDistance(point: MarkupPoint, a: MarkupPoint, b: MarkupPoint) {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const length = dx * dx + dy * dy
  const t = length ? Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / length)) : 0
  return Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy))
}

/** Topmost shape under the point. `tolerance` is in image pixels. */
export function hitShape(markup: ImageMarkup, point: MarkupPoint, tolerance: number) {
  for (const shape of [...markup.shapes].reverse()) {
    if (shape.kind === 'text') {
      const box = shapeBounds(shape)
      if (point.x >= box.x - tolerance && point.x <= box.x + box.width + tolerance && point.y >= box.y - tolerance && point.y <= box.y + box.height + tolerance) return shape
      continue
    }
    const reach = tolerance + shape.width / 2
    if (shape.kind === 'box') {
      const left = Math.min(shape.from.x, shape.to.x)
      const right = Math.max(shape.from.x, shape.to.x)
      const top = Math.min(shape.from.y, shape.to.y)
      const bottom = Math.max(shape.from.y, shape.to.y)
      const inside = point.x >= left && point.x <= right && point.y >= top && point.y <= bottom
      const nearEdge = Math.min(point.x - left, right - point.x, point.y - top, bottom - point.y) <= reach
      if (inside ? nearEdge : segmentDistance(point, { x: left, y: top }, { x: right, y: top }) <= reach
        || segmentDistance(point, { x: right, y: top }, { x: right, y: bottom }) <= reach
        || segmentDistance(point, { x: right, y: bottom }, { x: left, y: bottom }) <= reach
        || segmentDistance(point, { x: left, y: bottom }, { x: left, y: top }) <= reach) return shape
      continue
    }
    const points = 'points' in shape ? shape.points : [shape.from, shape.to]
    if (points.length === 1 && Math.hypot(point.x - points[0]!.x, point.y - points[0]!.y) <= reach) return shape
    for (let index = 1; index < points.length; index++) {
      if (segmentDistance(point, points[index - 1]!, points[index]!) <= reach) return shape
    }
  }
  return null
}

export function moveShape(markup: Pick<ImageMarkup, 'width' | 'height'>, shape: MarkupShape, dx: number, dy: number): MarkupShape {
  const move = (point: MarkupPoint) => clampPoint(markup, { x: point.x + dx, y: point.y + dy })
  if (shape.kind === 'text') return { ...shape, at: move(shape.at) }
  if ('points' in shape) return { ...shape, points: shape.points.map(move) }
  return { ...shape, from: move(shape.from), to: move(shape.to) }
}

const escape = (text: string) => text.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!)
const color = (value: string) => /^#[0-9a-f]{6}$/.test(value) ? value : markupColors[0]
const pointList = (points: readonly MarkupPoint[]) => points.map(point => `${point.x},${point.y}`).join(' ')

function arrowHead(shape: { from: MarkupPoint; to: MarkupPoint; width: number }) {
  const angle = Math.atan2(shape.to.y - shape.from.y, shape.to.x - shape.from.x)
  const length = Math.min(Math.max(shape.width * 4.5, 10), Math.hypot(shape.to.x - shape.from.x, shape.to.y - shape.from.y))
  const spread = Math.PI / 7
  const corner = (side: number) => ({ x: round(shape.to.x - length * Math.cos(angle + side * spread)), y: round(shape.to.y - length * Math.sin(angle + side * spread)) })
  const base = { x: round(shape.to.x - length * 0.8 * Math.cos(angle)), y: round(shape.to.y - length * 0.8 * Math.sin(angle)) }
  return { points: [shape.to, corner(1), corner(-1)], base }
}

function shapeSvg(shape: MarkupShape) {
  const stroke = (width: number, opacity = 1) =>
    `fill="none" stroke="${color(shape.color)}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"${opacity < 1 ? ` stroke-opacity="${opacity}"` : ''}`
  switch (shape.kind) {
    case 'pen':
    case 'marker': {
      const opacity = shape.kind === 'marker' ? 0.4 : 1
      if (shape.points.length === 1) {
        const [point] = shape.points
        return `<circle cx="${point!.x}" cy="${point!.y}" r="${shape.width / 2}" fill="${color(shape.color)}"${opacity < 1 ? ` fill-opacity="${opacity}"` : ''}/>`
      }
      return `<polyline points="${pointList(shape.points)}" ${stroke(shape.width, opacity)}/>`
    }
    case 'box': {
      const x = Math.min(shape.from.x, shape.to.x)
      const y = Math.min(shape.from.y, shape.to.y)
      return `<rect x="${x}" y="${y}" width="${round(Math.abs(shape.to.x - shape.from.x))}" height="${round(Math.abs(shape.to.y - shape.from.y))}" rx="${round(shape.width)}" ${stroke(shape.width)}/>`
    }
    case 'arrow': {
      const head = arrowHead(shape)
      return `<line x1="${shape.from.x}" y1="${shape.from.y}" x2="${head.base.x}" y2="${head.base.y}" ${stroke(shape.width)}/>`
        + `<polygon points="${pointList(head.points)}" fill="${color(shape.color)}" stroke="${color(shape.color)}" stroke-width="${round(shape.width / 2)}" stroke-linejoin="round"/>`
    }
    case 'text': {
      const halo = color(shape.color) === '#111111' ? '#ffffff' : '#000000'
      const lines = shape.text.split('\n').map((line, index) =>
        `<tspan x="${shape.at.x}" dy="${index === 0 ? 0 : round(shape.size * 1.25)}">${escape(line) || ' '}</tspan>`).join('')
      return `<text x="${shape.at.x}" y="${round(shape.at.y + shape.size)}" font-size="${shape.size}" font-family="'Inter Variable', Inter, system-ui, -apple-system, 'Segoe UI', sans-serif" font-weight="600" fill="${color(shape.color)}" stroke="${halo}" stroke-opacity="0.6" stroke-width="${round(shape.size * 0.14)}" stroke-linejoin="round" paint-order="stroke">${lines}</text>`
    }
  }
}

/** Standalone SVG for the marks, sized like the image. `selectedId` adds a selection outline. */
export function markupSvg(markup: ImageMarkup, selectedId: string | null = null) {
  const selected = markup.shapes.find(shape => shape.id === selectedId)
  const outline = selected ? (() => {
    const box = shapeBounds(selected)
    const pad = Math.max(4, Math.max(markup.width, markup.height) * 0.006)
    const dash = round(pad * 1.5)
    return `<rect x="${round(box.x - pad)}" y="${round(box.y - pad)}" width="${round(box.width + pad * 2)}" height="${round(box.height + pad * 2)}" fill="none" stroke="#8fb8ff" stroke-width="${round(pad / 3)}" stroke-dasharray="${dash} ${dash}"/>`
  })() : ''
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${markup.width}" height="${markup.height}" viewBox="0 0 ${markup.width} ${markup.height}">${markup.shapes.map(shapeSvg).join('')}${outline}</svg>`
}

export const markupDataUrl = (markup: ImageMarkup, selectedId: string | null = null) =>
  `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markupSvg(markup, selectedId))}`

function loadImage(url: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('The image could not be loaded.'))
    image.src = url
  })
}

/** PNG of the image with its marks drawn on top. The original blob is not changed. */
export async function flattenMarkup(image: Blob, markup: ImageMarkup) {
  const url = URL.createObjectURL(image)
  try {
    const [base, marks] = await Promise.all([loadImage(url), loadImage(markupDataUrl(markup))])
    const canvas = document.createElement('canvas')
    canvas.width = markup.width
    canvas.height = markup.height
    const context = canvas.getContext('2d')
    if (!context) return null
    context.drawImage(base, 0, 0, markup.width, markup.height)
    context.drawImage(marks, 0, 0, markup.width, markup.height)
    return await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'))
  } finally {
    URL.revokeObjectURL(url)
  }
}

/** `chart.png` → `chart-marked.png`. */
export const markedFileName = (name: string) => `${name.replace(/\.[a-z0-9]+$/i, '')}-marked.png`
