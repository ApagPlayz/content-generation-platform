// RFC 7233 byte-range parsing for a single-range media request.
//
// Safari and iOS refuse to play a <video> whose source can't answer HTTP Range
// requests with a 206 partial response — they send `Range: bytes=0-` and treat a
// plain 200 as non-seekable (iOS often won't start playback at all). The media
// route depends on this helper to decide how to respond.
//
// Kept pure (no fs, no I/O) so every branch is unit-testable without mocks.
//
// Result:
//   { start, end }   inclusive byte offsets to stream  → caller sends 206
//   'full'           no Range header, or one we choose to ignore → 200 whole file
//   'unsatisfiable'  a valid range that can't be met     → 416
//
// "Ignore → full" is deliberate: RFC 7233 §3.1 lets a server ignore a Range
// header it doesn't understand, so for anything unsupported (non-"bytes" unit,
// multipart, malformed syntax, inverted range) we fall back to a normal 200
// rather than erroring — the safest choice for browser compatibility.
export type ParsedRange = { start: number; end: number }
export type RangeResult = ParsedRange | 'full' | 'unsatisfiable'

const isDigits = (s: string) => /^[0-9]+$/.test(s)

export function parseRange(rangeHeader: string | null, size: number): RangeResult {
  if (!rangeHeader) return 'full'

  // Only the "bytes" unit is supported; anything else → serve the whole entity.
  const m = /^bytes=(.*)$/.exec(rangeHeader.trim())
  if (!m) return 'full'

  const spec = m[1].trim()
  if (spec === '' || spec.includes(',')) return 'full' // no multipart ranges

  const dash = spec.indexOf('-')
  if (dash === -1) return 'full'

  const startStr = spec.slice(0, dash).trim()
  const endStr = spec.slice(dash + 1).trim()

  let start: number
  let end: number

  if (startStr === '') {
    // Suffix range "bytes=-N" → the last N bytes (RFC 7233 §2.1).
    if (!isDigits(endStr)) return 'full' // "bytes=-" or garbage → ignore
    const suffix = Number(endStr)
    if (suffix === 0 || size === 0) return 'unsatisfiable'
    start = Math.max(size - suffix, 0) // N larger than file → whole file
    end = size - 1
  } else {
    // "bytes=start-" (open-ended) or "bytes=start-end".
    if (!isDigits(startStr)) return 'full'
    start = Number(startStr)

    if (endStr === '') {
      end = size - 1
    } else {
      if (!isDigits(endStr)) return 'full'
      end = Number(endStr)
    }

    if (start >= size) return 'unsatisfiable' // first byte at/after EOF
    if (end < start) return 'full' // inverted → ignore rather than 416
    if (end > size - 1) end = size - 1 // clamp to last byte
  }

  return { start, end }
}
