# Fixed what was bogging down your Mac + crash protection

## What I did

- **Found the root cause:** your Mac has only **8 GB of memory (RAM)**, which is small for
  everything you run at once. When it fills up, the Mac freezes or force-restarts — and
  that's what was wiping your terminal progress. I confirmed a real hard crash happened
  earlier today.
- **Turned off memory-wasting programs that were auto-starting at login** (none are needed
  for your video project):
  - **MySQL (two copies)** — your project uses a different, lighter database, so MySQL was
    pure wasted memory. Stopped and disabled.
  - **Ollama** (local AI server) — disabled its auto-start and stopped it.
  - **Steam** + **Google/Microsoft auto-updaters** — removed from auto-start.
  - I left your **work VPN (GlobalProtect)** and your **project's own scheduler** alone.
  - Everything I disabled was **moved, not deleted** — fully reversible.
- **Set up crash-proof terminal sessions (tmux):** every terminal window now joins one
  persistent workspace. If the Terminal app crashes or you close the window, your work
  **keeps running in the background** — just reopen Terminal to pick up where you left off.
  It also **auto-saves every 15 minutes** and restores your layout after a reboot.

## What I recommend next

- **Two quick manual clicks I couldn't do for you (macOS blocks them from automation):**
  1. **Ollama:** System Settings → General → Login Items & Extensions → turn **off "Ollama"**
     so its menu-bar app stops launching at startup.
  2. **Docker:** open Docker Desktop → Settings → uncheck **"Start Docker Desktop when you
     sign in."**
- **To recover a Claude conversation after any crash:** in the project folder run
  `claude --resume` (pick the session) or `claude --continue` (most recent). Your chat
  history is saved to disk, so it comes back even after a restart.
- **Keep fewer heavy apps open together.** Chrome + Claude + Notion + Spotify alone use
  ~2 GB. On an 8 GB Mac, closing what you're not using makes a real difference.
- **Biggest long-term fix:** if crashes continue, more memory is the real cure. This Mac's
  RAM can't be upgraded later, so it's worth keeping in mind for your next machine
  (16 GB+ recommended for this kind of work).
