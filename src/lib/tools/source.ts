import { getGames, searchPlayers, gameExcitementScore } from '../balldontlie'
import type { SourceResult, SportsStrategy } from './types'

interface SportsFactoryConfig {
  /** Strategies to try, in priority order. */
  strategies?: SportsStrategy[]
  /** Minimum excitement score (0-100) for a game to qualify. */
  minExcitement?: number
  /** Player watchlist for the player_career strategy. */
  playerWatchlist?: string[]
  /** Manually curated trending audio refs for the trending_audio strategy. */
  trendingAudio?: { name: string; note?: string }[]
}

function recentDates(days: number): string[] {
  const out: string[] = []
  for (let i = 0; i < days; i++) {
    const d = new Date()
    d.setDate(d.getDate() - i)
    out.push(d.toISOString().slice(0, 10))
  }
  return out
}

async function trendingGame(config: SportsFactoryConfig): Promise<SourceResult | null> {
  const dates = recentDates(2)
  const games = (await Promise.all(dates.map(getGames))).flat()
  const finished = games.filter((g) => g.status === 'Final')
  if (finished.length === 0) return null

  const scored = finished
    .map((g) => ({ game: g, score: gameExcitementScore(g) }))
    .sort((a, b) => b.score - a.score)
  const best = scored[0]
  if (best.score < (config.minExcitement ?? 40)) return null

  const g = best.game
  const matchup = `${g.visitor_team.full_name} vs ${g.home_team.full_name}`
  return {
    strategy: 'trending_game',
    triggerReason: `${matchup} finished ${g.visitor_team_score}-${g.home_team_score} (excitement ${best.score}/100)`,
    youtubeQuery: `${g.visitor_team.full_name} vs ${g.home_team.full_name} full game highlights ${g.date.slice(0, 10)}`,
    sourceData: {
      gameId: g.id,
      date: g.date,
      homeTeam: g.home_team.full_name,
      visitorTeam: g.visitor_team.full_name,
      homeScore: g.home_team_score,
      visitorScore: g.visitor_team_score,
      excitement: best.score,
      postseason: g.postseason,
    },
  }
}

async function playerCareer(config: SportsFactoryConfig): Promise<SourceResult | null> {
  const watchlist = config.playerWatchlist ?? []
  if (watchlist.length === 0) return null

  // Rotate deterministically by day so consecutive runs cover different players.
  const pick = watchlist[new Date().getDate() % watchlist.length]
  const players = await searchPlayers(pick)
  const player = players[0]
  if (!player) return null

  const name = `${player.first_name} ${player.last_name}`
  return {
    strategy: 'player_career',
    triggerReason: `Career highlights feature for ${name} (${player.team.full_name})`,
    youtubeQuery: `${name} career highlights best plays`,
    sourceData: { playerId: player.id, name, team: player.team.full_name },
  }
}

function trendingAudio(config: SportsFactoryConfig): SourceResult | null {
  const audios = config.trendingAudio ?? []
  if (audios.length === 0) return null
  const audio = audios[new Date().getDate() % audios.length]
  return {
    strategy: 'trending_audio',
    triggerReason: `Beat-synced highlight mix using trending audio "${audio.name}"`,
    youtubeQuery: 'NBA best dunks and game winners compilation',
    sourceData: { audio },
  }
}

/**
 * Pick what to make. Tries the factory's strategies in priority order and
 * returns the first one that produces a viable trigger.
 */
export async function runSource(factoryConfig: Record<string, unknown>): Promise<SourceResult> {
  const config = factoryConfig as SportsFactoryConfig
  const order = config.strategies ?? ['trending_game', 'player_career', 'trending_audio']

  const errors: string[] = []
  for (const strategy of order) {
    try {
      const result =
        strategy === 'trending_game'
          ? await trendingGame(config)
          : strategy === 'player_career'
            ? await playerCareer(config)
            : trendingAudio(config)
      if (result) return result
      errors.push(`${strategy}: no viable trigger`)
    } catch (e) {
      errors.push(`${strategy}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  throw new Error(`No sourcing strategy produced a trigger. ${errors.join(' | ')}`)
}
