import { readFileSync, statSync } from 'fs'
import { prisma } from './prisma'

/**
 * TikTok OAuth + Content Posting API helpers (issue #19 — publish to more than
 * just YouTube). Deliberately mirrors src/lib/youtube.ts so the two platforms
 * behave the same: app credentials live in the Setting table (entered in the
 * Settings UI, not env), tokens live in PlatformAuth, and the refresh token is
 * used to mint fresh access tokens which we persist on rotation.
 *
 * We use plain `fetch` rather than an SDK to avoid a new runtime dependency.
 *
 * Heads-up for the operator: a brand-new TikTok app can only post **privately**
 * (SELF_ONLY) until TikTok approves it for public posting via their app-review /
 * audit — exactly the way YouTube needs a Google Cloud OAuth client first. The
 * connect flow works regardless; the upload just defaults to private until then.
 */

export const PLATFORM = 'tiktok'

// user.info.basic → read the creator handle for the Settings pill.
// video.publish   → Direct Post (upload straight to the profile).
export const SCOPES = ['user.info.basic', 'video.publish']

const AUTHORIZE_URL = 'https://www.tiktok.com/v2/auth/authorize/'
const TOKEN_URL = 'https://open.tiktokapis.com/v2/oauth/token/'
const USER_INFO_URL = 'https://open.tiktokapis.com/v2/user/info/'
const API_BASE = 'https://open.tiktokapis.com/v2'

// A TikTok caption maxes out at 2200 characters.
const MAX_CAPTION = 2200

function baseUrl(): string {
  return process.env.APP_BASE_URL || 'http://localhost:3000'
}

export function redirectUri(): string {
  return `${baseUrl()}/api/auth/tiktok/callback`
}

interface TikTokTokens {
  access_token?: string
  refresh_token?: string
  expires_in?: number
  refresh_expires_in?: number
  open_id?: string
  scope?: string
}

async function settings(): Promise<Record<string, string>> {
  const rows = await prisma.setting.findMany({
    where: { key: { in: ['tiktok_client_key', 'tiktok_client_secret'] } },
  })
  return Object.fromEntries(rows.map((r) => [r.key, r.value]))
}

/** App credentials from Settings. Throws (with a friendly message) if unset. */
async function clientCreds(): Promise<{ clientKey: string; clientSecret: string }> {
  const s = await settings()
  const clientKey = s.tiktok_client_key
  const clientSecret = s.tiktok_client_secret
  if (!clientKey || !clientSecret) {
    throw new Error('TikTok app not configured. Add the client key + secret in Settings.')
  }
  return { clientKey, clientSecret }
}

/** Pretty-print whatever error shape TikTok returned (string or {error:{message}}). */
function tiktokError(data: unknown): string | null {
  if (!data || typeof data !== 'object') return null
  const d = data as Record<string, unknown>
  if (typeof d.error === 'string') {
    return (d.error_description as string) || (d.error as string)
  }
  const err = d.error as Record<string, unknown> | undefined
  if (err && typeof err === 'object' && err.code && err.code !== 'ok') {
    return (err.message as string) || (err.code as string)
  }
  return null
}

/**
 * Build the consent URL from its parts. Pure + unit-tested so the wiring can be
 * verified without hitting the network or needing real credentials.
 */
export function authorizeUrl(clientKey: string, redirect: string, state: string): string {
  const p = new URLSearchParams({
    client_key: clientKey,
    scope: SCOPES.join(','),
    response_type: 'code',
    redirect_uri: redirect,
    state,
  })
  return `${AUTHORIZE_URL}?${p.toString()}`
}

/** A public TikTok video URL (or the profile URL when we only have a handle). */
export function tiktokPermalink(handle: string, postId?: string): string {
  const h = (handle || '').replace(/^@/, '')
  if (!h) return postId ? `https://www.tiktok.com/video/${postId}` : 'https://www.tiktok.com'
  return postId ? `https://www.tiktok.com/@${h}/video/${postId}` : `https://www.tiktok.com/@${h}`
}

// ── Anti-shadowban caption humanization (issue #88) ─────────────────────────
// TikTok throttles ("shadowbans") accounts whose posts look automated. The #1
// named trigger is metadata that matches an existing video — so a TikTok caption
// that is byte-identical to what already went to YouTube is exactly what we must
// never send. These helpers build a TikTok-native caption that (a) opens with a
// varied, natural hook, (b) always carries a discovery tag YouTube never uses,
// and (c) is guaranteed never byte-identical to the YouTube title/description.

// Neutral, non-misleading openers — safe across sports / true-crime / history.
// Rotated per-video so every caption doesn't read identically (itself a bot tell).
export const TIKTOK_OPENERS = [
  'Here’s the story 👇',
  'Watch till the end 👀',
  'You’ll want to see this.',
  'Wait for it…',
  'The full story below 👇',
  'Save this one for later.',
]

