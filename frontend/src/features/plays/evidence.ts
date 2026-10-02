import { createEvidenceId, type DraftEvidence } from './draft'

/** Mirrors the server defaults (`Vessel:Evidence`) so a draft never holds what saving would reject. */
export const evidenceLimits = { maxBytes: 10 * 1024 * 1024, maxItems: 50, maxNoteLength: 4000 }
export const evidenceAccept = 'image/png,image/jpeg,image/webp'

const signatures: Array<[string, (bytes: Uint8Array) => boolean]> = [
  ['image/png', bytes => [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((value, index) => bytes[index] === value)],
  ['image/jpeg', bytes => bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff],
  ['image/webp', bytes => text(bytes, 0, 4) === 'RIFF' && text(bytes, 8, 12) === 'WEBP'],
]
const text = (bytes: Uint8Array, start: number, end: number) => String.fromCharCode(...bytes.slice(start, end))

/** Detects PNG, JPEG or WebP from the file signature, as the server does; names and declared types are not trusted. */
export async function sniffImageType(blob: Blob) {
  const bytes = new Uint8Array(await blob.slice(0, 12).arrayBuffer())
  return signatures.find(([, matches]) => matches(bytes))?.[0] ?? null
}

/** Reason the image cannot be added, or null. The item count is checked when it is added. */
export async function evidenceProblem(blob: Blob) {
  if (blob.size === 0) return 'The image is empty.'
  if (blob.size > evidenceLimits.maxBytes) return `Images are limited to ${evidenceLimits.maxBytes / 1024 / 1024} MB.`
  if (!await sniffImageType(blob)) return 'Only PNG, JPEG or WebP images can be added.'
  return null
}

export function createEvidence(source: DraftEvidence['source'], image: Blob, name: string, context = '', now = new Date()): DraftEvidence {
  return { id: createEvidenceId(), source, image, name, context, note: '', markup: null, addedAt: now.toISOString() }
}

/** `vessel-capture-2026-10-02-1403.png` in UTC. */
export function captureFileName(now: Date) {
  const stamp = now.toISOString().slice(0, 16).replace('T', '-').replace(':', '')
  return `vessel-capture-${stamp}.png`
}

export const formatBytes = (bytes: number) => bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`

// Object URLs live as long as their image is in the draft; removing an image revokes its URL.
const urls = new WeakMap<Blob, string>()
export function imageUrl(image: Blob) {
  let url = urls.get(image)
  if (!url) { url = URL.createObjectURL(image); urls.set(image, url) }
  return url
}
export function releaseImageUrl(image: Blob) {
  const url = urls.get(image)
  if (url) { URL.revokeObjectURL(url); urls.delete(image) }
}
