# Dashboard ⇄ Repo contract

The owner's dashboard drives the autonomous loop from a phone. This file is the single
source of truth for the handshakes between the dashboard and this repo's GitHub Actions
workflows. **If you change one side, change the other, and update this file.**

Everything the loop does still lands as an issue or a PR that the human merges — agents
never push to `main`.

> This file is installed from the dashboard's new-project template
> (`config/loop-template/files/DASHBOARD-CONTRACT.md`). Edit it here for repo-specific
> details; edit it in the template to change what every future project gets.

---

## 1. Redraft a proposal — "send it back with a note"

**What the dashboard does:** on a `proposal` issue, post the owner's feedback as an issue
comment, then add the label **`redraft`**.

**What happens:** `.github/workflows/claude-redraft.yml` fires on the `redraft` label. The
agent reads the issue + all comments (the owner's latest comment is the feedback that
matters), rewrites the issue body in place into a stronger proposal, posts a short comment
summarizing what changed, then flips the labels so it re-enters the approval queue.

**Label:** `redraft` (color `#D93F0B`). Created at onboarding. It is transient — the
workflow removes it and restores `proposal` when done.

**End state the dashboard can rely on:** after a successful run the issue has label
`proposal` (not `redraft`), a rewritten body, and a new summary comment.

**Who may trigger it:** the label only starts a run when the account that added it has
**admin or maintain** permission on the repo (checked against the GitHub API in an
`authorize` job that gates the rest). This works the same on personal and org-owned repos.
An App/bot identity cannot be permission-checked and is refused — if the dashboard ever
labels as an App rather than as the owner, use the manual re-run below.

**Manual re-run:** `workflow_dispatch` on `claude-redraft.yml` with input `issue_number`
(GitHub already restricts dispatch to accounts with write access).

---

## 2. Idea labels — the triage vocabulary

The dashboard's Ideas page moves an issue between these labels. Nothing else is
machine-readable, so the labels are the contract.

| Label      | Meaning                                                         |
| ---------- | --------------------------------------------------------------- |
| `proposal` | Agent-proposed improvement awaiting the owner's triage.           |
| `approved` | Owner said yes — the builder loop may implement it.               |
| `redraft`  | Owner sent it back for the agent to rewrite from feedback.        |
| `declined` | Owner said **no**. Do not build it, and do not re-propose it.     |

`declined` is a real signal, not a bin: the Scout is expected to read declined issues and
stop generating that kind of idea. A *closed* issue is not the same thing as a declined
one — closing can just mean "rebuild it".

---

## 3. Demo evidence — "prove the PR works"

**What the dashboard does:** nothing to trigger the normal path — it fires automatically on
every agent PR (`pull_request` opened/synchronize for `claude/**` branches). To re-capture,
the dashboard runs `workflow_dispatch` on `claude-demo.yml` with input `pr_number`.

**What happens:** `.github/workflows/claude-demo.yml` checks out the PR branch, builds and
boots the app, and records screenshots + video of the pages the diff affects. Everything is
written to the `evidence/` folder at the **repository root** (the workflow exports it as
`$EVIDENCE_DIR`, an absolute path, because the agent works from the app subfolder), with a
manifest.

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
    { "file": "01-home.png",       "type": "screenshot", "caption": "New budget-cap banner on the home page" },
    { "file": "video/01-home.webm", "type": "video",      "caption": "Owner sets a cap and the banner updates live" }
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

## 4. Install a tool — skill / MCP server / plugin

**What the dashboard does:** send a `repository_dispatch` to this repo.

- **event_type:** `tool-install`
- **client_payload:**

```json
{
  "url": "<link to the skill / MCP server / plugin>",
  "target_agent": "scout|builder|audit|retro|mention|demo|all",
  "notes": "<owner's free-text>"
}
```

Example dispatch (replace `<OWNER>/<REPO>` with this repository):

```bash
gh api repos/<OWNER>/<REPO>/dispatches \
  -f event_type=tool-install \
  -F 'client_payload[url]=https://github.com/some/mcp-server' \
  -F 'client_payload[target_agent]=builder' \
  -F 'client_payload[notes]=we keep guessing at this API'
```

**What happens:** `.github/workflows/claude-tool-install.yml` researches the tool, wires it
into the target agent's workflow (`.mcp.json` entry + `claude-code-action` config, a skill
file, and/or a prompt tweak), tests what it can in CI, and opens ONE PR from a `claude/`
branch. If a step needs a human (signup, API key, OAuth) it opens an issue titled
**`🔑 Action needed: <tool>`** with numbered plain-English steps and links it from the PR.

`target_agent` → workflow file map: `scout`→`claude-scout.yml`, `builder`→`claude-builder.yml`,
`audit`→`claude-audit.yml`, `retro`→`claude-retro.yml`, `mention`→`claude-mention.yml`,
`demo`→`claude-demo.yml`, `all`→every `claude-*.yml`.

