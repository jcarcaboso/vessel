import { hasNoControlCharacters, isFilledText, isRecord, isText } from './guards'

/**
 * Vector marks drawn over an evidence image, as the API stores them. Coordinates are natural image
 * pixels, so marks keep their place at any display size. The original image is never modified.
 */
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

/** Mirrors the server validation of saved markup (`EvidenceMarkup` in the application layer). */
export const markupLimits = { shapes: 200, points: 2000, text: 280 }

/** Image width and height are whole pixels from 1 to 20,000; stroke widths above 0 up to 1,000; text sizes 1 to 2,000. */
const maxDimension = 20_000
// .NET `char.IsWhiteSpace` outside the control characters, which are rejected separately. Not `trim()`: it also strips U+FEFF.
const visible = /[^ \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]/

function isPoint(v: unknown, width: number, height: number): v is MarkupPoint {
  return isRecord(v) && typeof v.x === 'number' && typeof v.y === 'number' && v.x >= 0 && v.x <= width && v.y >= 0 && v.y <= height
}
const isStroke = (v: unknown) => typeof v === 'number' && v > 0 && v <= 1000

/**
 * Markup as `EvidenceMarkup.Normalize` on the server accepts it: known kinds, unique IDs, lowercase `#rrggbb`
 * colours, points inside the image and bounded sizes, counts and text. Fields that do not apply to a kind are
 * not checked, because the server drops them (its responses carry them as null).
 */
export function isImageMarkup(v: unknown): v is ImageMarkup {
  if (!isRecord(v) || !Number.isInteger(v.width) || !Number.isInteger(v.height)) return false
  const width = v.width as number, height = v.height as number
  if (width < 1 || width > maxDimension || height < 1 || height > maxDimension) return false
  if (!Array.isArray(v.shapes) || v.shapes.length > markupLimits.shapes) return false
  const ids = new Set<string>()
  return v.shapes.every((shape: unknown) => {
    // The server's .NET patterns end in `$`, which also matches before one final newline.
    if (!isRecord(shape) || !isText(shape.id) || !/^[A-Za-z0-9_-]{1,64}\n?$/.test(shape.id) || ids.has(shape.id)) return false
    ids.add(shape.id)
    if (!isText(shape.color) || !/^#[0-9a-f]{6}\n?$/.test(shape.color)) return false
    switch (shape.kind) {
      case 'pen':
      case 'marker':
        return isStroke(shape.width) && Array.isArray(shape.points) && shape.points.length > 0 && shape.points.length <= markupLimits.points &&
          shape.points.every((point: unknown) => isPoint(point, width, height))
      case 'arrow':
      case 'box':
        return isStroke(shape.width) && isPoint(shape.from, width, height) && isPoint(shape.to, width, height)
      case 'text':
        return isPoint(shape.at, width, height) && typeof shape.size === 'number' && shape.size >= 1 && shape.size <= 2000 &&
          isFilledText(shape.text, markupLimits.text) && visible.test(shape.text) && hasNoControlCharacters(shape.text)
      default:
        return false
    }
  })
}
