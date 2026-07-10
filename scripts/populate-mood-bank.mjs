// Populates the F10 mood bank: reads assets/mood-bank/manifest.json and
// downloads/resolves each entry into assets/mood-bank/clips/, writing the
// real license/attribution/dimensions back into the manifest once a file
// lands. Keyless for archive.org entries; Pexels entries need
// PEXELS_API_KEY (get one free at pexels.com/api) — missing key or any
// per-clip failure is a warn-and-skip, never a hard failure. Idempotent:
// re-running skips any entry whose clip file already exists on disk.
//
// Run with: npm run moodbank:populate
import { readFile, writeFile, mkdir, stat, unlink } from 'fs/promises'
import { existsSync } from 'fs'
import { execFile } from 'child_process'
import { promisify } from 'util'
import path from 'path'
import { fileURLToPath } from 'url'

const exec = promisify(execFile)
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')
const MOOD_BANK_DIR = path.join(ROOT, 'assets', 'mood-bank')
const CLIPS_DIR = path.join(MOOD_BANK_DIR, 'clips')
const MANIFEST_PATH = path.join(MOOD_BANK_DIR, 'manifest.json')

const UA = 'ContentEngine-F10-MoodBank/1.0 (local content tool)'
const MAX_BYTES = 60 * 1024 * 1024 // 60MB — this is background atmosphere, not a feature clip
const FETCH_TIMEOUT_MS = 30_000

const PEXELS_KEY = process.env.PEXELS_API_KEY || ''

// ── Small helpers ───────────────────────────────────────────────────────

function withTimeout(ms) {
  const controller = new AbortController()
  const id = setTimeout(() => controller.abort(), ms)
  return { signal: controller.signal, clear: () => clearTimeout(id) }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// archive.org occasionally returns a transient 500/502/503 on an otherwise
// valid URL (confirmed by hand while building this — same URL succeeds on
// retry seconds later). A couple of short retries turn that flakiness into
// a non-issue without masking genuinely broken/missing files.
async function withRetries(fn, attempts = 3, delayMs = 1500) {
  let lastResult = null
  for (let i = 0; i < attempts; i++) {
    const result = await fn()
    if (result === false) return false // permanent failure — don't retry
    if (result !== null) return result // success
    lastResult = null // null == transient — retry
    if (i < attempts - 1) await sleep(delayMs)
  }
  return lastResult
}

async function fetchJson(url, headers = {}) {
  return withRetries(async () => {
    const t = withTimeout(FETCH_TIMEOUT_MS)
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA, ...headers }, signal: t.signal })
      if (!res.ok) return res.status >= 500 ? null : false // 5xx retries, 4xx doesn't
      return await res.json()
    } catch {
      return null
    } finally {
      t.clear()
    }
  })
}

/** Download a URL to `dest`, aborting (and cleaning up) if it exceeds MAX_BYTES. */
async function downloadCapped(url, dest, headers = {}) {
  const result = await withRetries(async () => {
    const t = withTimeout(FETCH_TIMEOUT_MS * 4)
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA, ...headers }, signal: t.signal })
      if (!res.ok) {
        if (res.status >= 500) return null // retry
        console.warn(`  ↳ download failed: HTTP ${res.status}`)
        return false
      }
      const declared = Number(res.headers.get('content-length') || 0)
      if (declared && declared > MAX_BYTES) {
        console.warn(`  ↳ skip (declared size ${declared} bytes exceeds cap)`)
        return false
      }
      const buf = Buffer.from(await res.arrayBuffer())
      if (buf.byteLength > MAX_BYTES) {
        console.warn(`  ↳ skip (downloaded ${buf.byteLength} bytes exceeds cap)`)
        return false
      }
      await writeFile(dest, buf)
      return true
    } catch (err) {
      console.warn(`  ↳ download attempt failed: ${err.message || err}`)
      return null // retry
    } finally {
      t.clear()
    }
  })
  return result === true
}

async function ffprobeAvailable() {
  try {
    await exec('which', ['ffprobe'])
    return true
  } catch {
    return false
  }
}

/** Best-effort width/height/duration via ffprobe; null fields on any failure. */
async function probe(file) {
  try {
    const { stdout } = await exec('ffprobe', [
      '-v', 'error',
      '-select_streams', 'v:0',
      '-show_entries', 'stream=width,height:format=duration',
      '-of', 'json',
      file,
    ])
    const data = JSON.parse(stdout)
    const stream = data.streams?.[0] || {}
    const durationSec = data.format?.duration ? Number(data.format.duration) : undefined
    return {
      width: stream.width,
      height: stream.height,
      durationSec: durationSec && Number.isFinite(durationSec) ? Math.round(durationSec * 100) / 100 : undefined,
    }
  } catch {
    return {}
  }
}

// ── archive.org resolution ──────────────────────────────────────────────

