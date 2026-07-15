# Dashboard ⇄ Repo contract

The owner's dashboard drives the autonomous loop from a phone. This file is the single
source of truth for the handshakes between the dashboard and this repo's GitHub Actions
workflows. **If you change one side, change the other, and update this file.**

Everything the loop does still lands as an issue or a PR that the human merges — agents
never push to `main`.

---

## 1. Redraft a proposal — "send it back with a note"

**What the dashboard does:** on a `proposal` issue, post the owner's feedback as an issue
comment, then add the label **`redraft`**.

**What happens:** `.github/workflows/claude-redraft.yml` fires on the `redraft` label. The
agent reads the issue + all comments (the owner's latest comment is the feedback that
matters), rewrites the issue body in place into a stronger proposal, posts a short comment
summarizing what changed, then flips the labels so it re-enters the approval queue.

**Label:** `redraft` (color `#D93F0B`). Created in the repo already. It is transient — the
workflow removes it and restores `proposal` when done.

**End state the dashboard can rely on:** after a successful run the issue has label
`proposal` (not `redraft`), a rewritten body, and a new summary comment.

**Manual re-run:** `workflow_dispatch` on `claude-redraft.yml` with input `issue_number`.

---

## 2. Demo evidence — "prove the PR works"

**What the dashboard does:** nothing to trigger the normal path — it fires automatically on
every agent PR (`pull_request` opened/synchronize for `claude/**` branches). To re-capture,
the dashboard runs `workflow_dispatch` on `claude-demo.yml` with input `pr_number`.

**What happens:** `.github/workflows/claude-demo.yml` checks out the PR branch, builds and
boots the app, and (via Playwright) records screenshots + video of the pages the diff
affects. Everything is written to an `evidence/` folder with a manifest.

### Artifact naming contract — DO NOT DEVIATE

The evidence folder is uploaded as a GitHub Actions artifact named **exactly**:

```
demo-evidence-pr-<PR_NUMBER>
```

e.g. `demo-evidence-pr-123`. The dashboard finds evidence by this name. Changing it breaks
the dashboard silently.

### `evidence/manifest.json` schema

```json
{
  "pr": 123,
  "captured_at": "2026-07-15T12:34:56Z",
  "items": [
    { "file": "01-dashboard.png",      "type": "screenshot", "caption": "New budget-cap banner on the dashboard" },
    { "file": "video/01-dashboard.webm","type": "video",      "caption": "Owner sets a cap and the banner updates live" }
  ]
}
```

- `pr` — integer PR number.
- `captured_at` — ISO 8601 UTC timestamp.
- `items[].file` — path **relative to the `evidence/` folder**.
- `items[].type` — one of `screenshot` | `video` | `log` | `audio` | `other`.
- `items[].caption` — plain-English, owner-facing.

**Backend-only / app won't boot:** the agent still produces a manifest, using `type: "log"`
(or `audio`/`other`) items pointing at test output, before/after CLI dumps, or DB state. The
folder is never empty; the run fails if `evidence/manifest.json` is missing.

**PR comment:** the agent also posts a PR comment titled **`📸 Demo evidence`** listing each
item + caption and naming the artifact.

---

## 3. Install a tool — skill / MCP server / plugin

**What the dashboard does:** send a `repository_dispatch` to the repo.

- **event_type:** `tool-install`
- **client_payload:**

```json
{
  "url": "<link to the skill / MCP server / plugin>",
  "target_agent": "scout|builder|audit|retro|mention|demo|all",
  "notes": "<owner's free-text>"
}
```

Example dispatch:

```bash
gh api repos/ApagPlayz/content-generation-platform/dispatches \
  -f event_type=tool-install \
  -F 'client_payload[url]=https://github.com/some/mcp-server' \
  -F 'client_payload[target_agent]=builder' \
  -F 'client_payload[notes]=we keep guessing at the TikTok API'
```

**What happens:** `.github/workflows/claude-tool-install.yml` researches the tool, wires it
into the target agent's workflow (`.mcp.json` entry + `claude-code-action` config, a skill
file, and/or a prompt tweak), tests what it can in CI, and opens ONE PR from a `claude/`
branch. If a step needs a human (signup, API key, OAuth) it opens an issue titled
**`🔑 Action needed: <tool>`** with numbered plain-English steps and links it from the PR.

`target_agent` → workflow file map: `scout`→`claude-scout.yml`, `builder`→`claude-builder.yml`,
`audit`→`claude-audit.yml`, `retro`→`claude-retro.yml`, `mention`→`claude-mention.yml`,
`demo`→`claude-demo.yml`, `all`→every `claude-*.yml`.

---

## 4. Run the test suite

Plain CI, no agent: `.github/workflows/repo-tests.yml`.

- **Dispatch to run on demand:** `workflow_dispatch` on `repo-tests.yml`.
- Also runs automatically on every `pull_request`.
- Steps: `npm ci` → `prisma generate` + `prisma db push` → `npm run lint` →
  `npm run test` (vitest) → `npm run build`.

```bash
gh workflow run repo-tests.yml -R ApagPlayz/content-generation-platform
```
