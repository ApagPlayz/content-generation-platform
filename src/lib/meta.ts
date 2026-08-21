import { readFileSync, statSync } from 'fs'
import { prisma } from './prisma'

/**
 * Meta (Facebook Reels) OAuth + Reels Publishing API helpers (issue #58 — post
 * the finished video to more than just YouTube + TikTok). Deliberately mirrors
 * src/lib/tiktok.ts so the three platforms behave the same: app credentials live
 * in the Setting table (entered in the Settings UI, not env), tokens live in
 * PlatformAuth, and the same idempotent per-(video, platform) publish contract in
 * publish.ts applies. We use plain `fetch` rather than an SDK to avoid a new
 * runtime dependency.
 *
 * Two things differ from TikTok and are the whole reason this file isn't a pure
 * copy:
 *   1. Reels post to a **Facebook Page**, not a personal profile. After the user
 *      logs in we fetch their Pages (/me/accounts) and use the first Page's own
 *      access token to publish. An account that manages no Page gets a friendly
 *      "create a Page first" error.
 *   2. Meta has **no refresh_token**. We upgrade the login to a long-lived
 *      (~60-day) token once, and when that lapses the connection simply flips to
 *      needs_reconnect — there is no silent refresh path like TikTok's.
 *
 * Heads-up for the operator: like YouTube's Google Cloud client and TikTok's
 * app audit, a brand-new Meta app can only post to a Page **you** administer
 * until Meta approves it via App Review. The connect flow works regardless.
 */

export const PLATFORM = 'facebook'

// Plain-language reason shown to the owner wherever a video didn't post because
// the Facebook login lapsed — never the raw OAuthException / code 190 jargon.
// Mirrors tiktok.ts's TIKTOK_RECONNECT_MESSAGE so every platform reads the same.
export const FACEBOOK_RECONNECT_MESSAGE =
  'Facebook disconnected — your login expired. Reconnect in Settings to resume publishing.'

// pages_show_list       → list the Pages this account manages (/me/accounts)
// pages_read_engagement → read the Page name for the Settings pill
// pages_manage_posts    → create the Reel on the Page
// publish_video         → publish video/reel content to the Page
export const SCOPES = [
  'pages_show_list',
  'pages_read_engagement',
  'pages_manage_posts',
  'publish_video',
]

// Pinned once and used on BOTH hosts (graph + rupload) — a version mismatch
// between them, or an unversioned rupload path, is a classic silent-400 source.
const GRAPH_VERSION = 'v21.0'
const AUTHORIZE_URL = `https://www.facebook.com/${GRAPH_VERSION}/dialog/oauth`
const GRAPH = `https://graph.facebook.com/${GRAPH_VERSION}`
const RUPLOAD = `https://rupload.facebook.com/video-upload/${GRAPH_VERSION}`

// A Facebook Reel description is generous; cap defensively to match tiktok.ts.
const MAX_CAPTION = 2200

function baseUrl(): string {
  return process.env.APP_BASE_URL || 'http://localhost:3000'
}

export function redirectUri(): string {
  return `${baseUrl()}/api/auth/facebook/callback`
}

/** What we persist in PlatformAuth.tokens for a connected Facebook account. */
interface StoredTokens {
  /** The PAGE access token — this is what every Reels API call uses. */
  page_access_token?: string
  /** The long-lived USER token, kept so a future re-pick of the Page is possible. */
  user_access_token?: string
  page_id?: string
  page_name?: string
  /** Seconds-to-live of the long-lived user token (~60 days) at connect time. */
  expires_in?: number
}

async function settings(): Promise<Record<string, string>> {
  const rows = await prisma.setting.findMany({
    where: { key: { in: ['facebook_app_id', 'facebook_app_secret'] } },
  })
  return Object.fromEntries(rows.map((r) => [r.key, r.value]))
}

/** App credentials from Settings. Throws (with a friendly message) if unset. */
async function clientCreds(): Promise<{ appId: string; appSecret: string }> {
  const s = await settings()
  const appId = s.facebook_app_id
  const appSecret = s.facebook_app_secret
  if (!appId || !appSecret) {
    throw new Error('Facebook app not configured. Add the App ID + App Secret in Settings.')
  }
  return { appId, appSecret }
}