/** Conservative license mapping from an archive.org licenseurl. Mirrors the
 *  honesty discipline documented in README.md: only claim cc0/cc_by when the
 *  URL says so explicitly; NC/ND terms are excluded outright (too risky for
 *  a clip that gets trimmed into a beat); anything else stays 'unknown'. */
function mapArchiveLicense(licenseurl) {
  const s = (licenseurl || '').toLowerCase()
  if (!s) return { license: 'unknown', ok: true }
  if (s.includes('/nc') || s.includes('-nc') || s.includes('/nd') || s.includes('-nd')) {
    return { license: 'unknown', ok: false } // non-commercial / no-derivatives — skip entirely
  }
  if (s.includes('publicdomain/zero')) return { license: 'cc0', ok: true }
  if (s.includes('publicdomain/mark')) return { license: 'unknown', ok: true } // a mark, not a formal license
  if (s.includes('/licenses/by/')) return { license: 'cc_by', ok: true }
  if (s.includes('/licenses/by-sa')) return { license: 'licensed', ok: true } // attribution + share-alike
  if (s.includes('creativecommons.org')) return { license: 'licensed', ok: true }
  return { license: 'unknown', ok: true }
}

async function archiveMetadata(identifier) {
  return fetchJson(`https://archive.org/metadata/${encodeURIComponent(identifier)}`)
}

/** Pick the best video file from an archive.org item's file list: highest
 *  resolution first (a tiny 320×240 transcode blown up to 1080×1920 reads as
 *  blocky no matter how good the downstream scale filter is), skipping the
 *  tiny multi-KB thumbnail-scale transcodes some items also carry, and
 *  tie-breaking by smaller file size when resolution is equal or unknown.
 *  Actual download size is still capped separately (MAX_BYTES). */
function pickArchiveFile(files, preferredName) {
  const vids = (files || []).filter((f) => /\.(mp4|m4v|ogv|webm)$/i.test(f.name || ''))
  if (preferredName) {
    const exact = vids.find((f) => f.name === preferredName)
    if (exact) return exact
  }
  const candidates = vids.filter((f) => Number(f.size || 0) > 200_000)
  const pool = candidates.length ? candidates : vids
  return (
    pool
      .slice()
      .sort((a, b) => {
        const resA = Number(a.width || 0) * Number(a.height || 0)
        const resB = Number(b.width || 0) * Number(b.height || 0)
        if (resB !== resA) return resB - resA // higher resolution wins
        return Number(a.size || 0) - Number(b.size || 0) // tie-break: smaller file
      })[0] || vids[0]
  )
}

async function resolveArchiveEntry(entry) {
  // Already pinned to a specific file — just build the download URL.
  if (entry.downloadUrl) {
    return { downloadUrl: entry.downloadUrl, license: entry.license, licenseRef: entry.licenseRef, attribution: entry.attribution, sourceUrl: entry.sourceUrl }
  }
  if (entry.sourceId) {
    const meta = await archiveMetadata(entry.sourceId)
    if (!meta) return null
    const file = pickArchiveFile(meta.files, entry.sourceFile)
    if (!file) return null
    const { license, ok } = mapArchiveLicense(meta.metadata?.licenseurl)
    if (!ok) return null
    return {
      downloadUrl: `https://archive.org/download/${entry.sourceId}/${encodeURIComponent(file.name)}`,
      license,
      licenseRef: meta.metadata?.licenseurl ? `${meta.metadata.licenseurl} — via archive.org` : undefined,
      attribution: meta.metadata?.creator ? `${meta.metadata.creator}, via archive.org` : 'Via archive.org',
      sourceUrl: `https://archive.org/details/${entry.sourceId}`,
    }
  }
  if (entry.searchQuery) {
    const searchUrl =
      'https://archive.org/advancedsearch.php?output=json&rows=8' +
      '&fl%5B%5D=identifier&fl%5B%5D=title&fl%5B%5D=licenseurl' +
      `&q=${encodeURIComponent(entry.searchQuery)}`
    const data = await fetchJson(searchUrl)
    const docs = data?.response?.docs || []
    for (const doc of docs) {
      if (!doc.identifier) continue
      const meta = await archiveMetadata(doc.identifier)
      if (!meta) continue
      const file = pickArchiveFile(meta.files)
      if (!file) continue
      const { license, ok } = mapArchiveLicense(meta.metadata?.licenseurl ?? doc.licenseurl)
      if (!ok) continue
      return {
        downloadUrl: `https://archive.org/download/${doc.identifier}/${encodeURIComponent(file.name)}`,
        license,
        licenseRef: (meta.metadata?.licenseurl ?? doc.licenseurl) ? `${meta.metadata?.licenseurl ?? doc.licenseurl} — via archive.org` : undefined,
        attribution: meta.metadata?.creator ? `${meta.metadata.creator}, via archive.org` : 'Via archive.org',
        sourceUrl: `https://archive.org/details/${doc.identifier}`,
        sourceId: doc.identifier,
      }
    }
    return null
  }
  return null
}

