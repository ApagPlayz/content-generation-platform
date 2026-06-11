// Seeds the F9 Sports Highlights factory + its agent. Idempotent.
// Run with: node scripts/seed-sports.mjs
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

const FACTORY_NAME = 'Sports Highlights'

const config = {
  description:
    'NBA highlight clips sourced from trending games, player career moments, and trending-audio edits.',
  sport: 'nba',
  strategies: ['trending_game', 'player_career', 'trending_audio'],
  minExcitement: 40,
  clipLengthSec: 20,
  playerWatchlist: [
    'LeBron James',
    'Stephen Curry',
    'Giannis Antetokounmpo',
    'Luka Doncic',
    'Victor Wembanyama',
    'Shai Gilgeous-Alexander',
    'Anthony Edwards',
  ],
  // Manually curated for now — replace as sounds trend on TikTok.
  trendingAudio: [
    { name: 'phonk-drift-edit', note: 'high-energy phonk, sync drop to dunk' },
    { name: 'slowed-reverb-emotional', note: 'career retrospectives' },
  ],
}

const playbook = `You are the Sports Highlights agent. You make short vertical NBA highlight videos.

Voice & style:
- Energetic but credible — a knowledgeable fan, not a hype robot.
- Titles state the concrete moment or stakes ("Wemby's 5x5 sealed in the 4th"), never vague clickbait.
- Hooks are one short line of on-screen text that makes a scroller stop.

Strategy guidance:
- trending_game: lead with the result drama (comeback, clutch shot, OT). Mention both teams.
- player_career: frame around the milestone or narrative arc. Use the player's nickname if widely known.
- trending_audio: minimal text, let the edit breathe; hook references the sound or the vibe.

Hashtags: always include nba + basketball, then 3-6 specific tags (teams, players, moment type). Lowercase, no spaces.
Hard rules: never invent stats or scores not present in the trigger data. Keep titles under 80 chars.`

async function main() {
  const existing = await prisma.factory.findFirst({ where: { name: FACTORY_NAME } })
  const factory = existing
    ? await prisma.factory.update({
        where: { id: existing.id },
        data: { config: JSON.stringify(config), type: 'F9' },
      })
    : await prisma.factory.create({
        data: {
          name: FACTORY_NAME,
          type: 'F9',
          config: JSON.stringify(config),
          postingDefaults: JSON.stringify({ autonomy: 'review' }),
        },
      })

  const agent = await prisma.agent.upsert({
    where: { factoryId_name: { factoryId: factory.id, name: 'Sports Highlights Agent' } },
    update: { playbook },
    create: {
      factoryId: factory.id,
      name: 'Sports Highlights Agent',
      playbook,
      autonomy: 'review',
    },
  })

  console.log(`Factory: ${factory.id} (${factory.name})`)
  console.log(`Agent:   ${agent.id} (${agent.name}, autonomy=${agent.autonomy})`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