/**
 * Pull the structured error out of a Graph API response. Graph always shapes an
 * error as `{ error: { message, type, code, error_subcode, fbtrace_id } }`, so
 * the caller can classify a dead token (code 190) apart from a rate-limit (code
 * 4/17/32) apart from a transient 5xx. Pure — unit-tested.
 */
export function parseFbError(
  data: unknown
): { message: string; code?: number; subcode?: number } | null {
  if (!data || typeof data !== 'object') return null
  const err = (data as Record<string, unknown>).error
  if (!err || typeof err !== 'object') return null
  const e = err as Record<string, unknown>
  return {
    message: typeof e.message === 'string' ? e.message : 'Facebook API error',
    code: typeof e.code === 'number' ? e.code : undefined,
    subcode: typeof e.error_subcode === 'number' ? e.error_subcode : undefined,
  }
}

/** Wrap a Graph failure as an Error tagged with structured signal for isAuthError. */
function fbFailure(data: unknown, status: number, fallback: string): Error {
  const parsed = parseFbError(data)
  return Object.assign(new Error(parsed?.message || fallback), {
    status,
    fbCode: parsed?.code,
    fbSubcode: parsed?.subcode,
  })
}

/**
 * Build the consent URL from its parts. Pure + unit-tested so the wiring can be
 * verified without hitting the network or needing real credentials. Note the
 * consent dialog lives on www.facebook.com, NOT graph.facebook.com.
 */
export function authorizeUrl(appId: string, redirect: string, state: string): string {
  const p = new URLSearchParams({
    client_id: appId,
    redirect_uri: redirect,
    state,
    response_type: 'code',
    scope: SCOPES.join(','),
  })
  return `${AUTHORIZE_URL}?${p.toString()}`
}

/** A public Facebook Reel URL. Reel URLs key on the video id alone (no handle). */
export function facebookReelPermalink(videoId?: string): string {
  return videoId ? `https://www.facebook.com/reel/${videoId}` : 'https://www.facebook.com'
}

export interface FacebookPage {
  id: string
  name: string
  access_token: string
}

/**
 * Pick the Page to publish to from /me/accounts. A single-user local tool takes
 * the first Page. The realistic non-technical-owner failure is "I logged in but
 * manage no Page" (Reels can't post to a personal profile) — so that gets a
 * plain-language error that names the fix. Pure + unit-tested.
 */
export function selectPage(
  accounts: { data?: Array<Partial<FacebookPage>> } | null | undefined
): FacebookPage {
  const first = accounts?.data?.[0]
  if (!first || !first.id || !first.access_token) {
    throw new Error(
      'No Facebook Page found on this account — Reels can only post to a Page, not a personal ' +
        'profile. Create (or get access to) a Facebook Page, then reconnect.'
    )
  }
  return { id: first.id, name: first.name || 'Facebook Page', access_token: first.access_token }
}

/** Consent URL — throws if the app isn't configured yet. */
export async function authUrl(): Promise<string> {
  const { appId } = await clientCreds()
  // A local single-user tool: we send a state param (Meta requires one) but,
  // like the YouTube/TikTok flows, don't round-trip verify it.
  return authorizeUrl(appId, redirectUri(), 'connect')
}

/**
 * Exchange the callback code, upgrade to a long-lived token, find the Page +
 * its token, and persist to PlatformAuth. Three network hops (vs TikTok's one)
 * because Meta needs a token upgrade and a Page lookup — see the file header.
 */