// ── Pexels resolution ────────────────────────────────────────────────────

function pickPexelsFile(videoFiles) {
  const vids = (videoFiles || []).filter((f) => f.file_type === 'video/mp4')
  const portrait = vids.filter((f) => (f.height || 0) > (f.width || 0))
  const pool = portrait.length ? portrait : vids
  // Prefer a modest resolution — this is background atmosphere.
  return pool.sort((a, b) => (a.width || 0) - (b.width || 0))[0] || pool[0]
}

async function resolvePexelsEntry(entry) {
  if (!PEXELS_KEY) return null
  const headers = { Authorization: PEXELS_KEY }
  let video = null
  if (entry.sourceId) {
    video = await fetchJson(`https://api.pexels.com/videos/videos/${entry.sourceId}`, headers)
  } else if (entry.pexelsQuery) {
    const data = await fetchJson(
      `https://api.pexels.com/videos/search?query=${encodeURIComponent(entry.pexelsQuery)}&orientation=portrait&per_page=5`,
      headers
    )
    video = data?.videos?.[0] || null
  }
  if (!video) return null
  const file = pickPexelsFile(video.video_files)
  if (!file) return null
  return {
    downloadUrl: file.link,
    license: 'licensed',
    licenseRef: 'Pexels License',
    attribution: video.user?.name ? `Pexels — ${video.user.name}` : 'Pexels',
    sourceUrl: video.url,
    width: file.width,
    height: file.height,
    durationSec: video.duration,
    sourceId: String(video.id),
  }
}

// ── Main ─────────────────────────────────────────────────────────────────

async function main() {
  await mkdir(CLIPS_DIR, { recursive: true })

  const raw = await readFile(MANIFEST_PATH, 'utf8')
  const manifest = JSON.parse(raw)
  if (!Array.isArray(manifest)) {
    console.error('manifest.json is not an array — aborting without writing anything.')
    process.exit(0)
  }

  const canProbe = await ffprobeAvailable()
  if (!PEXELS_KEY) {
    console.warn('PEXELS_API_KEY not set — Pexels entries will be skipped (archive.org entries still run).')
  }

  let populatedCount = 0
  let skippedCount = 0

  for (const entry of manifest) {
    const dest = path.join(CLIPS_DIR, entry.file)

    if (existsSync(dest)) {
      const s = await stat(dest)
      if (s.size > 0) {
        entry.populated = true
        populatedCount++
        continue
      }
    }

    console.log(`→ ${entry.id} (${entry.source})`)

    let resolved = null
    try {
      if (entry.source === 'archive.org') {
        resolved = await resolveArchiveEntry(entry)
      } else if (entry.source === 'pexels') {
        resolved = await resolvePexelsEntry(entry)
      } else {
        console.warn(`  ↳ unknown source "${entry.source}" — skipping`)
      }
    } catch (err) {
      console.warn(`  ↳ resolve failed: ${err.message || err}`)
    }

    if (!resolved || !resolved.downloadUrl) {
      console.warn(`  ↳ no candidate found — leaving unpopulated`)
      skippedCount++
      await sleep(500) // be polite before the next entry's requests
      continue
    }

    const ok = await downloadCapped(resolved.downloadUrl, dest)
    if (!ok) {
      console.warn(`  ↳ download failed after retries — leaving unpopulated`)
      if (existsSync(dest)) await unlink(dest).catch(() => {})
      skippedCount++
      await sleep(500)
      continue
    }

    entry.downloadUrl = resolved.downloadUrl
    entry.license = resolved.license ?? entry.license
    if (resolved.licenseRef) entry.licenseRef = resolved.licenseRef
    if (resolved.attribution) entry.attribution = resolved.attribution
    if (resolved.sourceUrl) entry.sourceUrl = resolved.sourceUrl
    if (resolved.sourceId) entry.sourceId = resolved.sourceId
    if (resolved.width) entry.width = resolved.width
    if (resolved.height) entry.height = resolved.height
    if (resolved.durationSec) entry.durationSec = resolved.durationSec

    if (canProbe && (!entry.width || !entry.height || !entry.durationSec)) {
      const probed = await probe(dest)
      entry.width = entry.width ?? probed.width
      entry.height = entry.height ?? probed.height
      entry.durationSec = entry.durationSec ?? probed.durationSec
    }

    entry.populated = true
    populatedCount++
    console.log(`  ↳ populated (${entry.license})`)

    // Be polite to archive.org/Pexels — a burst of back-to-back requests
    // across many entries has been observed to trigger transient 401/403s.
    await sleep(500)
  }

  await writeFile(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + '\n')
  console.log(`\n✓ Mood bank: ${populatedCount}/${manifest.length} clips populated (${skippedCount} skipped).`)
}

main().catch((err) => {
  // Never hard-fail the owner's terminal — a populate run is best-effort.
  console.error('[populate-mood-bank] unexpected error (non-fatal):', err)
  process.exit(0)
})
