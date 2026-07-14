/**
 * Turns a raw auto-publish failure reason (as recorded on the failed `publish`
 * Job by maybeAutoPublish, src/lib/tools/publish.ts) into one plain-language
 * sentence a non-technical owner can act on. Issue #15: an auto agent that can't
 * post used to leave the video silently "approved" — this is the copy the
 * dashboard shows instead. Pure and side-effect free so it stays unit-testable
 * and reads identically wherever the reason is surfaced.
 */
export function plainPublishNote(reason: string | null | undefined): string {
  const raw = (reason ?? '').trim()
  const r = raw.toLowerCase()

  if (!raw) return 'Not posted yet — publish it from the Review inbox when ready.'

  if (r.includes('not connected'))
    return "Not posted — YouTube isn't connected. Connect it in Settings, then publish from the Review inbox."

  if (r.includes('quota') || r.includes('upload limit'))
    return "Not posted — today's YouTube upload limit was reached. It stays ready; try again tomorrow or raise the limit in Settings."

  if (r.includes('mp4') || r.includes('render'))
    return "Not posted — the finished video file couldn't be found. Re-render it, then publish."

  // Unknown/raw upload error (e.g. a YouTube API rejection): never swallow it,
  // surface it verbatim so a novel failure is still visible.
  return `Not posted — ${raw}`
}
