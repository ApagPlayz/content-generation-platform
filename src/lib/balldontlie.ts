// Ball Don't Lie API client (free tier: NBA games/players/stats).
// Get a free key at https://www.balldontlie.io and set BALLDONTLIE_API_KEY.

const BASE = 'https://api.balldontlie.io/v1'

export interface BdlTeam {
  id: number
  full_name: string
  abbreviation: string
}

export interface BdlGame {
  id: number
  date: string
  status: string
  period: number
  home_team: BdlTeam
  visitor_team: BdlTeam
  home_team_score: number
  visitor_team_score: number
  season: number
  postseason: boolean
}

export interface BdlPlayer {
  id: number
  first_name: string
  last_name: string
  position: string
  team: BdlTeam
}

async function bdlFetch<T>(path: string): Promise<T> {
  const key = process.env.BALLDONTLIE_API_KEY
  if (!key) {
    throw new Error(
      'BALLDONTLIE_API_KEY not set. Get a free key at balldontlie.io and add it to .env.local'
    )
  }
  const res = await fetch(`${BASE}${path}`, {
    headers: { Authorization: key },
    cache: 'no-store',
  })
  if (!res.ok) {
    throw new Error(`Ball Don't Lie ${path} failed: ${res.status} ${await res.text()}`)
  }
  return res.json() as Promise<T>
}

/** Games for a date (YYYY-MM-DD). */
export async function getGames(date: string): Promise<BdlGame[]> {
  const data = await bdlFetch<{ data: BdlGame[] }>(`/games?dates[]=${date}&per_page=100`)
  return data.data
}

/** Search players by name. */
export async function searchPlayers(query: string): Promise<BdlPlayer[]> {
  const data = await bdlFetch<{ data: BdlPlayer[] }>(
    `/players?search=${encodeURIComponent(query)}&per_page=10`
  )
  return data.data
}

/**
 * Score how "highlight-worthy" a finished/live game is.
 * Close score + high total = exciting. Returns 0..100.
 */
export function gameExcitementScore(g: BdlGame): number {
  const total = g.home_team_score + g.visitor_team_score
  if (total === 0) return 0
  const margin = Math.abs(g.home_team_score - g.visitor_team_score)
  const closeness = Math.max(0, 30 - margin) / 30 // 1.0 at tie, 0 at 30+ blowout
  const scoring = Math.min(total / 260, 1) // 260+ combined = max
  const postseasonBoost = g.postseason ? 0.15 : 0
  return Math.round((closeness * 0.55 + scoring * 0.3 + postseasonBoost) * 100)
}
