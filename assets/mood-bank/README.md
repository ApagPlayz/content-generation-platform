# Mood bank

A local, committed cache of generic atmospheric b-roll ("mood clips") for the
F10 True Crime pipeline — rain, foggy exteriors, police lights, newspaper
macro shots, night streets. It's the **late rung of the footage ladder**: a
generic-atmosphere fallback for beats whose `visualCue` doesn't map to a real
case photo or specific stock clip. Nothing here depicts a real person or a
real case; it's stock atmosphere only.

## How it fits together

- `manifest.json` — committed, hand-curated list of clip entries. Small and
  text-only, safe to review in a PR.
- `clips/` — the actual downloaded video files. **Gitignored** (except
  `.gitkeep`) — same posture as the repo's existing `/media` directory. A
  fresh clone has an empty `clips/` dir until someone runs the populate
  script.
- `scripts/populate-mood-bank.mjs` — reads the manifest and downloads/resolves
  each entry into `clips/`, updating the manifest in place with the real
  license/attribution/dimensions once a file lands. Keyless for archive.org
  entries; needs `PEXELS_API_KEY` for Pexels entries (skipped, not fatal, if
  absent).
- `src/lib/truecrime/moodBank.ts` — the runtime read helper other pipeline
  code imports. It never touches the network; it just reads whatever has
  already been populated on disk and returns `[]` if the bank is empty.

Nothing in this workstream wires the mood bank into the orchestrator — that's
the beat-footage-resolver's job. This is purely the data + the helper it will
call.

## Manifest schema

`manifest.json` is a top-level JSON array. Each entry:

| Field | Type | Notes |
|---|---|---|
| `id` | string | Unique, kebab-case. |
| `category` | string | One of the vocabulary below (or a new one you add). |
| `tags` | string[] | Extra keywords `selectMoodClips()` matches against. |
| `description` | string | Human-readable, shown in this doc / PRs. |
| `file` | string | Filename under `clips/` this entry resolves to. |
| `source` | `'archive.org' \| 'pexels'` | Where the clip comes from. |
| `sourceId` | string? | archive.org identifier, or a Pexels video id. |
| `sourceFile` | string? | Exact filename inside the archive.org item (used to build `downloadUrl`). |
| `pexelsQuery` | string? | Search query used when no fixed `sourceId` is pinned (Pexels only). |
| `searchQuery` | string? | archive.org `advancedsearch` query used when no fixed `sourceId`/`downloadUrl` is pinned. |
| `sourceUrl` | string? | Human-facing page URL (attribution / provenance). |
| `downloadUrl` | string? | Direct file URL. Filled in by the populate script once resolved. |
| `license` | `AssetLicense` | `public_domain \| cc0 \| cc_by \| fair_use \| licensed \| ai_generated \| unknown`. See license honesty below. |
| `licenseRef` | string? | Attribution string / license URL, required once `license` isn't `unknown`. |
| `attribution` | string? | Short "who to credit" string. |
| `durationSec`, `width`, `height` | number? | Backfilled by the populate script (best-effort `ffprobe`). |
| `depictsRealPerson` | boolean | Always `false` for mood-bank clips by design — they're generic atmosphere, never case-specific imagery of real people. |
| `aiGenerated` | boolean | Always `false` — real licensed footage, not synthetic. |
| `populated` | boolean | `true` once the file actually exists in `clips/`. |

## Category vocabulary

`rain`, `foggy-house`, `police-lights`, `newspaper-macro`, `night-street`.
Add a new category by adding entries with a new `category` value — nothing
elsewhere needs to change; `selectMoodClips()` reads whatever categories are
present in the manifest.

## License honesty (read before adding an archive.org entry)

archive.org items are **not uniformly public domain**. Only mark an entry
`public_domain` or `cc0` when the item's `licenseurl` explicitly says so
(`creativecommons.org/publicdomain/zero/1.0` for CC0; a hand-confirmed PD
notice for `public_domain`). The Flickr/archive.org "no known copyright
restrictions" mark (`publicdomain/mark/1.0`) is **not** a formal license —
treat entries under it as `unknown` until a human confirms the rights.

Entries with only a `searchQuery` (no `sourceId`/`downloadUrl`) are
intentionally left unresolved in this commit — the populate script resolves
them live and defaults to `unknown` unless the found item's `licenseurl`
explicitly matches a CC-BY or CC0 pattern. `unknown` clips still populate
(so the ladder has *something*), but downstream compliance treats `unknown`
as review-severity, not a free pass — don't hand-upgrade an entry's license
without actually checking the source.

Pexels entries are always `license: 'licensed'` with `licenseRef: 'Pexels
License'` — that's contractually true of everything Pexels serves, so it's
safe to state upfront (no per-clip confirmation needed).

## Adding a new clip entry

1. Find a candidate on [archive.org](https://archive.org/advancedsearch.php)
   or [Pexels](https://www.pexels.com/) that's actually relevant, small
   (a few seconds to ~30s is plenty — this is background atmosphere, not a
   feature), and has a license you can name honestly.
2. Add an entry to `manifest.json` with `populated: false`. Either pin exact
   `sourceId`/`sourceFile` (or `downloadUrl`) if you've already verified the
   file, or leave a `searchQuery`/`pexelsQuery` for the populate script to
   resolve.
3. Run `npm run moodbank:populate`.
4. Check the manifest diff — confirm `license`/`licenseRef`/`attribution` are
   honest, then commit `manifest.json` (never commit the downloaded file
   itself; `clips/*` is gitignored).

## Running the populate script

```bash
npm run moodbank:populate
```

- archive.org entries download with no key.
- Pexels entries need `PEXELS_API_KEY` in `.env.local` (get a free one at
  pexels.com/api). Without it, Pexels entries are skipped with a warning —
  the script still exits 0 and still populates every archive.org entry it
  can.
- Idempotent: re-running skips any entry whose `clips/<file>` already exists
  with a non-zero size.
- Safe to run on a fresh clone with zero keys — it just won't fill every
  entry, and that's fine; `moodBank.ts` returns `[]` for anything unpopulated
  and the pipeline keeps using its existing footage sources.
