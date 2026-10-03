# Phase 3: the player

Phase 3 is the browser page served at `GET /`. It replaces the Phase 2 placeholder.
It plays the chapters of a Yap video as one video, with a chapter timeline that updates live.
It has a Chat tab, where a question is posted and shown as waiting, and a Sources tab.
It can export the finished video to a folder the viewer names.
It is a React app in `player/`, built with Vite and committed as `player/dist/`; the server gains two read-only routes for it.

## Documents

- Spec: [`../superpowers/specs/2026-10-03-phase-3-player-design.md`](../superpowers/specs/2026-10-03-phase-3-player-design.md). Section 10 overrides sections 1 to 9 where they disagree.
- Plan: [`../superpowers/plans/2026-10-03-phase-3-player.md`](../superpowers/plans/2026-10-03-phase-3-player.md).
- Parent spec: [`../superpowers/specs/2026-10-02-yap-design.md`](../superpowers/specs/2026-10-02-yap-design.md), section 15 holds the Phase 3 amendments A10 to A17.
- Mockups:
  - [`mockups/style-directions-v2.html`](mockups/style-directions-v2.html), tab 1 (Neo-Brutalism) is the chosen look.
  - [`mockups/brand-board.html`](mockups/brand-board.html), the colours, type and logo.

## Running the player in development

You need two terminals.

1. In the first, start the server for a slug folder:

   ```
   yap serve
   ```

   It prints a keyed URL such as `http://127.0.0.1:51234/?key=...`. The port is chosen at each start, so it changes every time.

2. In the second, start Vite in `player/`, giving it that port:

   ```
   cd player
   YAP_DEV_PORT=51234 npm run dev
   ```

   Vite proxies `/api` and `/chapters` to the server on that port.

3. Open the keyed URL once on the Vite address. Take the path and query from the server's URL (`/?key=...`) and put them on the Vite address, so the cookie is set for the Vite origin. After that, open the Vite address without the key.

If the server is restarted, it has a new port and a new key. Repeat steps 2 and 3.

The committed build in `player/dist/` is what the server serves at `GET /` outside development. Rebuild it with `npm run build` in `player/` before committing player changes; CI fails when it differs from a fresh build.
