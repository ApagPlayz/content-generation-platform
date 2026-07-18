import { readFileSync, statSync } from 'fs'
import { prisma } from './prisma'

/**
 * Meta (Facebook) OAuth + Reels publishing helpers (issue #58 — auto-post the
 * same finished video to more than just YouTube + TikTok). Deliberately mirrors
 * src/lib/tiktok.ts so every platform behaves the same: the app credentials live
 * in the Setting table (entered in the Settings UI, not env), the tokens live in
 * PlatformAuth, and we use plain `fetch` rather than an SDK to avoid a new
 * runtime dependency.
 *
 * SCOPE NOTE — Facebook only, on purpose. Facebook Page Reels
 * (POST /{page-id}/video_reels) accept a direct **file upload** (start → transfer
 * bytes → finish), which is exactly the local MP4 this app already renders to
 * Video.localPath. Instagram Reels (POST /{ig-user-id}/media, media_type=REELS)
 * instead require a **publicly reachable video_url** — Meta fetches the file from
 * the internet — which a localhost single-user tool has no way to provide. So
 * Instagram is a later phase that needs a hosting step; this module ships the
 * Facebook path that works today. The Facebook Login used here is the same login
 * Instagram will reuse, so adding it later is additive, not a rewrite.
 *
 * Heads-up for the operator: a Meta app can only post to Pages you administer
 * until Meta approves it via App Review — exactly the way YouTube needs a Google
 * Cloud OAuth client and TikTok needs its audit. For a single-user tool posting
 * to your own Page that is fine; the connect flow works regardless.
 */

export const PLATFORM = 'facebook'

const GRAPH = 'https://graph.facebook.com/v21.0'
const OAUTH_DIALOG = 'https://www.facebook.com/v21.0/dialog/oauth'

// pages_show_list  → find the Page(s) you administer + their tokens.
// pages_read_engagement / pages_manage_posts → publish a Reel to the Page.
export const SCOPES = ['pages_show_list', 'pages_read_engagement', 'pages_manage_posts']

// A Facebook Reel description maxes out well above a Short's caption; cap it at
// the same length TikTok uses so one caption string is safe everywhere.
const MAX_DESCRIPTION = 2200

function baseUrl(): string {
  return process.env.APP_BASE_URL || 'http://localhost:3000'
}

export function redirectUri(): string {
  return `${baseUrl()}/api/auth/meta/callback`
}

interface MetaTokens {
  user_access_token?: string
  page_id?: string
  page_access_token?: string
  page_name?: string
}

async function settings(): Promise<Record<string, string>> {
  const rows = await prisma.setting.findMany({
    where: { key: { in: ['meta_app_id', 'meta_app_secret'] } },
  })
  return Object.fromEntries(rows.map((r) => [r.key, r.value]))
}

/** App credentials from Settings. Throws (with a friendly message) if unset. */
async function clientCreds(): Promise<{ appId: string; appSecret: string }> {
  const s = await settings()
  const appId = s.meta_app_id
  const appSecret = s.meta_app_secret
  if (!appId || !appSecret) {
    throw new Error('Facebook app not configured. Add the App ID + secret in Settings.')
  }
  return { appId, appSecret }
}

/** Pretty-print whatever error shape the Graph API returned ({error:{message}}). */
export function graphError(data: unknown): string | null {
  if (!data || typeof data !== 'object') return null
  const err = (data as Record<string, unknown>).error as Record<string, unknown> | undefined
  if (!err || typeof err !== 'object') return null
  return (
    (err.error_user_msg as string) ||
    (err.message as string) ||
    (err.type as string) ||
    'Facebook request failed'
  )
}

/**
 * Build the consent URL from its parts. Pure + unit-tested so the wiring can be
 * verified without hitting the network or needing real credentials.
 */
export function authorizeUrl(appId: string, redirect: string, state: string): string {
  const p = new URLSearchParams({
    client_id: appId,
    redirect_uri: redirect,
    state,
    response_type: 'code',
    scope: SCOPES.join(','),
  })
  return `${OAUTH_DIALOG}?${p.toString()}`
}