`target_agent` is **validated in the workflow** before the agent starts: it is lower-cased,
`auditor` is accepted as an alias of `audit`, and anything else fails the run immediately
with a message listing the valid values — it decides which files get edited, so it is never
treated as free text. `url` must be a plain `http(s)` link. `url` and `notes` are free text,
so they reach the agent inside an untrusted-data fence and can never act as instructions.

---

## 5. Run the test suite

Plain CI, no agent: `.github/workflows/repo-tests.yml`.

- **Dispatch to run on demand:** `workflow_dispatch` on `repo-tests.yml`.
- Also runs automatically on every `pull_request`.
- The steps are **stack-dependent** — the workflow detects this repo's toolchain (e.g.
  `package.json`, `pyproject.toml`) and runs whatever lint / test / build scripts actually
  exist. Do not assume a stack here; read `repo-tests.yml`.

```bash
gh workflow run repo-tests.yml -R <OWNER>/<REPO>
```

---

## 6. Loop configuration

`.github/loop-config.json` is the per-repo control panel the dashboard writes and the
workflows read (via `jq … // default`). See the dashboard's Ideas page for the
owner-facing version of the same values.

Every key is optional. A missing file, a missing key, or a key of the wrong type all fall
back to the default below — a repo that has never been configured behaves exactly as if
the file did not exist.

```json
{
  "autonomousBuildEnabled": false,
  "prCap": 3,
  "ideaQueueCap": 25,
  "demoPort": 3000,
  "scout": {
    "productSummary": "One paragraph: what this product is and who it is for.",
    "currentGoals": ["Ship the mobile approval flow", "Cut demo capture time"],
    "offLimits": ["billing and payments", "anything touching production data"],
    "lenses": ["Cost and unit economics", "Silent failures"],
    "maxPerRun": 3
  }
}
```

| Key                      | Default | Read by            | What it does                                                                                          |
| ------------------------ | ------- | ------------------ | ----------------------------------------------------------------------------------------------------- |
| `autonomousBuildEnabled` | `false` | `claude-builder`   | `false`: only build issues labeled `approved`. `true`: if nothing is approved, self-pick a `proposal`. |
| `prCap`                  | `3`     | `claude-builder`   | Max **non-draft** agent PRs open at once. `"unlimited"` disables the cap. Full ⇒ the Builder stands down. |
| `ideaQueueCap`           | `25`    | `claude-scout`     | Max open `proposal` issues. `"unlimited"` disables the cap. Full ⇒ the Scout stands down.               |
| `demoPort`               | `3000`  | `claude-demo`      | Local port the app is booted on before the browser is driven. Must be a plain integer.                  |
| `scout.productSummary`   | `""`    | `claude-scout`     | Free text: what the product is. Injected into the Scout's prompt as the owner speaking directly.        |
| `scout.currentGoals`     | `[]`    | `claude-scout`     | Array of strings. Proposals serving these win.                                                          |
| `scout.offLimits`        | `[]`    | `claude-scout`     | Array of strings. The Scout proposes nothing in these areas, at all.                                    |
| `scout.lenses`           | `[]`    | `claude-scout`     | Array of strings. Overrides the built-in rotating research angles; empty ⇒ 3 of 8 rotate per run.        |
| `scout.maxPerRun`        | `3`     | `claude-scout`     | Hard cap on issues one Scout run may file, even when the shelf has more room.                           |

The Scout gate prints one line per run saying which of these it actually loaded, or why it
fell back to defaults — check the run log there before assuming a setting was ignored.

### `docs/loop-brief.md` vs `scout.productSummary` — which wins

They are different tools and both should exist:

- **`docs/loop-brief.md` is the long-form context**, read _in the repo_ by every agent
  (Scout, Builder, Auditor, Retro, Redraft) as part of doing its job. It has room for
  nuance: what the product is, how the owner works, what evidence convinces him.
- **The `scout` block is the structured knob set**, injected _into the Scout's prompt_ by
  the gate step before the agent starts. It is short, machine-read, and editable from the
  dashboard on a phone.

**Precedence: for Scout behavior, the `scout` block wins.** If the brief says one thing
and `scout.offLimits` / `currentGoals` / `productSummary` says another, the Scout follows
the block — it is the more recently edited, owner-typed source, and the gate hands it over
as the owner speaking directly. For every other agent, the brief is the only one of the
two they see, so it governs. When the two disagree, that is a bug in the config, not a
feature: fix the brief in the same PR.

---

## 7. Files the loop expects to exist

| Path                          | What it is                                                        |
| ----------------------------- | ----------------------------------------------------------------- |
| `docs/loop-brief.md`          | The product brief every agent reads before proposing work.         |
| `LEARNINGS.md`                | Dated record of mistakes the loop already made. Failures only.     |
| `LOOP-DASHBOARD.md`           | The metrics ledger written by `scripts/loop-metrics.mjs`.          |
| `metrics/loop-metrics.json`   | Daily snapshots behind the dashboard's Metrics page.               |
| `.github/loop-config.json`    | Per-repo caps + autonomy switches (see above).                     |
| `.mcp.json`                   | MCP servers available to this repo's agents (starts empty).        |
