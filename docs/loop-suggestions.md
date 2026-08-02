# Loop suggestions

Workflow-prompt improvements proposed by the weekly retro. The retro cannot edit
`.github/workflows/` itself — its token has no `workflow` scope, and those files are copies
of a shared template owned by the dashboard, so an edit made here would be overwritten and
would never reach any other project. The owner applies these from the dashboard.

Newest entry at the bottom.

---

## 2026-08-02 — claude-builder.yml

**Problem:** From 2026-07-28 21:12 to 2026-08-02 22:25, **69 consecutive Builder runs booted
an agent and opened zero pull requests** — every one green. The gate log is identical on all
69: `approved: 10` and `Already claimed by an open PR: 17, 27, 51, 57, 58, 61, 70, 77, 82, 88,
90`. Every approved issue was already claimed by a PR sitting in the owner's review queue, so
the agent's only possible correct move was to stop, which it did ("Nothing to build this run").
The gate already computes both numbers — it just never compares them, so `go=true` fired anyway.

**Suggested prompt change** (the `Check the queue` step, where `nothing_to_build` is derived):

```diff
+          # An approved issue that an open PR already claims is NOT buildable. Counting it
+          # made the gate boot an agent 69 times over five days to open zero PRs — all green,
+          # so nothing ever surfaced that the loop had stopped producing.
+          unclaimed=$(gh issue list --state open --label approved --limit 200 --json number \
+            --jq --arg c "$claimed" '[.[] | select(($c | split(", ")) | index(.number|tostring) | not)] | length')
+          case "$unclaimed" in ''|*[!0-9]*) unclaimed=0 ;; esac
+          echo "Approved and NOT already claimed: $unclaimed"
+
           if [ "$AUTONOMOUS" = "true" ]; then
             pick_rule='2. If none are approved, choose the SINGLE strongest open issue labeled `proposal` — judge by value to the product against effort and risk, and prefer small. You are trusted to choose. Do not ask, do not build more than one.'
-            nothing_to_build=$([ "$approved" -eq 0 ] && [ "$proposals" -eq 0 ] && echo true || echo false)
+            nothing_to_build=$([ "$unclaimed" -eq 0 ] && [ "$proposals" -eq 0 ] && echo true || echo false)
           else
             pick_rule='2. If none are approved, STOP without opening a PR. Autonomous build is OFF for this project — you may only build issues the owner has explicitly labeled `approved`. Do not self-pick a proposal, no matter how strong it looks, and do not comment suggesting one — the owner has chosen to review before anything gets built.'
-            nothing_to_build=$([ "$approved" -eq 0 ] && echo true || echo false)
+            nothing_to_build=$([ "$unclaimed" -eq 0 ] && echo true || echo false)
           fi
```

and, because `nothing_to_build` now means "the queue is genuinely drained", change that
branch's message so the owner learns *why* the loop went quiet:

```diff
           elif [ "$nothing_to_build" = "true" ]; then
-            echo "Nothing to build — the shelf is empty (or autonomous build is off and nothing is approved). Scout will restock it."
+            echo "::warning::Nothing to build: $approved approved issue(s), but all are already claimed by an open PR. The loop is blocked on REVIEW, not on ideas — merge or close a PR to unblock it."
             echo "go=false" >> "$GITHUB_OUTPUT"
```

**Why it should work:** the gate already has both facts in local variables; this is one
comparison. It turns 69 pointless agent boots into 69 fifteen-second bash runs, and — more
importantly — it replaces five days of green-and-silent with a warning that names the real
bottleneck. LEARNINGS.md has said since 2026-07-14 that "a green run that did nothing is a
lie"; the Scout has a `Verify Scout actually filed something` step that enforces it, and the
Builder has no equivalent step at all. Adding one (`exit 1` if `go=true` produced no new
`claude/` PR) would close the same hole from the other side.

---

## 2026-08-02 — claude-builder.yml

**Problem:** Two PRs were closed unmerged this week for merge conflicts and their issues
re-queued (#47 → #45, #54 → #51). The Builder rebuilt both from scratch and re-introduced the
same class of defect the dead PR's adversarial audit had already found. #54's audit: *"the new
step mispronounces two very common decades — the exact kind of mistake this PR exists to fix"*
(regex over-match in `pronunciation.ts`). Its rebuild #123, eleven days later, same file:
*"introduces new mispronunciations that are worse than the ones it fixes — World War **eye
eye**, **N A S A**, **S W A T**"*. Same story for #47 → #122 and the name matcher in
`defamationLint.ts`. An audit that found a real bug was thrown away with the branch.

**Suggested prompt change** — in the Builder prompt, immediately after the existing block:

```diff
   READ THE WHOLE CONVERSATION, NOT JUST THE ISSUE BODY:
   run `gh issue view <n> --comments`. The owner often clarifies, narrows, or changes
   his mind in the comments — "only do the YouTube part", "skip the migration", "keep
   it small". **His comments OVERRIDE the original issue body.** Building the body while
   ignoring a comment that contradicts it means building the wrong thing. If a comment
   genuinely conflicts with the body and you cannot tell which he means, build the
   SMALLER interpretation and say so in the PR.
+
+  CHECK WHETHER THIS ISSUE HAS BEEN BUILT BEFORE. Run
+  `gh pr list --state closed --search "<issue number>" --limit 200 --json number,title,url`.
+  If an earlier PR for this issue was closed unmerged, read its audit comment in full
+  (`gh pr view <n> --comments`) BEFORE you write any code. That audit is a list of defects
+  someone already proved are real in this exact feature — a rebuild that reintroduces them
+  has wasted the whole previous cycle. Turn every blocking finding into a failing test
+  first, then make it pass, and list in your PR description which prior findings you covered.
```

**Why it should work:** the Builder is already told to read the issue's comments; it is never
told that a closed PR for the same issue exists or that its audit is worth reading. Both
rebuilds this week were re-audited to `FIX FIRST` on findings that were already written down
in public a week earlier. Making the prior findings into tests converts a document nobody
reads into a gate the build cannot pass.
