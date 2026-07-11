# Stale-proof launcher

_2026-07-10_

## What I did
- Fixed the launcher (`npm run go`) so it can never show you an old version of the app again.
- Before: if the app was already running, the launcher just opened your browser — even if that running copy was started before new work was merged in. That's why the app "looked the exact same" today.
- Now: every time the app starts, the launcher takes a fingerprint of the code. On the next launch, if the code has changed since the running copy started, it automatically shuts the old one down and does a full fresh start (database sync, demo data, voice engine, everything). If nothing changed, it just opens your browser like before — fast.
- Tested both cases end to end: it correctly restarted a stale server, and correctly reused a fresh one.

## What I recommend next
- Nothing to do on your end — just keep using `npm run go` as always.
- Still waiting on your pick for content factory #3 (my recommendation: history/business-story mini-docs). Say the word and I'll build it.
