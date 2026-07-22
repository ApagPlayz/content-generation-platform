# Design drafts to pick from (issue #49)

## What I did
- Built a single page you can open to **pick the app's new look** — no rebuild yet, just paint.
- It shows **3 styles** (Clean Studio / Warm Creator / Bold Focus). Keep one screen open and click Style 1 → 2 → 3 to compare, plus a **Dark mode** toggle.
- It previews the **new layout**: the old 7 tabs are grouped into **Home / Studio / Pipeline** + Settings.
- Settings shows the **new TikTok connection card** alongside YouTube.
- Nothing in the live app changed, so nothing can break.

## How to look at it
- Run the app (`npm run go`) and open **http://localhost:3000/design-drafts.html**, or just double-click the file `public/design-drafts.html`.

## What I recommend next
- **Reply with the style number you like** (1, 2 or 3) — or mix ("Style 2 but darker").
- Once you pick, the next PR rebuilds the real screens in that style and wires up the TikTok posting fix. Kept separate on purpose so this step stays quick and reversible.
