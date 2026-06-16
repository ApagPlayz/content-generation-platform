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

// Upload + readonly (to read the connected channel handle for display).
export const SCOPES = [
  'https://www.googleapis.com/auth/youtube.upload',
  'https://www.googleapis.com/auth/youtube.readonly',
]

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
    // Refresh may omit refresh_token; merge so we never drop it.
    void (async () => {
      const merged = { ...JSON.parse(conn.tokens), ...tokens }
      await prisma.platformAuth.update({
        where: { id: conn.id },
        data: {
          tokens: JSON.stringify(merged),
          expiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : conn.expiresAt,
        },
      })
    })()
  })

  return client
}
