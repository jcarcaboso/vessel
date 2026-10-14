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