// TikTok-native discovery tags a YouTube description never carries. Including one
// guarantees the caption diverges from the cross-posted YouTube metadata.
export const TIKTOK_NATIVE_TAGS = ['fyp', 'foryou', 'foryoupage']

/**
 * Deterministic, non-negative bucket index derived from a seed string (char-sum
 * mod buckets). Deterministic so the same video always yields the same caption
 * — re-publishing is idempotent and the tests are reproducible — while different
 * videos spread across the buckets. Returns 0 for a non-positive bucket count.
 */
export function captionVariant(seed: string, buckets: number): number {
  if (buckets <= 0) return 0
  let sum = 0
  for (let i = 0; i < seed.length; i++) sum = (sum + seed.charCodeAt(i)) % buckets
  return sum
}

/**
 * Build a humanized TikTok caption for a video. Pure + unit-tested so the
 * anti-shadowban guarantees hold without hitting the network:
 *  - opens with a per-video rotated natural hook,
 *  - normalises + dedupes the hashtags and appends a native discovery tag,
 *  - is capped at TikTok's 2200-char limit,
 *  - is GUARANTEED never byte-identical to any string in `avoid` (the YouTube
 *    title/description) — if an assembled caption collides, it rotates to the
 *    next opener until it differs.
 */
export function buildTikTokCaption(input: {
  title: string
  hashtags: string[]
  seed: string
  avoid?: string[]
}): string {
  const { title, hashtags, seed } = input
  const avoidSet = new Set(input.avoid ?? [])

  // Normalise the supplied hashtags: strip leading #, lowercase, drop blanks,
  // dedupe case-insensitively while preserving order.
  const seen = new Set<string>()
  const tags: string[] = []
  for (const raw of hashtags) {
    const t = raw.replace(/^#+/, '').trim().toLowerCase()
    if (t && !seen.has(t)) {
      seen.add(t)
      tags.push(t)
    }
  }

  // Always include a TikTok-native discovery tag YouTube never uses.
  const nativeTag = TIKTOK_NATIVE_TAGS[captionVariant(`${seed}:tag`, TIKTOK_NATIVE_TAGS.length)]
  if (!seen.has(nativeTag)) tags.push(nativeTag)
  const tagStr = tags.map((t) => `#${t}`).join(' ')

  // Rotate the opener per-video; step forward on the (extremely unlikely) chance
  // the caption still collides with a value we must avoid, so the guarantee is
  // hard rather than incidental.
  const start = captionVariant(seed, TIKTOK_OPENERS.length)
  let caption = ''
  for (let i = 0; i < TIKTOK_OPENERS.length; i++) {
    const opener = TIKTOK_OPENERS[(start + i) % TIKTOK_OPENERS.length]
    caption = [opener, title.trim(), tagStr].filter(Boolean).join(' ').slice(0, MAX_CAPTION)
    if (!avoidSet.has(caption)) return caption
  }
  return caption
}

/** Consent URL — throws if the app isn't configured yet. */
export async function authUrl(): Promise<string> {
  const { clientKey } = await clientCreds()
  // A local single-user tool: we send a state param (TikTok requires one) but,
  // like the YouTube flow, don't round-trip verify it.
  return authorizeUrl(clientKey, redirectUri(), 'connect')
}

async function fetchHandle(accessToken: string): Promise<string | null> {
  try {
    const res = await fetch(`${USER_INFO_URL}?fields=open_id,display_name`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    const data = (await res.json()) as { data?: { user?: { display_name?: string } } }
    return data?.data?.user?.display_name ?? null
  } catch {
    return null
  }
}

/** Exchange the callback code, fetch the handle, persist to PlatformAuth. */
export async function exchangeAndStore(code: string): Promise<{ handle: string }> {
  const { clientKey, clientSecret } = await clientCreds()
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_key: clientKey,
      client_secret: clientSecret,
      code,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri(),
    }),
  })
  const data = (await res.json()) as TikTokTokens & Record<string, unknown>
  if (!res.ok || tiktokError(data) || !data.access_token) {
    throw new Error(tiktokError(data) || 'TikTok token exchange failed')
  }

  const handle =
    (await fetchHandle(data.access_token)) || data.open_id || 'TikTok account'
  const expiresAt = data.expires_in ? new Date(Date.now() + data.expires_in * 1000) : null
  const scopes = data.scope || SCOPES.join(',')

  await prisma.platformAuth.upsert({
    where: { platform_accountHandle: { platform: PLATFORM, accountHandle: handle } },
    update: { tokens: JSON.stringify(data), scopes, expiresAt, status: 'active' },
    create: {
      platform: PLATFORM,
      accountHandle: handle,
      tokens: JSON.stringify(data),
      scopes,
      expiresAt,
      status: 'active',
    },
  })

  return { handle }
}

/** The active TikTok connection row, or null if not connected. */
export async function connection() {
  return prisma.platformAuth.findFirst({
    where: { platform: PLATFORM, status: 'active' },
    orderBy: { updatedAt: 'desc' },
  })
}

