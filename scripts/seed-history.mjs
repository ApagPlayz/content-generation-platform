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
  // Wall-clock budget for the whole footage stage (round 7): past it the
  // remaining beats fill from local sources instead of new archive.org
  // fetches — a degraded video that renders beats a hung run. 0 disables.
  footageBudgetSec: 480,
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
  // Media-richness gate at discovery (round 6) — the owner's tuning knobs:
  // a topic needs (a) a story year of minTopicYear or later (pre-1900 stories
  // predate photography/newsreels — Tulip Mania, South Sea Bubble, the 1882
  // Standard Oil trust all fail here) and (b) at least minArchiveHits DISTINCT
  // archive.org movie/image hits. Topics that fail are skipped for the next
  // watchlist entry. Set either to 0 to disable that half of the gate.
  minArchiveHits: 8,
  minTopicYear: 1900,
  aiStillStyle: 'muted cinematic, symbolic, no faces',
  // Fallback ladder in tier-key vocabulary (ai_still | stock | archive | moodbank).
  // Each tier no-ops without its key/flag, then the visuals stage backfills the
  // keyless Wikimedia floor — so this is safe with zero API keys.
  footageLadder: ['archive'],
  // Archive footage as stills only for the PHOTO tier (no motion-blurred
  // poster-frames) — the photo backbone comes from Wikipedia/Commons + archive
  // stills. Real MOVING footage is handled by the separate clip layer below.
  archiveStillsOnly: true,

  // ── Relevant moving-clip layer (2026-07) ──────────────────────────────────
  //   Photos stay the backbone; these lay SHORT, relevance-filtered excerpts of
  //   real on-topic footage over a few beats (archive.org movies + YouTube
  //   fair-use news/press/documentary). Muted, attributed, hard-capped.
  clipsEnabled: true,
  clipSources: ['archive', 'youtube'],
  maxClipBeats: 3,
  maxClipOnscreenSec: 8,
  clipRelevanceMinTokens: 1,
  youtubeClipSearchCount: 6,
  minClipHeight: 360,
  // Named visual styles rotated across videos for variety.
  styleRotation: ['sepia-archival', 'noir-contrast', 'muted-documentary'],
  // Editorial angles rotated to avoid "inauthentic content" sameness. History
  // stories get genuinely historical framings (NOT the true-crime angles).
  editorialAngles: ['turning-point', 'human-story', 'myth-vs-record', 'legacy'],
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
    {
      topicName: 'The Sinking of the Titanic',
      wikipediaTitle: 'Sinking of the Titanic',
      angle:
        'The "unsinkable" ship that met an iceberg on its maiden voyage — 1,500 dead, too few lifeboats, and the hubris of an era that thought it had beaten the sea.',
      subjects: [],
    },
    {
      topicName: 'The Hindenburg Disaster',
      wikipediaTitle: 'Hindenburg disaster',
      angle:
        'The largest aircraft ever built burst into flame in 34 seconds on live radio — the day the age of the airship died, and why it was doomed before it flew.',
      subjects: [],
    },
    {
      topicName: 'The Dust Bowl',
      wikipediaTitle: 'Dust Bowl',
      angle:
        'How a decade of plowing the Great Plains turned the soil to dust and buried an entire region in black blizzards — a man-made catastrophe wrapped in the Depression.',
      subjects: [],
    },
    {
      topicName: 'Building the Empire State Building',
      wikipediaTitle: 'Empire State Building',
      angle:
        'The tallest building on earth, thrown up in 410 days at the bottom of the Great Depression — a race against a rival skyscraper and against the market itself.',
      subjects: [],
    },
    {
      topicName: 'Building the Hoover Dam',
      wikipediaTitle: 'Hoover Dam',
      angle:
        'To tame the Colorado River, thousands worked in 120-degree canyons for a bankrupt nation — engineering triumph paid for in workers’ lives.',
      subjects: [],
    },
    {
      topicName: 'The Attack on Pearl Harbor',
      wikipediaTitle: 'Attack on Pearl Harbor',
      angle:
        'The surprise dawn raid that sank a fleet at anchor and pulled America into a world war — "a date which will live in infamy" and the intelligence failures behind it.',
      subjects: [],
    },
    {
      topicName: 'The Cuban Missile Crisis',
      wikipediaTitle: 'Cuban Missile Crisis',
      angle:
        'Thirteen days in 1962 when two superpowers stood minutes from nuclear war over missiles in Cuba — and the back-channel deal that quietly pulled the world back.',
      subjects: [],
    },
    {
      topicName: 'The Apollo 11 Moon Landing',
      wikipediaTitle: 'Apollo 11',
      angle:
        'Half a billion people watched a man step onto another world with 1960s computing power weaker than a phone — the race, the risk, and "one small step."',
      subjects: [
        { name: 'Neil Armstrong', role: 'other', living: false, isMinor: false },
        { name: 'Buzz Aldrin', role: 'other', living: true, isMinor: false },
        { name: 'Michael Collins', role: 'other', living: false, isMinor: false },
      ],
    },
    {
      topicName: 'Apollo 13: The Successful Failure',
      wikipediaTitle: 'Apollo 13',
      angle:
        '"Houston, we\'ve had a problem" — an oxygen tank explodes 200,000 miles from Earth, and a crippled spacecraft becomes the greatest improvised rescue in history.',
      subjects: [
        { name: 'Jim Lovell', role: 'other', living: true, isMinor: false },
        { name: 'Jack Swigert', role: 'other', living: false, isMinor: false },
        { name: 'Fred Haise', role: 'other', living: true, isMinor: false },
      ],
    },
    {
      topicName: 'The Watergate Scandal',
      wikipediaTitle: 'Watergate scandal',
      angle:
        'A "third-rate burglary" unravelled into the cover-up that brought down a president — the tapes, the leaks, and the two reporters who followed the money.',
      subjects: [
        { name: 'Richard Nixon', role: 'other', living: false, isMinor: false },
      ],
    },
    {
      topicName: 'The Space Shuttle Challenger Disaster',
      wikipediaTitle: 'Space Shuttle Challenger disaster',
      angle:
        'Seventy-three seconds after liftoff on live television, a shuttle broke apart — and the engineers who warned about a frozen rubber seal the night before were overruled.',
      subjects: [],
    },
    {
      topicName: 'The Chernobyl Disaster',
      wikipediaTitle: 'Chernobyl disaster',
      angle:
        'A late-night safety test at a Soviet reactor triggered the worst nuclear accident in history — a botched experiment, a stubborn state, and an exclusion zone that endures.',
      subjects: [],
    },
    {
      topicName: 'The Concorde',
      wikipediaTitle: 'Concorde',
      angle:
        'The supersonic airliner that crossed the Atlantic in three hours and lost money on every seat — engineering triumph, commercial folly, and the crash that grounded a dream.',
      subjects: [],
    },
    {
      topicName: 'The 1918 Spanish Flu Pandemic',
      wikipediaTitle: 'Spanish flu',
      angle:
        'A flu that killed more people than the First World War, censored into silence by wartime governments — and named for the one country honest enough to report it.',
      subjects: [],
    },
  ],
}

const playbook = [
  'You are the History & Business Mini-Docs factory agent. You produce documentary-tone',
  '60–90 second vertical mini-documentaries about historical events and business rises,',
  'falls, and scandals — bubbles, panics, monopolies, inventions, and reform.',
  'ERA GUIDANCE: strongly prefer 1900–1980 topics — the newsreel/photojournalism era —',
  'because they have real public-domain footage and photographs to show. Pre-1900 stories',
  'have almost no usable visuals and are rejected by the media-richness gate at discovery;',
  'only propose one when its archival record is demonstrably rich. Your editorial values:',
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
