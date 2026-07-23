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

// Plain-language reason shown to the owner wherever a video didn't post because
// the TikTok login lapsed — never the raw invalid_grant / 401 OAuth jargon.
// Mirrors youtube.ts's YT_RECONNECT_MESSAGE so both platforms read the same.
export const TIKTOK_RECONNECT_MESSAGE =
  'TikTok disconnected — your login expired. Reconnect in Settings to resume publishing.'

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

/** Tri-state for the Settings UI. 'none' = never connected / disconnected. */
export type TikTokConnState = 'active' | 'needs_reconnect' | 'none'

/**
 * True when a TikTok failure means the stored grant is dead and the owner must
 * reconnect — the refresh token was revoked or hit its fixed expiry (TikTok's
 * OAuth token endpoint answers with `invalid_grant`/`invalid_token`, HTTP < 500),
 * or a Content Posting API call came back 401. Deliberately conservative: a 5xx,
 * a rate-limit (429) or a network error (no numeric status) do NOT match, so a
 * healthy login is never wrongly flagged. Pure — unit-testable with no DB or
 * network. The `status`/`tiktokError` fields are tagged onto the errors thrown in
 * accessToken()/directPost() so this can read structured signal, not brittle text.
 */
export function isAuthError(e: unknown): boolean {
  if (!e || typeof e !== 'object') return false
  const err = e as { message?: unknown; status?: unknown; tiktokError?: unknown }
  const status = Number(err.status)
  // A 401 from an authenticated API call — the access token was rejected.
  if (status === 401) return true
  // OAuth refresh refusal for a revoked/expired refresh token. Guard on < 500 so
  // a transient server blip that happens to echo an error code is never treated
  // as a dead grant.
  if (
    (err.tiktokError === 'invalid_grant' || err.tiktokError === 'invalid_token') &&
    status < 500
  ) {
    return true
  }
  // Fallback for the plain-message shapes our own code throws once it has already
  // decided the login is dead (accessToken's reconnect throw / "session expired").
  const msg = typeof err.message === 'string' ? err.message : ''
  return /invalid_grant|invalid_token|session expired|reconnect in settings/i.test(msg)
}

/**
 * Flip the live TikTok connection from active → needs_reconnect after an auth
 * failure, so Settings and auto-publish stop treating a dead grant as healthy.
 * Idempotent (the `status: 'active'` guard makes a repeat call, or a call after a
 * manual Disconnect, a no-op) and swallows its own errors — this health
 * bookkeeping must never mask the original error the caller is handling.
 */
export async function markNeedsReconnect(): Promise<void> {
  try {
    await prisma.platformAuth.updateMany({
      where: { platform: PLATFORM, status: 'active' },
      data: { status: 'needs_reconnect' },
    })
  } catch {
    // A status-flip hiccup must not fail the run that's already handling an error.
  }
}

/**
 * Connection state for the UI. Unlike connection() (active-only, used to GATE
 * publishing), this also surfaces a needs_reconnect row so the owner is told the
 * login went stale — "Reconnect needed" — instead of a bare "Not connected".
 */
export async function connectionState(): Promise<{ state: TikTokConnState; handle?: string }> {
  const row = await prisma.platformAuth.findFirst({
    where: { platform: PLATFORM, status: { in: ['active', 'needs_reconnect'] } },
    orderBy: { updatedAt: 'desc' },
  })
  if (!row) return { state: 'none' }
  return {
    state: row.status === 'active' ? 'active' : 'needs_reconnect',
    handle: row.accountHandle,
  }
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
    // No refresh token stored means this grant can never be renewed — it's dead.
    // Flip the connection so Settings stops painting it green, then report it in
    // plain language instead of leaving the channel to silently go dark.
    await markNeedsReconnect()
    throw new Error(TIKTOK_RECONNECT_MESSAGE)
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
    // Tag the failure with structured signal so isAuthError can tell a dead
    // refresh token (needs reconnect) from a transient 5xx (safe to retry later).
    const failure = Object.assign(
      new Error(tiktokError(data) || 'TikTok token refresh failed'),
      { status: res.status, tiktokError: typeof data.error === 'string' ? data.error : undefined }
    )
    if (isAuthError(failure)) {
      await markNeedsReconnect()
      throw new Error(TIKTOK_RECONNECT_MESSAGE)
    }
    throw failure
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
    // Tag the HTTP status: a 401 here means a revoked grant that was still
    // clock-fresh (so the refresh path above never ran) — isAuthError catches it
    // in the publish layer and flips the connection to needs_reconnect.
    throw Object.assign(
      new Error(tiktokError(initData) || 'TikTok upload could not be started'),
      { status: initRes.status }
    )
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
