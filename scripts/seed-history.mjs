// Seeds the F11 History & Business Mini-Docs factory + its agent. Idempotent.
// Run with: node scripts/seed-history.mjs
//
// Topics are curated pre-1950 historical/business stories — public-record,
// public-domain-visual, no living principals — the safe profile the compliance
// gate is built around. Framing is business-story: greed, bubbles, hubris,
// invention.
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

const FACTORY_NAME = 'History Mini-Docs'

const config = {
  description:
    'Faceless 60–90s narrated mini-documentaries on historical events and business rises, falls & scandals. Public-domain archival visuals, documentary tone, 2-source fact-checking + defamation lint gate.',
  targetDurationSec: 75,
  maxImages: 6,
  // macOS `say` voice for the free local-TTS fallback; ElevenLabs voice id wins
  // if ELEVENLABS_API_KEY is set.
  voice: 'Daniel',

  // ── Footage / visuals surface. Every new feature is OFF/dormant by default so
  //    the demo pipeline keeps using the Wikimedia public-domain slideshow until
  //    the owner opts in. These document the new config keys downstream stages read.
  footageEnabled: true,
  maxClipsPerBeat: 2,
  maxImagesPerBeat: 2,
  // AI script writer (Claude) — off until an API key + opt-in are set.
  useAiScript: false,
  scriptModel: 'sonnet',
  // Pexels/Pixabay stock video — off (needs PEXELS_API_KEY / PIXABAY_API_KEY).
  useStockFootage: false,
  maxStockClipsPerBeat: 1,
  stockProviders: ['pexels', 'pixabay'],
  // archive.org public-domain footage — off; no key required when enabled.
  useArchiveFootage: true,
  archiveMaxClips: 3,
  archiveCollections: ['prelinger'],
  aiStillStyle: 'muted cinematic, symbolic, no faces',
  // Fallback ladder in tier-key vocabulary (ai_still | stock | archive | moodbank).
  // Each tier no-ops without its key/flag, then the visuals stage backfills the
  // keyless Wikimedia floor — so this is safe with zero API keys.
  footageLadder: ['archive', 'stock', 'moodbank'],
  // Named visual styles rotated across videos for variety.
  styleRotation: ['sepia-archival', 'noir-contrast', 'muted-documentary'],
  // Editorial angles rotated to avoid "inauthentic content" sameness.
  editorialAngles: ['investigation', 'forensics', 'courtroom', 'aftermath'],
  styleDivergenceWindow: 5,
  enableEditorialLayer: true,
  // Mood-bank b-roll layer — dormant by default.
  moodBankEnabled: true,
  topicWatchlist: [
    {
      topicName: 'The Ponzi Scheme of 1920',
      wikipediaTitle: 'Charles Ponzi',
      angle:
        'How one man’s 45-day money-doubling promise collapsed in months — and gave every scam since his name. Greed as a business model.',
      subjects: [
        { name: 'Charles Ponzi', role: 'convicted', living: false, isMinor: false },
      ],
    },
    {
      topicName: 'The South Sea Bubble',
      wikipediaTitle: 'South Sea Company',
      angle:
        'The 1720 stock mania that ruined half of London’s elite — even Isaac Newton lost a fortune. Hubris meets a company with almost no real business.',
      subjects: [],
    },
    {
      topicName: 'Tulip Mania',
      wikipediaTitle: 'Tulip mania',
      angle:
        'When a single flower bulb traded for the price of a house — history’s most famous speculative bubble and what actually popped it.',
      subjects: [],
    },
    {
      topicName: 'The Wall Street Crash of 1929',
      wikipediaTitle: 'Wall Street crash of 1929',
      angle:
        'The week the Roaring Twenties died: margin-fueled greed, a market built on borrowed money, and the crash that dragged the world into depression.',
      subjects: [],
    },
    {
      topicName: 'The Panic of 1907',
      wikipediaTitle: 'Panic of 1907',
      angle:
        'The bank run so severe that one private banker had to bail out America himself — and why it forced the creation of the Federal Reserve.',
      subjects: [
        { name: 'J.P. Morgan', role: 'investigator', living: false, isMinor: false },
      ],
    },
    {
      topicName: 'The Breakup of Standard Oil',
      wikipediaTitle: 'Standard Oil',
      angle:
        'How the world’s richest man built a monopoly so dominant the government shattered it into 34 pieces — and got even richer. Hubris, power, and antitrust.',
      subjects: [
        { name: 'John D. Rockefeller', role: 'accused', living: false, isMinor: false },
      ],
    },
    {
      topicName: 'The Triangle Shirtwaist Factory Fire',
      wikipediaTitle: 'Triangle Shirtwaist Factory fire',
      angle:
        'Locked exit doors, 146 dead workers, and the fire that shamed a nation into rewriting labor law — when cutting costs became a catastrophe.',
      subjects: [],
    },
    {
      topicName: "The Wright Brothers' First Flight",
      wikipediaTitle: 'Wright Flyer',
      angle:
        'Two bicycle mechanics with no funding beat a government-backed program to the sky — invention, obsession, and 12 seconds that changed everything.',
      subjects: [
        { name: 'Orville Wright', role: 'investigator', living: false, isMinor: false },
        { name: 'Wilbur Wright', role: 'investigator', living: false, isMinor: false },
      ],
    },
  ],
}

const playbook = [
  'You are the History & Business Mini-Docs factory agent. You produce documentary-tone',
  '60–90 second vertical mini-documentaries about historical events and business rises,',
  'falls, and scandals — bubbles, panics, monopolies, inventions, and reform. Your editorial values:',
  '- Story-arc focus (greed, hubris, invention, downfall), never sensationalism.',
  '- Hook in the first 2 seconds with the most counterintuitive or highest-stakes fact.',
  '- Every load-bearing fact is sourced and hedged where historians disagree; you cite on-screen and in the description.',
  '- You never assert wrongdoing beyond the historical record; disputed claims are framed as disputed.',
  '- Each video has a unique angle and original framing — never a templated retread.',
  '- End with a question or call-to-comment that invites viewers to take a side.',
].join(' ')

async function main() {
  const factory = await prisma.factory.upsert({
    where: { id: await existingId() },
    update: { config: JSON.stringify(config) },
    create: {
      name: FACTORY_NAME,
      type: 'F11',
      config: JSON.stringify(config),
      postingDefaults: JSON.stringify({ autonomy: 'review' }),
    },
  })

  await prisma.agent.upsert({
    where: { factoryId_name: { factoryId: factory.id, name: 'History Mini-Docs Agent' } },
    update: { playbook, budget: 5 },
    create: {
      factoryId: factory.id,
      name: 'History Mini-Docs Agent',
      autonomy: 'review',
      playbook,
      budget: 5,
      enabled: true,
    },
  })

  console.log(`✓ Seeded F11 factory "${FACTORY_NAME}" (${factory.id}) + agent.`)
}

// upsert needs a where-unique; find existing F11 factory by name or use a sentinel.
async function existingId() {
  const found = await prisma.factory.findFirst({ where: { name: FACTORY_NAME, type: 'F11' } })
  return found?.id ?? 'f11-does-not-exist'
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