export async function exchangeAndStore(code: string): Promise<{ handle: string }> {
  const { appId, appSecret } = await clientCreds()

  // 1. code → short-lived user token.
  const shortRes = await fetch(
    `${GRAPH}/oauth/access_token?` +
      new URLSearchParams({
        client_id: appId,
        client_secret: appSecret,
        redirect_uri: redirectUri(),
        code,
      }).toString()
  )
  const shortData = (await shortRes.json()) as { access_token?: string } & Record<string, unknown>
  if (!shortRes.ok || parseFbError(shortData) || !shortData.access_token) {
    throw new Error(parseFbError(shortData)?.message || 'Facebook token exchange failed')
  }

  // 2. short → long-lived user token (~60 days). Meta has no refresh_token, so
  //    this one-time upgrade is the only renewal we get; when it lapses the
  //    connection flips to needs_reconnect.
  const longRes = await fetch(
    `${GRAPH}/oauth/access_token?` +
      new URLSearchParams({
        grant_type: 'fb_exchange_token',
        client_id: appId,
        client_secret: appSecret,
        fb_exchange_token: shortData.access_token,
      }).toString()
  )
  const longData = (await longRes.json()) as {
    access_token?: string
    expires_in?: number
  } & Record<string, unknown>
  const userToken = longData.access_token || shortData.access_token
  const expiresIn = longData.expires_in

  // 3. find the Page + its (long-lived) Page token — that's what Reels use.
  const pagesRes = await fetch(
    `${GRAPH}/me/accounts?` + new URLSearchParams({ access_token: userToken }).toString()
  )
  const pagesData = (await pagesRes.json()) as { data?: FacebookPage[] } & Record<string, unknown>
  if (!pagesRes.ok || parseFbError(pagesData)) {
    throw new Error(parseFbError(pagesData)?.message || 'Could not read your Facebook Pages')
  }
  const page = selectPage(pagesData)

  const tokens: StoredTokens = {
    page_access_token: page.access_token,
    user_access_token: userToken,
    page_id: page.id,
    page_name: page.name,
    expires_in: expiresIn,
  }
  const expiresAt = expiresIn ? new Date(Date.now() + expiresIn * 1000) : null

  await prisma.platformAuth.upsert({
    where: { platform_accountHandle: { platform: PLATFORM, accountHandle: page.name } },
    update: {
      tokens: JSON.stringify(tokens),
      scopes: SCOPES.join(','),
      expiresAt,
      status: 'active',
    },
    create: {
      platform: PLATFORM,
      accountHandle: page.name,
      tokens: JSON.stringify(tokens),
      scopes: SCOPES.join(','),
      expiresAt,
      status: 'active',
    },
  })

  return { handle: page.name }
}

/** The active Facebook connection row, or null if not connected. */
export async function connection() {
  return prisma.platformAuth.findFirst({
    where: { platform: PLATFORM, status: 'active' },
    orderBy: { updatedAt: 'desc' },
  })
}

/** Tri-state for the Settings UI. 'none' = never connected / disconnected. */
export type FacebookConnState = 'active' | 'needs_reconnect' | 'none'

/**
 * True when a Facebook failure means the stored grant is dead and the owner must
 * reconnect: a Graph OAuthException (code 190 — expired/invalid token, any
 * subcode), a session/permission error (code 102, 10, or a 2xx permission code),
 * or a bare 401/403 from the upload host. Deliberately conservative — a 5xx, a
 * rate-limit (codes 4/17/32/341/613) or a network error (no numeric status) do
 * NOT match, so a healthy login is never wrongly flagged. Pure — unit-testable
 * with no DB or network. The `fbCode`/`status` fields are tagged onto the errors
 * thrown in this file so this reads structured signal, not brittle text.
 */
export function isAuthError(e: unknown): boolean {
  if (!e || typeof e !== 'object') return false
  const err = e as { message?: unknown; status?: unknown; fbCode?: unknown }
  const status = Number(err.status)
  // A 401/403 from an authenticated API call — the token was rejected outright.
  if (status === 401 || status === 403) return true
  const code = Number(err.fbCode)
  const hasStatus = err.status !== undefined && !Number.isNaN(status)
  // Dead-grant / re-consent Graph codes. Guard on < 500 so a transient server
  // blip that happens to echo an auth-ish code is never treated as a dead grant.
  const isDeadGrantCode =
    code === 190 || code === 102 || code === 10 || (code >= 200 && code <= 299)
  if (isDeadGrantCode && (!hasStatus || status < 500)) return true
  // Fallback for the plain-message shape our own code throws once it has already
  // decided the login is dead (the reconnect throw in accessToken/pageAuth).
  const msg = typeof err.message === 'string' ? err.message : ''
  return /reconnect in settings|session expired/i.test(msg)
}