/**
 * A public Facebook Reel URL. Prefers the permalink Meta returns (may be a full
 * URL or a site-relative path); otherwise falls back to the /reel/{id} shape.
 * Pure + unit-tested.
 */
export function facebookPermalink(videoId: string, permalinkUrl?: string | null): string {
  if (permalinkUrl) {
    return permalinkUrl.startsWith('http')
      ? permalinkUrl
      : `https://www.facebook.com${permalinkUrl}`
  }
  return `https://www.facebook.com/reel/${videoId}`
}

/** Consent URL — throws if the app isn't configured yet. */
export async function authUrl(): Promise<string> {
  const { appId } = await clientCreds()
  // A local single-user tool: we send a state param but, like the YouTube/TikTok
  // flows, don't round-trip verify it.
  return authorizeUrl(appId, redirectUri(), 'connect')
}

interface GraphTokenResponse {
  access_token?: string
  expires_in?: number
}

/** Exchange the callback code, resolve a Page token, persist to PlatformAuth. */
export async function exchangeAndStore(code: string): Promise<{ handle: string }> {
  const { appId, appSecret } = await clientCreds()

  // 1. Code → short-lived user token.
  const shortRes = await fetch(
    `${GRAPH}/oauth/access_token?` +
      new URLSearchParams({
        client_id: appId,
        client_secret: appSecret,
        redirect_uri: redirectUri(),
        code,
      }).toString()
  )
  const shortData = (await shortRes.json()) as GraphTokenResponse & Record<string, unknown>
  if (!shortRes.ok || graphError(shortData) || !shortData.access_token) {
    throw new Error(graphError(shortData) || 'Facebook token exchange failed')
  }

  // 2. Short-lived → long-lived (~60 day) user token.
  const longRes = await fetch(
    `${GRAPH}/oauth/access_token?` +
      new URLSearchParams({
        grant_type: 'fb_exchange_token',
        client_id: appId,
        client_secret: appSecret,
        fb_exchange_token: shortData.access_token,
      }).toString()
  )
  const longData = (await longRes.json()) as GraphTokenResponse & Record<string, unknown>
  const userToken = longData.access_token || shortData.access_token
  const expiresAt = longData.expires_in ? new Date(Date.now() + longData.expires_in * 1000) : null

  // 3. Which Page(s) do you administer? Take the first — its token is what posts
  //    a Reel. (Same "first active account" limitation YouTube/TikTok have.)
  const pagesRes = await fetch(
    `${GRAPH}/me/accounts?` +
      new URLSearchParams({ access_token: userToken, fields: 'id,name,access_token' }).toString()
  )
  const pagesData = (await pagesRes.json()) as {
    data?: Array<{ id?: string; name?: string; access_token?: string }>
  } & Record<string, unknown>
  if (!pagesRes.ok || graphError(pagesData)) {
    throw new Error(graphError(pagesData) || 'Could not read your Facebook Pages')
  }
  const page = pagesData.data?.[0]
  if (!page?.id || !page.access_token) {
    throw new Error(
      'No Facebook Page found. Create/manage a Page (Reels post to a Page, not a profile), then reconnect.'
    )
  }

  const handle = page.name || 'Facebook Page'
  const tokens: MetaTokens = {
    user_access_token: userToken,
    page_id: page.id,
    page_access_token: page.access_token,
    page_name: handle,
  }

  await prisma.platformAuth.upsert({
    where: { platform_accountHandle: { platform: PLATFORM, accountHandle: handle } },
    update: { tokens: JSON.stringify(tokens), scopes: SCOPES.join(','), expiresAt, status: 'active' },
    create: {
      platform: PLATFORM,
      accountHandle: handle,
      tokens: JSON.stringify(tokens),
      scopes: SCOPES.join(','),
      expiresAt,
      status: 'active',
    },
  })

  return { handle }
}

