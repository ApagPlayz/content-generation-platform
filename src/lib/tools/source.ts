import { getGames, searchPlayers, gameExcitementScore } from '../balldontlie'
import {
  nextRotationCursor,
  normalizeSubject,
  orderByCoverageAndRotation,
  recentCoverage,
  type CoverageEntry,
} from '../pipeline/coverage'
import { classifyLeague, type LeaguePolicyConfig } from './leaguePolicy'
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
  /** League this factory targets (drives claim-tolerance policy). */
  league?: string
  /** Alias for league used by the seed config. */
  sport?: string
  /** Per-league claim-tolerance overrides: favor / flag / block. */
  leaguePolicy?: LeaguePolicyConfig
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

/** True when a matchup string appears in any recently-covered F9 subject. */
function isCovered(text: string, coverage: CoverageEntry[]): boolean {
  const norm = normalizeSubject(text)
  if (!norm) return false
  return coverage.some((e) => e.normalized.includes(norm))
}

async function trendingGame(config: SportsFactoryConfig): Promise<SourceResult | null> {
  const dates = recentDates(2)
  const games = (await Promise.all(dates.map(getGames))).flat()
  const finished = games.filter((g) => g.status === 'Final')
  if (finished.length === 0) return null

  const scored = finished
    .map((g) => ({ game: g, score: gameExcitementScore(g) }))
    .sort((a, b) => b.score - a.score)

  // Dedup: prefer the best game whose matchup we haven't already covered, so
  // two runs in the same window don't both clip the same blowout. Fail-open to
  // the single best game when every candidate matchup was already covered.
  const coverage = await recentCoverage({ factoryType: 'F9' })
  const matchupOf = (x: (typeof scored)[number]) =>
    `${x.game.visitor_team.full_name} vs ${x.game.home_team.full_name}`
  const best = scored.find((x) => !isCovered(matchupOf(x), coverage)) ?? scored[0]
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

  // Dedup + real rotation: order the watchlist so already-covered players fall
  // to the back and a persisted cursor advances the start point every run (the
  // old `getDate() % length` picked the SAME player all day). Then walk the
  // order and take the first name the API resolves to a real player. Fail-open:
  // when every player was recently covered we still proceed with the least-
  // recently-covered one (they lead the tail of `ordered`).
  const coverage = await recentCoverage({ factoryType: 'F9' })
  const cursor = await nextRotationCursor('F9:player_career')
  const { ordered } = orderByCoverageAndRotation(watchlist, (p) => p, coverage, cursor)

  for (const pick of ordered) {
    const players = await searchPlayers(pick)
    const player = players[0]
    if (!player) continue
    const name = `${player.first_name} ${player.last_name}`
    return {
      strategy: 'player_career',
      triggerReason: `Career highlights feature for ${name} (${player.team.full_name})`,
      youtubeQuery: `${name} career highlights best plays`,
      sourceData: { playerId: player.id, name, team: player.team.full_name },
    }
  }
  return null
}

async function trendingAudio(config: SportsFactoryConfig): Promise<SourceResult | null> {
  const audios = config.trendingAudio ?? []
  if (audios.length === 0) return null
  // Real rotation: advance a persisted cursor so repeat same-day runs cycle
  // through the curated audio list instead of re-using one track all day.
  const cursor = await nextRotationCursor('F9:trending_audio')
  const audio = audios[cursor % audios.length]
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
            : await trendingAudio(config)
      if (!result) {
        errors.push(`${strategy}: no viable trigger`)
        continue
      }

      // Claim-tolerance gate: favor tolerant leagues (NBA), FLAG aggressive
      // ones into the trigger reason so they land in review, and skip any
      // hard-blocked league entirely.
      const cls = classifyLeague(config, strategy, result.youtubeQuery)
      if (cls.tolerance === 'block') {
        errors.push(`${strategy}: blocked league (${cls.league}) — ${cls.note}`)
        continue
      }
      result.sourceData = {
        ...result.sourceData,
        league: cls.league,
        claimTolerance: cls.tolerance,
        policyNote: cls.note,
      }
      if (cls.tolerance !== 'favor') {
        result.triggerReason = `[FLAG: ${cls.note}] ${result.triggerReason}`
      }
      return result
    } catch (e) {
      errors.push(`${strategy}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  throw new Error(`No sourcing strategy produced a trigger. ${errors.join(' | ')}`)
}
