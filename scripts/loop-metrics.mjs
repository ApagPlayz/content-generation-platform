#!/usr/bin/env node
/**
 * Measures the autonomous improvement loop using GitHub as the source of truth.
 *
 * We deliberately do NOT ask the agents how they did. A green agent run only means
 * "nothing crashed" — it says nothing about whether the work was any good. The only
 * honest signals are: did the owner merge it, did he close it, did he ignore it.
 *
 * Writes metrics/loop-metrics.json (full history) and LOOP-DASHBOARD.md (phone-readable).
 *
 * LOOP-DASHBOARD.md is not just a scorecard — it is the Scout's only prescribed learning
 * input. Every Scout run is told to read it and "propose more of what he approves". That
 * instruction was dead for months because the file contained no idea titles, only
 * numbers. It now carries three explicit ledgers — approved, declined, ignored — so
 * there is something in it that can actually be learned from.
 *
 * Dependency-free Node. Runs as `node scripts/loop-metrics.mjs` inside the target repo,
 * with `gh` authenticated via GH_TOKEN.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const HISTORY = "metrics/loop-metrics.json";
const DASHBOARD = "LOOP-DASHBOARD.md";

const gh = (args) =>
  JSON.parse(execFileSync("gh", args, { encoding: "utf8", maxBuffer: 32e6 }));

const isAgentPr = (pr) => pr.headRefName?.startsWith("claude/");
const days = (ms) => ms / 86_400_000;
const median = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
};

const allPrs = gh([
  "pr", "list", "--state", "all", "--limit", "300",
  "--json", "number,title,state,headRefName,createdAt,mergedAt,closedAt,additions,deletions,reviews",
]);

// The Scout's only prescribed learning input used to describe loop-authored PRs as if
// they were the whole repo. That erased the owner's own hand-made work from the picture
// entirely. `agentPrs` keeps every existing metric's meaning unchanged; `humanPrs` and
// `allPrs` let the dashboard show the loop's slice next to the whole repo's.
const agentPrs = allPrs.filter(isAgentPr);
const humanPrs = allPrs.filter((pr) => !isAgentPr(pr));

const issues = gh([
  "issue", "list", "--state", "all", "--limit", "300",
  "--json", "number,title,state,labels,createdAt,updatedAt,closedAt",
]);

const labelled = (i, name) => (i.labels ?? []).some((l) => l.name === name);

// ── The counting rule ───────────────────────────────────────────────────────────
// Approving an idea SWAPS its labels: the dashboard adds `approved` and removes
// `proposal`. So `approved` is NOT a subset of `proposal` — it is a disjoint set.
// The original script computed `proposals.filter(approved)`, which is structurally
// always empty, and reported a 0% approval rate every single day while the real rate
// was 35%. That one line told a healthy Scout it was failing completely.
//
// Correct model: an "idea issue" is any issue carrying `proposal`, `approved` or
// `declined`. Those three are the states of one thing, not nested sets.
const ideaIssues = issues.filter(
  (i) => labelled(i, "proposal") || labelled(i, "approved") || labelled(i, "declined"),
);

// An idea can briefly carry two labels while the dashboard writes them one at a time,
// so rank the states rather than double-counting: approved beats declined beats open.
const stateOf = (i) =>
  labelled(i, "approved") ? "approved" : labelled(i, "declined") ? "declined" : "open";

const approvedIdeas = ideaIssues.filter((i) => stateOf(i) === "approved");
const declinedIdeas = ideaIssues.filter((i) => stateOf(i) === "declined");
const openIdeas = ideaIssues.filter((i) => stateOf(i) === "open" && i.state === "OPEN");

// Ignored: still on the shelf, still open, and nobody has touched it in over a week.
// This is the closest thing the loop has to a silent "no", and the Scout has never
// been shown it.
const now = Date.now();
const ignoredIdeas = openIdeas
  .filter((i) => days(now - new Date(i.updatedAt ?? i.createdAt)) > 7)
  .sort((a, b) => new Date(a.updatedAt ?? a.createdAt) - new Date(b.updatedAt ?? b.createdAt));

const pct = (n, d) => (d ? Math.round((n / d) * 100) : null);

// Cycle time: how long a PR sat waiting on the owner. This is the review bottleneck,
// and it is the number most likely to reveal that the loop is outrunning him.
//
// Batch size. DORA's research ties large changesets to instability, so a rising median
// PR size alongside a falling merge rate is the loop going bad. Watch these together.
//
// One function so the loop/human/all slices are computed identically — only the input
// list differs.
const prMetrics = (list) => {
  const mergedList = list.filter((p) => p.mergedAt);
  const rejectedList = list.filter((p) => p.state === "CLOSED" && !p.mergedAt);
  const openList = list.filter((p) => p.state === "OPEN");
  const cycleTimes = mergedList
    .map((p) => days(new Date(p.mergedAt) - new Date(p.createdAt)))
    .map((d) => Math.round(d * 10) / 10);
  const sizes = list.map((p) => (p.additions ?? 0) + (p.deletions ?? 0));
  return {
    opened: list.length,
    merged: mergedList.length,
    rejected: rejectedList.length,
    open_now: openList.length,
    merge_rate_pct: pct(mergedList.length, mergedList.length + rejectedList.length),
    median_pr_size_lines: median(sizes),
    median_days_to_merge: median(cycleTimes),
    // Owner review load: PRs they had to send back rather than merge as-is.
    needing_changes: mergedList.filter((p) => (p.reviews?.length ?? 0) > 0).length,
  };
};

const loop = prMetrics(agentPrs);
const human = prMetrics(humanPrs);
const all = prMetrics(allPrs);

const snapshot = {
  date: new Date().toISOString().slice(0, 10),
  // Loop-only. Keys and meaning unchanged from before — other things may depend on them.
  prs_opened: loop.opened,
  prs_merged: loop.merged,
  prs_rejected: loop.rejected,
  prs_open_now: loop.open_now,
  merge_rate_pct: loop.merge_rate_pct,
  median_pr_size_lines: loop.median_pr_size_lines,
  median_days_to_merge: loop.median_days_to_merge,
  prs_needing_changes: loop.needing_changes,
  // Whole repo, loop + human combined.
  prs_opened_all: all.opened,
  prs_merged_all: all.merged,
  prs_rejected_all: all.rejected,
  prs_open_now_all: all.open_now,
  merge_rate_pct_all: all.merge_rate_pct,
  median_pr_size_lines_all: all.median_pr_size_lines,
  median_days_to_merge_all: all.median_days_to_merge,
  prs_needing_changes_all: all.needing_changes,
  // Hand-made work only — the slice that used to be invisible.
  prs_opened_human: human.opened,
  prs_merged_human: human.merged,
  prs_rejected_human: human.rejected,
  prs_open_now_human: human.open_now,
  merge_rate_pct_human: human.merge_rate_pct,
  median_pr_size_lines_human: human.median_pr_size_lines,
  median_days_to_merge_human: human.median_days_to_merge,
  prs_needing_changes_human: human.needing_changes,
  // Denominator is the UNION of the three idea states, not the open shelf.
  proposals_filed: ideaIssues.length,
  proposals_approved: approvedIdeas.length,
  proposals_declined: declinedIdeas.length,
  proposals_open: openIdeas.length,
  proposals_ignored_7d: ignoredIdeas.length,
  proposal_approval_rate_pct: pct(approvedIdeas.length, ideaIssues.length),
};

const history = existsSync(HISTORY) ? JSON.parse(readFileSync(HISTORY, "utf8")) : [];
const idx = history.findIndex((h) => h.date === snapshot.date);
if (idx >= 0) history[idx] = snapshot;
else history.push(snapshot);
// The very first run in a fresh repo has no metrics/ folder, and writeFileSync does not
// create one — it threw ENOENT and the whole metrics job went red on day one.
mkdirSync(dirname(HISTORY), { recursive: true });
writeFileSync(HISTORY, JSON.stringify(history, null, 2) + "\n");

// A markdown dashboard, not a web app: it renders natively in the GitHub phone app,
// needs no hosting, and works fine on a private repo (GitHub Pages does not).
const prev = history.length > 1 ? history[history.length - 2] : null;
const delta = (k) => {
  if (!prev || prev[k] == null || snapshot[k] == null) return "";
  const d = snapshot[k] - prev[k];
  return d === 0 ? "" : ` (${d > 0 ? "+" : ""}${d})`;
};
const show = (v, suffix = "") => (v == null ? "—" : `${v}${suffix}`);

const MAX_LIST = 40;
const bullets = (list, empty) => {
  if (!list.length) return `_${empty}_`;
  const shown = list.slice(0, MAX_LIST).map((i) => `- #${i.number} ${i.title}`);
  if (list.length > MAX_LIST) shown.push(`- …and ${list.length - MAX_LIST} more`);
  return shown.join("\n");
};

const byNewest = (a, b) => new Date(b.createdAt) - new Date(a.createdAt);

const health =
  snapshot.merge_rate_pct == null
    ? "**No data yet.** Nothing has been built. Approve a proposal to start the loop."
    : snapshot.merge_rate_pct >= 70
      ? "**Healthy.** Most of what the agents build is good enough to keep."
      : snapshot.merge_rate_pct >= 40
        ? "**Mixed.** You are throwing away a lot of agent work. Read the retro issue."
        : "**Unhealthy.** Most agent work is being rejected. The loop is making noise, not progress. Tighten the proposals before approving more.";

writeFileSync(
  DASHBOARD,
  `# Loop dashboard

*Auto-generated ${snapshot.date}. Do not edit by hand.*

${health}

## Is the work any good?

| | |
|---|---|
| Pull requests merged | ${show(snapshot.prs_merged)}${delta("prs_merged")} |
| Pull requests rejected | ${show(snapshot.prs_rejected)}${delta("prs_rejected")} |
| **Merge rate** | **${show(snapshot.merge_rate_pct, "%")}** |
| Waiting on you right now | ${show(snapshot.prs_open_now)} |

## Is it outrunning you?

| | |
|---|---|
| Typical days to merge | ${show(snapshot.median_days_to_merge)} |
| Typical PR size (lines) | ${show(snapshot.median_pr_size_lines)} |

If PR size climbs while merge rate falls, the agents are writing more and getting it
right less. That is the failure mode to watch for.

## Loop vs. everything else

Every table above is the loop's slice only. Here is that same slice next to your own
hand-made work, so the loop never looks like the whole repo when it isn't.

| | Loop | You (hand) | Whole repo |
|---|---|---|---|
| PRs merged | ${show(loop.merged)} | ${show(human.merged)} | ${show(all.merged)} |
| PRs rejected | ${show(loop.rejected)} | ${show(human.rejected)} | ${show(all.rejected)} |
| Merge rate | ${show(loop.merge_rate_pct, "%")} | ${show(human.merge_rate_pct, "%")} | ${show(all.merge_rate_pct, "%")} |
| Typical PR size (lines) | ${show(loop.median_pr_size_lines)} | ${show(human.median_pr_size_lines)} | ${show(all.median_pr_size_lines)} |
| Typical days to merge | ${show(loop.median_days_to_merge)} | ${show(human.median_days_to_merge)} | ${show(all.median_days_to_merge)} |

## Are the ideas any good?

| | |
|---|---|
| Ideas filed (all time) | ${show(snapshot.proposals_filed)} |
| You approved | ${show(snapshot.proposals_approved)}${delta("proposals_approved")} |
| You declined | ${show(snapshot.proposals_declined)}${delta("proposals_declined")} |
| Still waiting on you | ${show(snapshot.proposals_open)} |
| Untouched for over a week | ${show(snapshot.proposals_ignored_7d)} |
| **Approval rate** | **${show(snapshot.proposal_approval_rate_pct, "%")}** |

A low approval rate means the scout is researching the wrong things. That is fixable —
it is written up in the weekly retro issue.

---

## Learning ledger — read this before proposing anything

*This section exists for the Scout. The three lists below are the owner's actual
revealed preferences: what he said yes to, what he said no to, and what he could not be
bothered to answer. Propose more like the first list, nothing like the second, and less
like the third.*

### ✅ Approved ideas — more like these

${bullets([...approvedIdeas].sort(byNewest), "Nothing approved yet.")}

### ❌ Declined ideas — never propose these or near-variants of them

${bullets([...declinedIdeas].sort(byNewest), "Nothing declined yet. No idea has ever been explicitly rejected, so there is no negative signal to learn from.")}

### 😴 Ignored for more than 7 days — a silent no

${bullets(ignoredIdeas, "Nothing is going stale. The queue is being triaged.")}
`,
);

console.log(JSON.stringify(snapshot, null, 2));
