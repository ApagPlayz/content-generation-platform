#!/usr/bin/env node
/**
 * Measures the autonomous improvement loop using GitHub as the source of truth.
 *
 * We deliberately do NOT ask the agents how they did. A green agent run only means
 * "nothing crashed" — it says nothing about whether the work was any good. The only
 * honest signals are: did the owner merge it, did he close it, did he ignore it.
 *
 * Writes metrics/loop-metrics.json (full history) and LOOP-DASHBOARD.md (phone-readable).
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";

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

const prs = gh([
  "pr", "list", "--state", "all", "--limit", "300",
  "--json", "number,title,state,headRefName,createdAt,mergedAt,closedAt,additions,deletions,reviews",
]).filter(isAgentPr);

const issues = gh([
  "issue", "list", "--state", "all", "--limit", "300",
  "--json", "number,title,state,labels,createdAt,closedAt",
]);

const labelled = (i, name) => i.labels.some((l) => l.name === name);
const proposals = issues.filter((i) => labelled(i, "proposal"));
const approved = proposals.filter((i) => labelled(i, "approved"));

const merged = prs.filter((p) => p.mergedAt);
const rejected = prs.filter((p) => p.state === "CLOSED" && !p.mergedAt);
const open = prs.filter((p) => p.state === "OPEN");

// Cycle time: how long a PR sat waiting on the owner. This is the review bottleneck,
// and it is the number most likely to reveal that the loop is outrunning him.
const cycleTimes = merged
  .map((p) => days(new Date(p.mergedAt) - new Date(p.createdAt)))
  .map((d) => Math.round(d * 10) / 10);

// Batch size. DORA's research ties large changesets to instability, so a rising median
// PR size alongside a falling merge rate is the loop going bad. Watch these together.
const sizes = prs.map((p) => (p.additions ?? 0) + (p.deletions ?? 0));

const pct = (n, d) => (d ? Math.round((n / d) * 100) : null);

const snapshot = {
  date: new Date().toISOString().slice(0, 10),
  prs_opened: prs.length,
  prs_merged: merged.length,
  prs_rejected: rejected.length,
  prs_open_now: open.length,
  merge_rate_pct: pct(merged.length, merged.length + rejected.length),
  median_pr_size_lines: median(sizes),
  median_days_to_merge: median(cycleTimes),
  // Owner review load: PRs he had to send back rather than merge as-is.
  prs_needing_changes: merged.filter((p) => (p.reviews?.length ?? 0) > 0).length,
  proposals_filed: proposals.length,
  proposals_approved: approved.length,
  proposal_approval_rate_pct: pct(approved.length, proposals.length),
};

const history = existsSync(HISTORY) ? JSON.parse(readFileSync(HISTORY, "utf8")) : [];
const idx = history.findIndex((h) => h.date === snapshot.date);
if (idx >= 0) history[idx] = snapshot;
else history.push(snapshot);
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

## Are the ideas any good?

| | |
|---|---|
| Proposals filed | ${show(snapshot.proposals_filed)} |
| Proposals you approved | ${show(snapshot.proposals_approved)} |
| **Approval rate** | **${show(snapshot.proposal_approval_rate_pct, "%")}** |

A low approval rate means the scout is researching the wrong things. That is fixable —
it is written up in the weekly retro issue.
`,
);

console.log(JSON.stringify(snapshot, null, 2));