/** The active Facebook connection row, or null if not connected. */
export async function connection() {
  return prisma.platformAuth.findFirst({
    where: { platform: PLATFORM, status: 'active' },
    orderBy: { updatedAt: 'desc' },
  })
}

/** The stored Page id + Page access token, or throws a plain-language reconnect. */
async function pageCreds(): Promise<{ pageId: string; token: string }> {
  const conn = await connection()
  if (!conn) throw new Error('Facebook is not connected. Connect it in Settings first.')
  const tokens: MetaTokens = JSON.parse(conn.tokens)
  if (!tokens.page_id || !tokens.page_access_token) {
    throw new Error('Facebook session incomplete. Reconnect it in Settings.')
  }
  // Page access tokens derived from a long-lived user token do not expire, so
  // (unlike TikTok/YouTube) there is no refresh dance here.
  return { pageId: tokens.page_id, token: tokens.page_access_token }
}

export interface PublishReelInput {
  filePath: string
  caption: string
}

export interface PublishReelResult {
  videoId: string
  permalink: string
}

/**
 * Upload + publish a rendered MP4 as a Facebook Page Reel via the resumable
 * video_reels flow:
 *   1. start    → reserve a video_id + one-shot upload_url
 *   2. transfer → stream the file bytes to the rupload host
 *   3. finish   → publish, with the caption as the description
 *   4. poll     → briefly, to pick up the public permalink once it's ready
 *
 * Same shape as tiktok.ts's directPost: bytes-accepted counts as submitted; we
 * don't block the whole publish on Meta's async server-side processing.
 */
export async function publishReel(input: PublishReelInput): Promise<PublishReelResult> {
  const { pageId, token } = await pageCreds()

  // 1. start
  const startRes = await fetch(
    `${GRAPH}/${pageId}/video_reels?` +
      new URLSearchParams({ upload_phase: 'start', access_token: token }).toString(),
    { method: 'POST' }
  )
  const startData = (await startRes.json()) as {
    video_id?: string
    upload_url?: string
  } & Record<string, unknown>
  if (!startRes.ok || graphError(startData)) {
    throw new Error(graphError(startData) || 'Facebook upload could not be started')
  }
  const videoId = startData.video_id
  const uploadUrl = startData.upload_url
  if (!videoId || !uploadUrl) throw new Error('Facebook did not return an upload URL')

  // 2. transfer — a single shot; a Short fits comfortably in one request.
  const size = statSync(input.filePath).size
  const buf = readFileSync(input.filePath)
  const putRes = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      Authorization: `OAuth ${token}`,
      offset: '0',
      file_size: String(size),
    },
    body: buf,
  })
  if (!putRes.ok) throw new Error(`Facebook upload failed (HTTP ${putRes.status})`)

  // 3. finish → publish
  const finishRes = await fetch(
    `${GRAPH}/${pageId}/video_reels?` +
      new URLSearchParams({
        upload_phase: 'finish',
        video_id: videoId,
        video_state: 'PUBLISHED',
        description: input.caption.slice(0, MAX_DESCRIPTION),
        access_token: token,
      }).toString(),
    { method: 'POST' }
  )
  const finishData = (await finishRes.json()) as Record<string, unknown>
  if (!finishRes.ok || graphError(finishData)) {
    throw new Error(graphError(finishData) || 'Facebook rejected the Reel on publish')
  }

  const permalinkUrl = await pollPermalink(videoId, token)
  return { videoId, permalink: facebookPermalink(videoId, permalinkUrl) }
}

/** Briefly poll for the public permalink; returns it if Meta has one ready. */
async function pollPermalink(videoId: string, token: string): Promise<string | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(
      `${GRAPH}/${videoId}?` +
        new URLSearchParams({ fields: 'permalink_url', access_token: token }).toString()
    )
    const data = (await res.json()) as { permalink_url?: string } & Record<string, unknown>
    if (data.permalink_url) return data.permalink_url
    await sleep(2000)
  }
  // Still processing — the /reel/{id} fallback in facebookPermalink stays usable.
  return null
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
