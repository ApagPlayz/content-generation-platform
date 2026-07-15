import { google } from 'googleapis'
import { prisma } from './prisma'

// Tie to the exact google-auth-library copy googleapis resolves (avoids the
// duplicate-package type clash between googleapis-common's nested copy and ours).
type OAuth2Client = InstanceType<typeof google.auth.OAuth2>

/**
 * YouTube OAuth + auth-client helpers (PRD §8.1 / Phase 2).
 *
 * Credentials live in the Setting table (entered in the Settings UI), not env,
 * so the operator can connect from the dashboard without touching files. The
 * refresh token is stored in PlatformAuth and used to mint access tokens; we
 * persist any rotation google sends back.
 */

export const PLATFORM = 'youtube'

// Plain-language reason shown to the owner wherever a video didn't post because
// the YouTube login lapsed — never the raw `invalid_grant` OAuth jargon.
export const YT_RECONNECT_MESSAGE =
  'YouTube disconnected — your login expired. Reconnect in Settings to resume publishing.'

// Upload + readonly (channel handle) + analytics (watch time, avg view %, subs
// gained). Connections made before analytics was added won't carry the last
// scope until the operator reconnects — the analytics read degrades gracefully.
export const SCOPES = [
  'https://www.googleapis.com/auth/youtube.upload',
  'https://www.googleapis.com/auth/youtube.readonly',
  'https://www.googleapis.com/auth/yt-analytics.readonly',
]

/** True if the active connection was granted the analytics scope. */
export async function hasAnalyticsScope(): Promise<boolean> {
  const conn = await connection()
  return !!conn?.scopes?.includes('yt-analytics.readonly')
}

function baseUrl(): string {
  return process.env.APP_BASE_URL || 'http://localhost:3000'
}

export function redirectUri(): string {
  return `${baseUrl()}/api/auth/youtube/callback`
}

async function settings(): Promise<Record<string, string>> {
  const rows = await prisma.setting.findMany({
    where: { key: { in: ['youtube_client_id', 'youtube_client_secret'] } },
  })
  return Object.fromEntries(rows.map((r) => [r.key, r.value]))
}

/** Bare OAuth2 client (no credentials set). Throws if creds aren't configured. */
export async function oauthClient(): Promise<OAuth2Client> {
  const s = await settings()
  const clientId = s.youtube_client_id
  const clientSecret = s.youtube_client_secret
  if (!clientId || !clientSecret) {
    throw new Error(
      'YouTube OAuth client not configured. Add the client ID + secret in Settings.'
    )
  }
  return new google.auth.OAuth2(clientId, clientSecret, redirectUri())
}

/** Consent URL — offline access + forced consent so we always get a refresh token. */
export async function authUrl(): Promise<string> {
  const client = await oauthClient()
  return client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: SCOPES,
  })
}

/** Exchange the callback code, fetch the channel handle, persist to PlatformAuth. */
export async function exchangeAndStore(code: string): Promise<{ handle: string }> {
  const client = await oauthClient()
  const { tokens } = await client.getToken(code)
  client.setCredentials(tokens)

  const yt = google.youtube({ version: 'v3', auth: client })
  const channels = await yt.channels.list({ part: ['snippet'], mine: true })
  const channel = channels.data.items?.[0]
  const handle = channel?.snippet?.title || channel?.id || 'YouTube channel'

  await prisma.platformAuth.upsert({
    where: { platform_accountHandle: { platform: PLATFORM, accountHandle: handle } },
    update: {
      tokens: JSON.stringify(tokens),
      scopes: SCOPES.join(' '),
      expiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
      status: 'active',
    },
    create: {
      platform: PLATFORM,
      accountHandle: handle,
      tokens: JSON.stringify(tokens),
      scopes: SCOPES.join(' '),
      expiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
      status: 'active',
    },
  })

  return { handle }
}

/** The active YouTube connection row, or null if not connected. */
export async function connection() {
  return prisma.platformAuth.findFirst({
    where: { platform: PLATFORM, status: 'active' },
    orderBy: { updatedAt: 'desc' },
  })
}

/** Tri-state for the Settings/dashboard UI. 'none' = never connected / disconnected. */
export type YouTubeConnState = 'active' | 'needs_reconnect' | 'none'

/**
 * True when an error from googleapis/google-auth-library means the stored OAuth
 * grant is dead — the refresh token was revoked/expired (Google returns
 * `invalid_grant`, HTTP 400 on the token refresh) or the API call itself came
 * back 401. Deliberately conservative: quota (403), 5xx, and network errors do
 * NOT match, so a healthy login is never wrongly flagged. Pure — unit-testable
 * with no DB or network.
 */
export function isAuthError(e: unknown): boolean {
  if (!e || typeof e !== 'object') return false
  const err = e as {
    message?: unknown
    code?: unknown
    status?: unknown
    response?: { status?: number; data?: { error?: unknown; error_description?: unknown } }
  }
  // A 401 from any Data API call. gaxios exposes the HTTP status on .response.status
  // and .status; older shapes put it on .code as a number or numeric string.
  const httpStatus = Number(
    err.response?.status ??
      (typeof err.status === 'number' ? err.status : undefined) ??
      err.code
  )
  if (httpStatus === 401) return true
  // OAuth token-endpoint refusal on refresh: gaxios attaches the parsed body
  // { error: 'invalid_grant', ... } to response.data.
  const oauthError = err.response?.data?.error
  if (oauthError === 'invalid_grant' || oauthError === 'invalid_token') return true
  // Fallback: google-auth-library often throws a plain Error whose message is the
  // composed invalid_grant / description string, with no response object.
  const body = `${err.response?.data?.error_description ?? ''} ${
    typeof err.message === 'string' ? err.message : ''
  }`
  return /invalid_grant|invalid_token|Token has been expired or revoked|No refresh token is set/i.test(
    body
  )
}

/**
 * Flip the live YouTube connection from active → needs_reconnect after an auth
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
export async function connectionState(): Promise<{ state: YouTubeConnState; handle?: string }> {
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
 * An OAuth2 client primed with the stored refresh token. Persists rotated
 * tokens automatically so the connection survives across runs.
 */
export async function authedClient(): Promise<OAuth2Client> {
  const conn = await connection()
  if (!conn) throw new Error('YouTube is not connected. Connect it in Settings first.')

  const client = await oauthClient()
  client.setCredentials(JSON.parse(conn.tokens))

  client.on('tokens', (tokens) => {
    // Refresh may omit refresh_token; merge so we never drop it. The persist is
    // fire-and-forget (the 'tokens' event isn't awaitable), so it must handle its
    // own errors — a silent throw here is exactly what let a dead login hide.
    void (async () => {
      try {
        const merged = { ...JSON.parse(conn.tokens), ...tokens }
        await prisma.platformAuth.update({
          where: { id: conn.id },
          data: {
            tokens: JSON.stringify(merged),
            expiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : conn.expiresAt,
          },
        })
      } catch (e) {
        console.error('[youtube] failed to persist rotated tokens', e)
      }
    })()
  })

  return client
}