/**
 * Flip the live Facebook connection from active → needs_reconnect after an auth
 * failure, so Settings and auto-publish stop treating a dead grant as healthy.
 * Idempotent (the `status: 'active'` guard makes a repeat call a no-op) and
 * swallows its own errors — this health bookkeeping must never mask the original
 * error the caller is handling. Mirrors tiktok.ts.
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
export async function connectionState(): Promise<{ state: FacebookConnState; handle?: string }> {
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
 * The Page access token + Page id for publishing. Unlike TikTok there is NO
 * refresh path: if the stored Page token is missing or the long-lived grant has
 * lapsed, flip the connection to needs_reconnect and report it in plain language
 * rather than leaving the channel to silently go dark.
 */
async function pageAuth(): Promise<{ token: string; pageId: string }> {
  const conn = await connection()
  if (!conn) throw new Error('Facebook is not connected. Connect it in Settings first.')
  const tokens: StoredTokens = JSON.parse(conn.tokens)
  const token = tokens.page_access_token
  const pageId = tokens.page_id

  const stillFresh =
    !conn.expiresAt || conn.expiresAt.getTime() - Date.now() > 60_000
  if (!token || !pageId || !stillFresh) {
    await markNeedsReconnect()
    throw new Error(FACEBOOK_RECONNECT_MESSAGE)
  }
  return { token, pageId }
}

/** A valid Page access token (mirrors tiktok.ts's accessToken shape). */
export async function accessToken(): Promise<string> {
  return (await pageAuth()).token
}

export interface PublishReelInput {
  filePath: string
  caption: string
}

export interface PublishReelResult {
  /** The Graph video id — stable and known from phase 1; also the post id. */
  videoId: string
}

/**
 * Upload + publish a rendered MP4 as a Facebook Reel via the 3-phase Reels
 * Publishing API:
 *   1. start  → reserve a video_id + one-shot upload_url on rupload.facebook.com
 *   2. upload → POST the raw file bytes to that upload_url (single chunk; a Short
 *               fits comfortably). Note: the token goes in an `Authorization:
 *               OAuth` header here, NOT as a query param, and the host is
 *               rupload.facebook.com, not graph.facebook.com.
 *   3. finish → publish the reel (video_state=PUBLISHED) with the caption.
 *
 * Finish returns success once encoding is *accepted*, not complete — Meta encodes
 * asynchronously — so, like TikTok, we treat an accepted finish as submitted
 * rather than blocking the publish on server-side processing.
 */
export async function publishReel(input: PublishReelInput): Promise<PublishReelResult> {
  const { token, pageId } = await pageAuth()
  const size = statSync(input.filePath).size

  // Phase 1 — start.
  const startRes = await fetch(`${GRAPH}/${pageId}/video_reels`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ upload_phase: 'start', access_token: token }),
  })
  const startData = (await startRes.json().catch(() => ({}))) as {
    video_id?: string
    upload_url?: string
  } & Record<string, unknown>
  if (!startRes.ok || parseFbError(startData)) {
    throw fbFailure(startData, startRes.status, 'Facebook upload could not be started')
  }
  const videoId = startData.video_id
  if (!videoId) throw new Error('Facebook did not return a video id')
  const uploadUrl = startData.upload_url || `${RUPLOAD}/${videoId}`

  // Phase 2 — upload the bytes to the rupload host. The `Authorization: OAuth`
  // scheme (not Bearer) and the offset/file_size headers are all required.
  const buf = readFileSync(input.filePath)
  const upRes = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      Authorization: `OAuth ${token}`,
      offset: '0',
      file_size: String(size),
    },
    body: buf,
  })
  const upData = (await upRes.json().catch(() => ({}))) as { success?: boolean } & Record<
    string,
    unknown
  >
  if (!upRes.ok || parseFbError(upData) || upData.success === false) {
    throw fbFailure(upData, upRes.status, `Facebook upload failed (HTTP ${upRes.status})`)
  }

  // Phase 3 — finish/publish.
  const finRes = await fetch(
    `${GRAPH}/${pageId}/video_reels?` +
      new URLSearchParams({
        access_token: token,
        video_id: videoId,
        upload_phase: 'finish',
        video_state: 'PUBLISHED',
        description: input.caption.slice(0, MAX_CAPTION),
      }).toString(),
    { method: 'POST' }
  )
  const finData = (await finRes.json().catch(() => ({}))) as { success?: boolean } & Record<
    string,
    unknown
  >
  if (!finRes.ok || parseFbError(finData)) {
    throw fbFailure(finData, finRes.status, 'Facebook could not publish the reel')
  }

  return { videoId }
}