/**
 * A valid access token, refreshing (and persisting the rotation) when the stored
 * one is expired or about to expire. Mirrors youtube.ts's authedClient, but for
 * TikTok's plain-fetch OAuth we return the bare token string.
 */
export async function accessToken(): Promise<string> {
  const conn = await connection()
  if (!conn) throw new Error('TikTok is not connected. Connect it in Settings first.')
  const tokens: TikTokTokens = JSON.parse(conn.tokens)

  // Refresh a minute early so a long upload never starts on a stale token.
  const stillFresh =
    !!tokens.access_token &&
    (!conn.expiresAt || conn.expiresAt.getTime() - Date.now() > 60_000)
  if (stillFresh) return tokens.access_token as string

  if (!tokens.refresh_token) {
    throw new Error('TikTok session expired. Reconnect it in Settings.')
  }
  const { clientKey, clientSecret } = await clientCreds()
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_key: clientKey,
      client_secret: clientSecret,
      grant_type: 'refresh_token',
      refresh_token: tokens.refresh_token,
    }),
  })
  const data = (await res.json()) as TikTokTokens & Record<string, unknown>
  if (!res.ok || tiktokError(data) || !data.access_token) {
    throw new Error(tiktokError(data) || 'TikTok token refresh failed')
  }
  const merged = { ...tokens, ...data }
  await prisma.platformAuth.update({
    where: { id: conn.id },
    data: {
      tokens: JSON.stringify(merged),
      expiresAt: data.expires_in ? new Date(Date.now() + data.expires_in * 1000) : conn.expiresAt,
    },
  })
  return merged.access_token as string
}

export interface DirectPostInput {
  filePath: string
  caption: string
  privacy: string
}

export interface DirectPostResult {
  publishId: string
  postId?: string
}

// Terminal states from status/fetch — everything else means "still processing".
const DONE = 'PUBLISH_COMPLETE'
const FAILED = 'FAILED'

/**
 * Upload + publish a rendered MP4 via the Content Posting API (Direct Post):
 *   1. init  → reserve a publish_id + one-shot upload_url
 *   2. PUT   → stream the file bytes (single chunk; a Short fits comfortably)
 *   3. poll  → check status a few times to catch an immediate rejection
 *
 * We poll only briefly: TikTok finishes encoding asynchronously, so once the
 * bytes are accepted we treat it as submitted rather than blocking the whole
 * publish on TikTok's server-side processing.
 */
export async function directPost(input: DirectPostInput): Promise<DirectPostResult> {
  const token = await accessToken()
  const size = statSync(input.filePath).size

  const initRes = await fetch(`${API_BASE}/post/publish/video/init/`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json; charset=UTF-8',
    },
    body: JSON.stringify({
      post_info: {
        title: input.caption.slice(0, MAX_CAPTION),
        privacy_level: input.privacy,
        disable_comment: false,
        disable_duet: false,
        disable_stitch: false,
      },
      source_info: {
        source: 'FILE_UPLOAD',
        video_size: size,
        chunk_size: size,
        total_chunk_count: 1,
      },
    }),
  })
  const initData = (await initRes.json()) as {
    data?: { publish_id?: string; upload_url?: string }
  }
  if (!initRes.ok || tiktokError(initData)) {
    throw new Error(tiktokError(initData) || 'TikTok upload could not be started')
  }
  const publishId = initData.data?.publish_id
  const uploadUrl = initData.data?.upload_url
  if (!publishId || !uploadUrl) throw new Error('TikTok did not return an upload URL')

  const buf = readFileSync(input.filePath)
  const putRes = await fetch(uploadUrl, {
    method: 'PUT',
    headers: {
      'Content-Type': 'video/mp4',
      'Content-Range': `bytes 0-${size - 1}/${size}`,
    },
    body: buf,
  })
  if (!putRes.ok) throw new Error(`TikTok upload failed (HTTP ${putRes.status})`)

  const postId = await pollStatus(token, publishId)
  return { publishId, postId }
}

/** Briefly poll publish status; returns a public post id if one is ready. */
async function pollStatus(token: string, publishId: string): Promise<string | undefined> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetch(`${API_BASE}/post/publish/status/fetch/`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json; charset=UTF-8',
      },
      body: JSON.stringify({ publish_id: publishId }),
    })
    const data = (await res.json()) as {
      data?: { status?: string; publicaly_available_post_id?: string[] }
    }
    const err = tiktokError(data)
    if (err) throw new Error(err)
    const status = data.data?.status
    if (status === FAILED) throw new Error('TikTok rejected the video during processing')
    const postId = data.data?.publicaly_available_post_id?.[0]
    if (status === DONE || postId) return postId
    await sleep(2000)
  }
  // Still encoding — accepted, TikTok will finish on its side.
  return undefined
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
