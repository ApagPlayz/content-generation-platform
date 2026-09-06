// One escaper for every string we hand to ffmpeg's `drawtext` filter.
//
// An inline `-vf` string is parsed in TWO passes before drawtext ever sees the
// text, and a character may be special to either:
//   1. the filtergraph parser   \ ' , ; [ ] @   (runs FIRST, eats its own backslashes)
//   2. the filter option parser \ ' :           (runs on pass 1's output)
// So anything that must survive to drawtext is escaped TWICE. We deliberately do
// NOT wrap the value in single quotes: quoting and escaping compose badly (an
// apostrophe cannot be escaped inside a quoted string at all), and mixing the two
// is exactly what produced the bug this module was written for.
//
// A THIRD layer — drawtext's own `%{...}` expansion — cannot be escaped. It is
// switched off at every call site with `expansion=none`. Without it a bare `%` in
// model-written copy ("Shot 60% from three") makes drawtext log "Stray %", draw
// NOTHING, and still exit 0 — so the video ships with no hook on screen and no
// error anywhere. That silent failure is worse than a crash; keep expansion=none.
//
// There is no shell layer to worry about: ffmpeg is always spawned through
// execFile with an argv array, never a shell string.

const OPTION_SPECIALS = /[\\':]/g
const GRAPH_SPECIALS = /[\\'[\],;@]/g

/**
 * Escape an already-sanitized line for inline use as an unquoted drawtext
 * `text=` value. Escapes for the option parser first, then escapes that result
 * (backslashes included) for the filtergraph parser.
 */
export function escapeDrawtext(text: string): string {
  return text.replace(OPTION_SPECIALS, '\\$&').replace(GRAPH_SPECIALS, '\\$&')
}

/**
 * Flatten model copy into a single printable line and cap its length.
 *
 * Truncation happens HERE, before escaping — slicing escaped text can cut a `\:`
 * in half and leave a dangling backslash that swallows the next option. Sliced by
 * code point so an emoji's surrogate pair is never split (hooks routinely carry
 * emoji, and hookScore actively rewards them).
 */
export function sanitizeOverlayText(raw: string, maxLen = 90): string {
  const line = String(raw ?? '')
    .replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return Array.from(line).slice(0, maxLen).join('').trim()
}

/** Sanitize then escape. Returns '' when there is nothing worth drawing. */
export function drawtextValue(raw: string, maxLen = 90): string {
  const clean = sanitizeOverlayText(raw, maxLen)
  return clean ? escapeDrawtext(clean) : ''
}
