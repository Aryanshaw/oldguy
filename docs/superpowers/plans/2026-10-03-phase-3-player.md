# Phase 3 Player Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the placeholder page at `GET /` with the real player: several chapter MP4s played as one video, a chapter timeline, a Chat and a Sources tab, and export.

**Architecture:** A React app in `player/`, built once with Vite and committed as `player/dist/`. The existing Node server gains two read-only routes (static player files, chapter sources). The player talks to the server only through the Phase 2 API. Playback lives in a plain TypeScript engine that owns two `<video>` elements; React only draws what the engine and the store report.

**Tech Stack:** Server: Node 26, CommonJS, `node:test`, no runtime dependencies. Player: React 19, Vite, TypeScript (strict), Tailwind 4, shadcn/ui (Button, Tabs, Tooltip, Input), Vitest + Testing Library + jsdom, Playwright for one end-to-end test.

**Spec:** `docs/superpowers/specs/2026-10-03-phase-3-player-design.md` (section 10 overrides sections 1 to 9). Server as built: `docs/phase-2/SUMMARY.md` sections 2, 3, 10, 11. Look: `docs/phase-3/mockups/style-directions-v2.html` (tab 1) and `docs/phase-3/mockups/brand-board.html`.

## Global Constraints

- Work in the worktree `../yap-phase-3`, branch `phase-3-player`. Never commit to `phase-2-server` or `main`.
- The repository root keeps zero runtime dependencies. Every player dependency goes in `player/package.json`.
- Server code stays CommonJS (`.cjs`), tested with `node:test` under `tests/`, in the style of `server/api.cjs`. `npm test` at the root must stay green and must not need `player/node_modules`.
- The server sends `Content-Security-Policy: default-src 'self'`. The built player must contain no inline `<script>`, no inline `<style>`, no `style="..."` attribute in `index.html`, no `data:` or `blob:` address and no outside host. Do not widen the policy.
- The player uses relative URLs only. It never reads, stores or logs the access key.
- Media URLs are built from the chapter id: `/chapters/<id>/video`, `/poster`, `/captions`, `/sources`. Never from the manifest's path fields.
- Only `status === 'ready'` chapters are playable. `duration_s` can be `null`.
- Palette, exact: yellow `#F6C945`, orange `#FF8A1F`, black `#14110A`, cream `#FFF1CC`, white `#FFFFFF`, red `#FF6B57`. No green. Borders 3px solid black, hard offset shadows (4px or 8px, no blur), radius 10 to 14px.
- Font: Archivo 500, 700, 900 from `@fontsource/archivo`, bundled as files. No request to any font host.
- All text from the server (titles, chat, file names, error text) is rendered as React text. `dangerouslySetInnerHTML` is forbidden.
- UI copy uses plain words, sentence case, no exclamation marks. Exact strings are given in the tasks.
- TDD: write the failing test, see it fail, implement, see it pass, commit. Commit messages: `feat:`, `fix:`, `test:`, `docs:`, `chore:`.
- Player commands run from `player/`: `npm test` (Vitest), `npm run build`, `npm run typecheck`.

## Review Focus

1. **The content policy silently blocks things.** Anything inline or `data:` loads nothing and the page looks unstyled or dead. Expected: zero policy violations in the browser console. Pinned in Task 2 (scan of `dist`) and Task 12 (console check).
2. **The chapter list changes during playback.** A chapter is inserted before the playhead, the current one is removed, the preloaded one turns `stale`. Expected: playback does not jump or stall. Pinned in Task 6.
3. **Missing numbers and empty lists.** `duration_s: null`, zero ready chapters, an empty thread, a chapter with no sources or no captions file (404). Expected: a sensible screen, no `NaN`, no crash. Pinned in Tasks 4, 5, 8, 9, 10.
4. **The server goes away.** Stream drops, 403 after a restart, 503 while closing. Expected: the page says what to do and never spins forever. Pinned in Tasks 3, 7, 11.
5. **Hostile or huge text.** A chapter title like `<img src=x onerror=alert(1)>`, a 4,000-character message, a 300-character file path. Expected: shown as text, wrapped or cut, layout intact. Pinned in Tasks 9 and 10. Path tricks on the new asset route are pinned in Task 1.

## File Structure

```
server/player-routes.cjs         static player files + chapter sources route
tests/server-player.test.cjs
player/
  package.json  vite.config.ts  tsconfig.json  index.html  components.json
  scripts/check-dist.mjs         build to a temp folder, compare with dist/
  src/
    main.tsx  App.tsx  theme.css
    types.ts                     Manifest, Chapter, ThreadEntry, AppState, Source, Cue
    api/client.ts                fetch calls + ApiError
    api/stream.ts                EventSource wrapper with reconnect
    lib/vtt.ts                   WebVTT parser
    lib/timeline.ts              playable list, block layout, global time, time format
    engine/engine.ts             two-video playback engine
    state/store.ts               one store, React hook
    components/ui/               button.tsx tabs.tsx tooltip.tsx input.tsx (restyled shadcn)
    components/VideoStage.tsx  Captions.tsx  Controls.tsx  Timeline.tsx
    components/ChatTab.tsx  SourcesTab.tsx  ExportDialog.tsx  Header.tsx  Notice.tsx
    test/                        fixtures.ts, fakeVideo.ts, setup.ts
  e2e/player.spec.ts
  dist/                          committed
.github/workflows/player.yml
```

---

### Task 0: Parent spec amendments and phase README

**Files:** Modify `docs/superpowers/specs/2026-10-02-yap-design.md` (append section 15). Create `docs/phase-3/README.md`.

- [ ] **Step 1:** Append "## 15. Amendments of 2026-10-03 (from Phase 3)" to the parent spec, copying A10 to A16 word for word from Phase 3 spec section 9 and A17 from section 10. Change no earlier line of the parent spec.
- [ ] **Step 2:** Write `docs/phase-3/README.md`: what Phase 3 is (five lines), links to the spec, this plan and the two mockups, and how to run the player in development (`yap serve` in one terminal, `npm run dev` in `player/`).
- [ ] **Step 3:** Run `git diff phase-2-server -- docs/superpowers/specs/2026-10-02-yap-design.md | grep '^-[^-]'`. Expected: no output (nothing removed).
- [ ] **Step 4: Commit** `docs: phase 3 spec amendments A10-A17 and README`.

### Task 1: Server routes for the player and for sources

**Files:** Create `server/player-routes.cjs`, `tests/server-player.test.cjs`. Modify `server/server.cjs` (`handleHome`, `ROUTES`).

**Interfaces:**
- Consumes: the handler shape `{req, res, url, params, state, sendJson}`, `serveFile` from `lib/range.cjs`, `safeChapterFile` and `mediaHandler` patterns in `server/server.cjs`.
- Produces:
  - `playerDir(state) -> string`: `state.deps.playerDir` if set (tests), else `<repo>/player/dist`.
  - `GET /`: with `?key=` unchanged (302 + cookie). Without: if `<playerDir>/index.html` is a plain file, `200 text/html; charset=utf-8` with its bytes; else the placeholder page as today.
  - `GET /assets/:file`: `:file` must match `^[A-Za-z0-9][A-Za-z0-9._-]{0,120}$` and contain no `..`. Served from `<playerDir>/assets/<file>` only if it is a plain file whose real path is inside the real `<playerDir>/assets`. Content type by extension: `.js` `text/javascript; charset=utf-8`, `.css` `text/css; charset=utf-8`, `.woff2` `font/woff2`, `.svg` `image/svg+xml`, `.png` `image/png`, `.jpg` `image/jpeg`; any other extension is `404`. Everything else `404 {"error":"not found"}`.
  - `GET /chapters/:id/sources`: id must be a listed slug. Reads `chapters/<id>/chapter.json` through the same safe-file check as media. `200 {"sources":[{"file","lines":[a,b],"quote"}]}` keeping only entries whose `file` is a non-empty string and whose `lines` is two whole numbers; `quote` defaults to `""`. Missing or unreadable file, or no `sources` array: `200 {"sources":[]}`. Unknown id: `404`. Does not require `ready`.

- [ ] **Step 1: Write failing tests** (`tests/server-player.test.cjs`, start a real server on a temp slug folder with `deps.playerDir` pointing at a temp folder, as `tests/server-media.test.cjs` does):
  - no `index.html` in `playerDir`: `GET /` is the placeholder (body contains the manifest title).
  - with `index.html`: `GET /` returns its exact bytes and `text/html`; `GET /?key=<key>` still answers 302 with the cookie.
  - `GET /assets/app.js` returns the bytes with `text/javascript`; `.css`, `.woff2`, `.svg` get their types; `.map` and `.html` are 404.
  - `GET /assets/..%2Findex.html`, `/assets/%2e%2e`, `/assets/a/b.js`, a name of 200 characters, a name with a NUL: all 404 or 400, never a file from outside `assets/`.
  - a symlink inside `assets/` pointing outside is 404.
  - every answer still carries `Content-Security-Policy: default-src 'self'`; without the key every new route is 403.
  - sources: a chapter with four sources returns four `{file, lines, quote}`; an entry with `lines: "x"` is dropped; missing `chapter.json` gives `{"sources":[]}`; unknown id 404; an id of `../x` 404.
- [ ] **Step 2:** Run `npm test`. Expected: the new file fails, everything else passes.
- [ ] **Step 3: Implement** `server/player-routes.cjs` exporting `{ PLAYER_ROUTES, readPlayerIndex }`; in `server/server.cjs` call `readPlayerIndex(state)` inside `handleHome` before `renderPage`, and spread `PLAYER_ROUTES` into `ROUTES`.
- [ ] **Step 4:** Run `npm test`. Expected: all pass (596 earlier tests plus the new ones).
- [ ] **Step 5: Commit** `feat: serve the built player and chapter sources`.

### Task 2: Player scaffold, tokens, restyled shadcn pieces, policy-safe build

**Files:** Create everything under `player/` except `src/` feature files: `package.json`, `vite.config.ts`, `tsconfig.json`, `index.html`, `components.json`, `src/main.tsx`, `src/App.tsx` (a shell that renders the logo only), `src/theme.css`, `src/components/ui/{button,tabs,tooltip,input}.tsx`, `src/test/setup.ts`, `src/test/dist.test.ts`. Modify root `.gitignore` (ignore `player/node_modules`, not `player/dist`).

**Interfaces:**
- Produces: `npm test`, `npm run build`, `npm run typecheck`, `npm run dev` in `player/`. Tailwind theme colours `yk-yellow`, `yk-orange`, `yk-black`, `yk-cream`, `yk-white`, `yk-red`; utility classes `bd` (3px black border), `sh` (4px shadow), `sh-lg` (8px shadow) defined in `theme.css`. `Button` with `variant: 'primary' | 'accent' | 'plain'`; `Tabs`, `TabsList`, `TabsTrigger`, `TabsContent`; `Tooltip`, `TooltipTrigger`, `TooltipContent`; `Input`.

- [ ] **Step 1:** Create `player/package.json` (`"private": true`, `"type": "module"`) with dependencies `react`, `react-dom`, `@radix-ui/react-tabs`, `@radix-ui/react-tooltip`, `@fontsource/archivo`, `clsx`, `tailwind-merge`, `class-variance-authority`; devDependencies `vite`, `@vitejs/plugin-react`, `typescript`, `tailwindcss`, `@tailwindcss/vite`, `vitest`, `jsdom`, `@testing-library/react`, `@testing-library/user-event`, `@testing-library/jest-dom`, `@types/react`, `@types/react-dom`, `@playwright/test`. Run `npm install` in `player/`.
- [ ] **Step 2:** `vite.config.ts`:

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwind()],
  base: '/',
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    assetsInlineLimit: 0,        // the server's policy forbids data: addresses
    modulePreload: { polyfill: false },
    sourcemap: false,
    cssCodeSplit: false,
  },
  server: {
    proxy: Object.fromEntries(['/api', '/chapters'].map((p) => [p, `http://127.0.0.1:${process.env.YAP_DEV_PORT ?? '4173'}`])),
  },
  test: { environment: 'jsdom', setupFiles: ['src/test/setup.ts'], globals: true, exclude: ['e2e/**', 'node_modules/**'] },
});
```

  The proxy is for local development only. `yap serve` picks a new port each start, so the README from Task 0 tells the developer to set `YAP_DEV_PORT` to it, and to open the keyed URL once on the Vite address so the cookie is set.
- [ ] **Step 3:** `src/theme.css`: `@import "tailwindcss";`, the three `@fontsource/archivo/{500,700,900}.css` imports, an `@theme` block with the six colours and `--font-sans: "Archivo", system-ui, sans-serif`, and the `bd`, `sh`, `sh-lg` utilities. `body` gets cream ground, black text.
- [ ] **Step 4: Write the failing test** `src/test/dist.test.ts`. It runs only when `dist/index.html` exists (use `it.skipIf`), and asserts on `dist/index.html` and every file in `dist/assets`: `index.html` has no `<style`, no `style=`, no `<script>` without `src`; no file contains `data:`, `blob:`, `http://` or `https://` except inside a licence comment starting `/*!`; every `src` and `href` in `index.html` starts with `/assets/`; every asset file name matches `^[A-Za-z0-9][A-Za-z0-9._-]{0,120}$` and ends in `.js`, `.css` or `.woff2`.
- [ ] **Step 5:** Add the four shadcn pieces by hand from the shadcn source (do not run the CLI's init, it rewrites config), restyled: `rounded-[10px] bd font-black`, primary = yellow with `sh`, accent = orange with `sh`, plain = white; active state `translate-y-[2px]` with no shadow; focus ring `outline-3 outline-offset-2 outline-yk-black`. Tabs trigger: active = black ground, yellow text.
- [ ] **Step 6:** Write a component test: `Button` renders its label and calls `onClick`; `Tabs` switches panel on click and on ArrowRight.
- [ ] **Step 7:** Run `npm run typecheck && npm test && npm run build && npm test`. Expected: all pass, including `dist.test.ts` on the fresh build. If Archivo's CSS pulls a `data:` address or a non-`woff2` file, import only the `latin` subset files (`@fontsource/archivo/latin-500.css` and so on).
- [ ] **Step 8:** Do not commit `dist/` yet (Task 12 does). Add `player/dist` to `.git/info/exclude` locally until then. **Commit** `chore: player scaffold with theme tokens and restyled ui pieces`.

### Task 3: Types, API client and stream

**Files:** Create `src/types.ts`, `src/api/client.ts`, `src/api/stream.ts`, `src/test/fixtures.ts`, tests beside each file (`*.test.ts`).

**Interfaces (Produces):**

```ts
// types.ts
export type Status = 'pending' | 'rendering' | 'ready' | 'failed' | 'stale';
export interface Chapter { id: string; title: string; parent_id: string | null; status: Status;
  quality: 'draft' | 'full'; duration_s: number | null; poster: string | null; question: string | null; }
export interface Manifest { version: 1; title: string; slug: string; chapters: Chapter[]; }
export interface SourceRef { file: string; lines: string }                 // "12" or "12-20", from replies
export interface ThreadEntry { id: string; ts: string; role: 'viewer' | 'claude'; text: string;
  in_reply_to?: string; sources?: SourceRef[]; context?: { chapter_id: string; t: number } }
export interface AppState { manifest: Manifest; thread: ThreadEntry[]; claude_connected: boolean; now: number }
export interface ChapterSource { file: string; lines: [number, number]; quote: string }
export interface Cue { start: number; end: number; text: string }

// api/client.ts
export class ApiError extends Error { status: number }                     // message = server's {error} text
export function getState(): Promise<AppState>
export function postMessage(body: { type: 'message' | 'make_video' | 'just_text' | 'retry_chapter';
  text?: string; context?: { chapter_id: string; t: number } }): Promise<ThreadEntry>
export function postExport(dest: string, mode: 'full' | 'drafts'):
  Promise<{ file: string; files: string[]; skipped: { id: string; reason: string }[] }>
export function getSources(id: string): Promise<ChapterSource[]>
export function getCaptionsText(id: string): Promise<string | null>         // null on 404
export const videoUrl: (id: string) => string
export const posterUrl: (id: string) => string

// api/stream.ts
export interface StreamHandlers { onState(s: AppState): void; onReply(r: ThreadEntry): void;
  onChapter(e: { op: string; id?: string; reason?: string; manifest: Manifest }): void;
  onStatus(s: 'open' | 'reconnecting' | 'gone'): void }
export function openStream(h: StreamHandlers, deps?: { EventSource?: typeof EventSource;
  setTimeout?: typeof setTimeout; getState?: typeof getState }): { close(): void }
```

Stream rules: on error, report `reconnecting`, close the source, wait 1 s, 2 s, 4 s, then 8 s for each later try, and open a new one. Before each reopen call `getState()`: a 403 or five failures in a row report `gone` and stop; success calls `onState` and reopens. A `ping` event resets the failure count. No `ping`, `state`, `reply` or `chapter` for 40 s counts as an error.

- [ ] **Step 1: Write failing tests** with `fetch` stubbed by `vi.stubGlobal`:
  - `getState` returns the parsed body; a `500 {"error":"x"}` rejects with `ApiError` status 500 message `x`; a non-JSON error body rejects with message `the server sent an unexpected answer`; a network failure rejects with status 0 and message `the server did not answer`.
  - `postMessage` sends `Content-Type: application/json`, the body as given, and returns `event`.
  - `postExport` passes `dest` and `mode`; a 409 rejects with the server's text.
  - `getCaptionsText` returns `null` on 404 and the text on 200.
  - `getSources` returns `[]` for `{"sources":[]}`.
  - stream, with a fake `EventSource` class and fake timers: `state` then `reply` then `chapter` reach their handlers with parsed data; a `data:` line that is not JSON is ignored and does not throw; an error triggers `reconnecting`, a `getState` call, then a new source after 1 s; a 403 from `getState` reports `gone` and opens nothing more; five failures report `gone`; 40 s of silence triggers a reconnect; `close()` stops timers and closes the source.
- [ ] **Step 2:** Run `npm test`. Expected: FAIL (modules missing). **Step 3: Implement.** **Step 4:** Run. Expected: PASS.
- [ ] **Step 5: Commit** `feat: typed api client and reconnecting stream`.

### Task 4: WebVTT parser

**Files:** Create `src/lib/vtt.ts`, `src/lib/vtt.test.ts`.

**Interfaces (Produces):** `parseVtt(text: string): Cue[]` (sorted by start, never throws) and `cueAt(cues: Cue[], t: number): Cue | null` (the cue with `start <= t < end`, the later one if two overlap).

- [ ] **Step 1: Write failing tests:**

```ts
const VTT = `WEBVTT

1
00:00:00.000 --> 00:00:02.500
Each page becomes its own small job.

00:00:02.500 --> 00:01:04.000 line:90%
A second cue
on two lines.
`;
test('parses cues with and without ids', () => {
  expect(parseVtt(VTT)).toEqual([
    { start: 0, end: 2.5, text: 'Each page becomes its own small job.' },
    { start: 2.5, end: 64, text: 'A second cue\non two lines.' },
  ]);
});
test('cueAt picks the cue covering t', () => {
  const c = parseVtt(VTT);
  expect(cueAt(c, 1)?.text).toMatch(/^Each/);
  expect(cueAt(c, 2.5)?.text).toMatch(/^A second/);
  expect(cueAt(c, 99)).toBeNull();
});
```

  Also: `mm:ss.mmm` times without hours; CRLF line endings; a `NOTE` block and a `STYLE` block are skipped; tags like `<b>` and `<c.x>` are stripped from text and `&amp;` `&lt;` `&gt;` decoded; a cue with a bad time line is dropped; empty string, `"WEBVTT"` alone, and random bytes give `[]`; a cue whose end is not after its start is dropped.
- [ ] **Step 2:** Run: FAIL. **Step 3: Implement.** **Step 4:** Run: PASS.
- [ ] **Step 5: Commit** `feat: webvtt parser for caption overlay`.

### Task 5: Timeline maths

**Files:** Create `src/lib/timeline.ts`, `src/lib/timeline.test.ts`.

**Interfaces (Produces):**

```ts
export interface Position { chapterId: string; offset: number }
export const playable: (chapters: Chapter[]) => Chapter[]                  // status === 'ready', array order
export function total(chapters: Chapter[]): number                         // sum of playable durations (null = 0)
export function globalTime(chapters: Chapter[], p: Position | null): number // 0 when p is null or its chapter is not playable
export function blocks(chapters: Chapter[]): { chapter: Chapter; weight: number; followUp: boolean }[]
export function neighbour(chapters: Chapter[], id: string, dir: 1 | -1): Chapter | null   // among playable
export function fmt(seconds: number): string                               // 125 -> "2:05", 3725 -> "1:02:05"
```

`weight` is `duration_s` when it is a number above 0, else the mean duration of the chapters that have one, else 1. Every weight is at least 4% of the sum, so no block is too thin to click.

- [ ] **Step 1: Write failing tests:** `playable` keeps order and drops the four non-ready statuses; `total` ignores non-ready and `null`; `globalTime` for the third ready chapter at offset 10 with earlier durations 38 and 52 is 100, and it ignores a `rendering` chapter sitting between them; inserting a ready chapter before the position raises `globalTime` by its duration while the position object is unchanged; unknown id gives 0; `blocks` of an all-`null` list gives weight 1 each; a 1 s chapter next to a 300 s one gets at least 4%; `followUp` is true only when `parent_id` is set; empty list gives `[]`; `neighbour` skips non-ready, returns `null` at either end; `fmt(0)` is `0:00`, `fmt(NaN)` and `fmt(-1)` are `0:00`.
- [ ] **Step 2:** FAIL. **Step 3: Implement.** **Step 4:** PASS. **Step 5: Commit** `feat: timeline maths`.

### Task 6: Playback engine

**Files:** Create `src/engine/engine.ts`, `src/engine/engine.test.ts`, `src/test/fakeVideo.ts`.

**Interfaces:**
- Consumes: `Chapter`, `Position`, `playable`, `neighbour` from Tasks 3 and 5.
- Produces:

```ts
export type EngineState = 'idle' | 'playing' | 'paused' | 'blocked' | 'ended';   // blocked = browser refused autoplay
export interface Engine {
  setChapters(chapters: Chapter[]): void;
  play(): Promise<void>;  pause(): void;
  seek(p: Position): void;
  position(): Position | null;
  state(): EngineState;
  visible(): 'a' | 'b';
  on(ev: 'time' | 'chapter' | 'state' | 'error', fn: (detail?: unknown) => void): () => void;
  destroy(): void;
}
export function createEngine(o: { a: HTMLVideoElement; b: HTMLVideoElement; urlFor: (id: string) => string }): Engine
```

`fakeVideo.ts` exports `makeFakeVideo()` returning an object with `src`, `currentTime`, `paused`, `preload`, `load()`, `play()` (resolves, or rejects with a `NotAllowedError` when `fake.blockPlay` is true), `pause()`, `addEventListener`, `removeEventListener`, and `fake.fire(name)` to emit `canplay`, `ended`, `timeupdate`, `error`.

Rules (spec 5.1): position is `{chapterId, offset}` only; the idle element holds the next playable chapter with `preload = 'auto'`; on `ended` swap elements, play the new one, load the one after into the now idle element; a seek within the current chapter sets `currentTime`; a seek to another chapter loads it in the idle element at that offset, waits for `canplay`, then swaps, and a newer seek cancels an older pending one; `setChapters` never touches the visible element unless its chapter stopped being playable; an element's `src` is assigned only when it changes.

- [ ] **Step 1: Write failing tests** (all with fake videos):
  - after `setChapters([c1,c2,c3])`: `a.src` is `c1`'s URL, `b.src` is `c2`'s, position is `{c1, 0}`, state `idle`.
  - `play()` plays `a`; firing `ended` on `a` makes `visible()` `'b'`, plays `b`, sets `a.src` to `c3`, emits `chapter` with `c2`.
  - `ended` on the last chapter gives state `ended` and position at the last chapter's duration; `play()` after that restarts from the first chapter.
  - `seek({c1, 12})` sets `a.currentTime = 12` with no swap.
  - `seek({c3, 5})` while playing `c1`: `b.src` becomes `c3`; before `canplay` the visible element is still `a`; after `canplay` visible is `b`, `b.currentTime` is 5, and it plays because the engine was playing.
  - two quick seeks, `c3` then `c2`: only `c2` wins; the late `canplay` for `c3` does nothing.
  - seek to an id that is not playable is ignored.
  - **Review Focus 2:** while playing `c2` at 10 s, `setChapters([c0new, c1, c2, c3])`: position stays `{c2, 10}`, the visible `src` is not reassigned, `currentTime` untouched.
  - **Review Focus 2:** while playing `c1` with `c2` preloaded, `setChapters` where `c2` is `stale`: the idle `src` becomes `c3`.
  - **Review Focus 2:** while playing `c2`, `setChapters([c1, c3])`: engine moves to `{c3, 0}` and keeps playing; with `setChapters([c1])` it pauses with state `ended`.
  - `setChapters([])`: state `idle`, position `null`, both `src` empty, `play()` resolves and does nothing.
  - a chapter that turns `ready` and is next in order becomes the preloaded one.
  - `play()` rejected by the browser: state `blocked`, no throw.
  - `error` on the visible element: emits `error` with the chapter id, moves to the next playable chapter; `error` on the idle element: emits `error`, preloads the one after.
  - `time` events carry the current position; `destroy()` removes every listener and clears both `src`.
- [ ] **Step 2:** FAIL. **Step 3: Implement.** **Step 4:** PASS.
- [ ] **Step 5: Commit** `feat: two-video playback engine`.

### Task 7: Store

**Files:** Create `src/state/store.ts`, `src/state/store.test.ts`.

**Interfaces:**
- Consumes: `getState`, `postMessage`, `openStream`, types.
- Produces:

```ts
export type Link = 'loading' | 'open' | 'reconnecting' | 'gone' | 'forbidden' | 'error';
export interface Snapshot { link: Link; error: string | null; manifest: Manifest | null; thread: ThreadEntry[];
  claudeConnected: boolean; failReasons: Record<string, string>; sent: Record<string, true>; }
export function createStore(deps?: { getState?; postMessage?; openStream? }): {
  start(): void; stop(): void; retry(): void;
  get(): Snapshot; subscribe(fn: () => void): () => void;
  ask(text: string, context?: { chapter_id: string; t: number }): Promise<void>;   // rejects with ApiError
  press(kind: 'make_video' | 'just_text' | 'retry_chapter', key: string, context?: { chapter_id: string; t: number }): Promise<void>;
}
export function useStore<T>(store: ReturnType<typeof createStore>, pick: (s: Snapshot) => T): T   // useSyncExternalStore
```

Rules: `start` loads state then opens the stream. First load failing with 403 gives `link: 'forbidden'`; any other failure gives `'error'` with the message; `retry()` tries again. `onState` replaces manifest, thread and `claudeConnected`. `onReply` appends unless an entry with that id exists. `onChapter` replaces the manifest and, when the event has `id` and `reason`, stores `failReasons[id]`. `ask` appends the returned event (with `role: 'viewer'`) unless present. `press` posts and sets `sent[key]`. `get()` returns the same object until something changes.

- [ ] **Step 1: Write failing tests:** each rule above, plus: a `reply` arriving twice appears once; a `state` event after an `ask` does not duplicate the message; `ask` rejection leaves the thread unchanged and rethrows; stream status `gone` sets `link: 'gone'`; `reconnecting` then a fresh state returns to `open`; `stop()` closes the stream; subscribers are called once per change; a manifest with zero chapters is accepted (Review Focus 3).
- [ ] **Step 2:** FAIL. **Step 3: Implement.** **Step 4:** PASS. **Step 5: Commit** `feat: player store`.

### Task 8: Video stage, captions, controls, keyboard

**Files:** Create `src/components/VideoStage.tsx`, `Captions.tsx`, `Controls.tsx`, `src/components/usePlayer.ts`, tests for each.

**Interfaces:**
- Consumes: `createEngine`, `getCaptionsText`, `parseVtt`, `cueAt`, `globalTime`, `total`, `fmt`, `neighbour`, `videoUrl`.
- Produces: `usePlayer(chapters: Chapter[]): { refA, refB, visible, state, position, play, pause, toggle, seek, step(seconds), jump(dir: 1 | -1) }`; `<VideoStage player chapters captionsOn />`; `<Captions chapterId offset on />`; `<Controls player chapters captionsOn onToggleCaptions />`.

Behaviour: two `<video>` elements stacked, the hidden one `visibility: hidden`, both `playsInline`. Empty state text when no chapter is playable: `The first chapter is rendering.` if any chapter is `rendering` or `pending`, else `Nothing to play yet.` State `blocked` or `idle` shows a large round play button over the video. Captions fetch once per chapter id, cache in a `Map`, show nothing on `null` or on fetch failure; drawn as a black bar with yellow text in the lower third, `aria-live="off"`. Controls: round play/pause button (`aria-label` `Play` or `Pause`), current chapter title, `2:05 / 5:35`, a `CC` toggle button with `aria-pressed`. The captions choice is kept in `localStorage` key `yap.captions` inside try/catch, default on. Keys on `window`, ignored when the target is an input, textarea or dialog: Space toggle, ArrowLeft and ArrowRight step 5 s (crossing into the neighbour chapter when the offset leaves the current one), `[` and `]` jump chapter, `c` toggle captions.

- [ ] **Step 1: Write failing tests** (render with fake engine injected through a `createEngine` prop defaulting to the real one): empty-state texts for both cases (Review Focus 3); play button calls `play`, label flips to `Pause` on state `playing`; time shows `0:00 / 0:00` for an all-`null` duration list, never `NaN`; captions show the cue for the offset, switch text as the offset passes 2.5, and vanish when `on` is false; a 404 captions fetch shows nothing and does not retry on every render; Space toggles, `c` flips `aria-pressed` and writes `localStorage`; keys typed in an `<input>` do nothing; ArrowRight at 62 s of a 64 s chapter seeks to `{next, 3}`; `]` on the last chapter does nothing; `localStorage` throwing does not crash.
- [ ] **Step 2:** FAIL. **Step 3: Implement.** **Step 4:** PASS. **Step 5: Commit** `feat: video stage, captions and controls`.

### Task 9: Timeline component

**Files:** Create `src/components/Timeline.tsx`, `Timeline.test.tsx`.

**Interfaces:**
- Consumes: `blocks`, `fmt`, `posterUrl`, `Tooltip`, `Position`.
- Produces: `<Timeline chapters position failReasons onSeek(p: Position) onRetry(id: string) />`.

Each block is a `<button>` with `flex-grow` set to its weight through the React `style` prop (allowed by the policy; a `style` attribute in HTML is not). Looks per spec 4.1 plus section 10 point 4: played = black with cream text; current = white with a yellow fill layer whose width is `offset / duration` percent, lifted 4px with `sh`; upcoming = white; follow-up adds a dashed border and pale orange ground `#FFD9A8`; `rendering` = animated orange and cream stripes with the label `rendering`; `pending` = white, dashed border, label `waiting`; `failed` = red with the label `failed, retry`; `stale` = white, dashed grey border, struck-through title, label `out of date`; `quality: 'draft'` adds a small `draft` tag. "Played" means a ready chapter before the current one in order. Clicking a ready block calls `onSeek({chapterId, offset})` where offset is the click's horizontal fraction times the duration for the current block, and 0 for others. Clicking a failed block calls `onRetry`. `rendering`, `pending` and `stale` blocks are `aria-disabled` and do nothing. Accessible name: `<title>, <state words>, <duration>`. Tooltip content: full title, duration, poster image when `poster` is not `null`, and the fail reason when known. The stripe animation is a CSS class in `theme.css` and stops under `prefers-reduced-motion`.

- [ ] **Step 1: Write failing tests:** one test per row of the look table asserting the class or label and the accessible name; click on a ready upcoming block seeks to offset 0; click at 25% of the current 64 s block seeks to 16; click on `rendering` calls nothing; click on `failed` calls `onRetry` with its id; a `draft` tag appears only for drafts; an empty chapter list renders an empty bar with no error; **Review Focus 5:** a title `<img src=x onerror=alert(1)>` appears as that literal text and the document contains no `img` from it, and a 300-character title does not change the bar's height (assert the `truncate` class); keyboard: Tab reaches each enabled block and Enter seeks.
- [ ] **Step 2:** FAIL. **Step 3: Implement.** **Step 4:** PASS. **Step 5: Commit** `feat: chapter timeline`.

### Task 10: Chat and Sources tabs

**Files:** Create `src/components/ChatTab.tsx`, `SourcesTab.tsx`, tests for each.

**Interfaces:**
- Consumes: store (`ask`, `press`, snapshot fields), `getSources`, `Position`, `Button`, `Input`.
- Produces: `<ChatTab store position chapters />`, `<SourcesTab store position chapters />`.

Chat: thread in order; viewer entries are yellow bubbles on the right; Claude entries are white cards on the left with `sources` as chips reading `file:lines`. Under each Claude entry a `Make this a video` button calling `press('make_video', 'mv:' + entry.id, entry.context)`; once in `sent` it is disabled and reads `Asked for a video`. Under the thread, for each chapter that has a `question` and status `rendering`, a line `Making a chapter for: <question>` with a `Just text` button calling `press('just_text', 'jt:' + chapter.id, {chapter_id, t: 0})`, then disabled reading `Asked for text`. When `claudeConnected` is false a notice reads `Claude isn't connected: run /yap resume in Claude Code`, and viewer messages newer than the last Claude reply show the small label `waiting`. Composer: a textarea (Enter sends, Shift+Enter makes a new line, 4,000 character limit shown as a counter after 3,500) and a `Ask` button. Sending calls `ask(text, {chapter_id, t: offset})`, omitting context when there is no position; while sending the button is disabled; on failure the text stays and the error message appears under the field; on success the field clears and the list scrolls to the end. Empty state: `Ask about anything in this video.`

Sources: for the current chapter, fetch `getSources(id)` (cached per id) and list `file:start-end` in monospace with the quote under it; heading is the chapter title. Then a heading `From answers` and the `file:lines` of every Claude entry that has sources. Empty texts: `This chapter lists no sources.` and nothing for the second group when empty.

- [ ] **Step 1: Write failing tests:** bubbles and cards by role; source chips; `Make this a video` posts once and flips to `Asked for a video`; `Just text` appears only for a rendering chapter with a question; the disconnected notice text exactly; the `waiting` label logic; Enter sends, Shift+Enter does not; whitespace-only text does not send; a rejected `ask` keeps the text and shows the error; success clears the field; **Review Focus 5:** a 4,000-character message with no spaces wraps (`break-words` class) and text `<script>alert(1)</script>` shows literally; **Review Focus 3:** empty thread shows the empty text; Sources shows the chapter's entries, switches when `position.chapterId` changes, shows the empty text for `[]`, and survives a rejected `getSources` with the text `Could not load sources.`; a 300-character file path wraps.
- [ ] **Step 2:** FAIL. **Step 3: Implement.** **Step 4:** PASS. **Step 5: Commit** `feat: chat and sources tabs`.

### Task 11: Header, export dialog, notices, app shell

**Files:** Create `src/components/Header.tsx`, `ExportDialog.tsx`, `Notice.tsx`; rewrite `src/App.tsx`; tests for each. Copy the logo mark SVG from `docs/phase-3/mockups/brand-board.html` (symbol `mark`) into `src/components/Logo.tsx`.

**Interfaces:**
- Consumes: everything above; `postExport`.
- Produces: `<App />` wiring: store started on mount, `usePlayer(manifest.chapters)`, layout of mockup tab 1 (`grid-cols-[minmax(0,1fr)_360px]`, one column under 1000px with the panel below), `Tabs` with `Chat` and `Sources`, a collapse button for the panel.

Header: logo, the manifest title, a pill reading `Claude connected` or `Claude not connected`, and an `Export` button. Notices by `link`: `loading` shows `Loading`; `error` shows the message and a `Try again` button calling `retry`; `forbidden` shows `This link has expired. Open the link printed by Yap again.`; `gone` shows `Yap's server stopped. Run /yap again and open the new link.`; `reconnecting` shows a slim banner `Reconnecting` above the page while everything stays usable.

Export dialog: a native `<dialog>` opened with `showModal()` (Escape and the `Cancel` button close it). One labelled field `Folder (full path)`, placeholder `/Users/you/Desktop`, value remembered in `localStorage` key `yap.exportDest` (try/catch). `Export` sends `postExport(dest, 'full')`. On 409: show the server's text and a second button `Export drafts` that sends `mode: 'drafts'`. On any other failure: show the server's text under the field. While a request runs both buttons are disabled and read `Exporting`. On success: `Saved` then the list of `files`, and when `skipped` is not empty the line `Left out:` with each id and reason. An empty or relative path is refused in the page with `Type the full path of a folder, starting with /`.

- [ ] **Step 1: Write failing tests:** each notice text for each `link` value (Review Focus 4); `Try again` calls `retry`; the pill text follows `claudeConnected`; export: empty and relative paths show the message and send nothing; `full` is sent first; a 409 reveals `Export drafts`, which sends `drafts`; a 400 shows the server text; a 503 shows the server text; success lists files and skipped chapters; the path is saved and restored; buttons are disabled during a request; the app renders with a manifest of zero chapters; the panel collapse button hides and shows the panel and has `aria-expanded`.
  jsdom has no `showModal`: in `src/test/setup.ts` define `HTMLDialogElement.prototype.showModal` and `close` to set and remove the `open` attribute.
- [ ] **Step 2:** FAIL. **Step 3: Implement.** **Step 4:** Run `npm run typecheck && npm test`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: header, export dialog and app shell`.

### Task 12: Committed build, build check, end-to-end test, acceptance

**Files:** Create `player/scripts/check-dist.mjs`, `player/e2e/player.spec.ts`, `player/playwright.config.ts`, `player/e2e/make-fixture.cjs`, `.github/workflows/player.yml`, `docs/phase-3/ACCEPTANCE.md`. Commit `player/dist/`. Remove the local exclude line from Task 2.

**Interfaces:**
- Produces: `npm run check:dist` (exit 0 when a fresh build equals `dist/`, else exit 1 listing the differing files); `npm run e2e`.

- [ ] **Step 1:** `check-dist.mjs`: run `vite build --outDir <temp>`, compare the sorted list of relative paths and the sha256 of each file with `dist/`, print differences, exit 1 if any. Add `"check:dist"` and `"e2e": "playwright test"` to `player/package.json`.
- [ ] **Step 2:** `e2e/make-fixture.cjs`: builds a temp slug folder with three ready chapters of 3 s each (ffmpeg `testsrc` video plus a `sine` tone at a different pitch per chapter, each with `build.json` version 2, a matching `render.json`, `beats.json` with `durationS: 3`, `chapter.json` with two sources, and a `captions.vtt` with one cue), one chapter folder holding only a `work-x` folder (rendering), then starts the server with `startServer` and prints the URL. Read how `tests/phase2-acceptance.cjs` builds its fixture and reuse its approach; if ffmpeg is missing, exit with the line `ffmpeg is needed for the end-to-end test`.
- [ ] **Step 3: Write the end-to-end test** (Chromium, started with `--autoplay-policy=no-user-gesture-required`), against the real server serving the real `dist/`:
  - the page loads from the keyed URL, shows the title and four timeline blocks, one labelled `rendering`.
  - **Review Focus 1:** collect console messages and `securitypolicyviolation` events for the whole run; at the end there are none.
  - press play: within 12 s the time passes 6.5 s, so two joins were crossed; at each join the gap between the last `timeupdate` of one chapter and the first of the next is under 250 ms.
  - audio continuity: after the run, neither video element reported `error`, and the visible element is not muted.
  - the caption cue text is visible during chapter one.
  - click the third block: the chip shows its title and the time is at least 6.0.
  - type a question and press Enter: it appears as a bubble; reload; it is still there.
  - open Export, type a temp folder, press Export, press `Export drafts` when offered: the dialog lists three files and they exist on disk.
  - stop the server: within 60 s the page shows `Yap's server stopped.` (Review Focus 4).
- [ ] **Step 4:** Run `npm run build && npm test && npm run check:dist && npm run e2e` in `player/`, then `npm test` at the root. Expected: all pass. If the join gap fails only because of `Cache-Control: no-store` on videos (check the network panel: the idle element refetching at swap), record the measured gap in ACCEPTANCE.md and raise it with the owner; do not change the server header in this task.
- [ ] **Step 5:** `.github/workflows/player.yml`: on push and pull request, Node 26, root `npm test`; then in `player/`: `npm ci`, `npm run typecheck`, `npm test`, `npm run check:dist`.
- [ ] **Step 6: Acceptance by hand** in Chrome against a real `/yap` output if one exists in `.yap/`, else the fixture: check each "Done means" line of spec section 1 and each row of the look table against mockup tab 1, at 1440px and at 900px wide. Record results, with one screenshot per width, in `docs/phase-3/ACCEPTANCE.md`.
- [ ] **Step 7: Commit** `feat: committed player build, build check and end-to-end test`.

### Task 13: Roll-up and review

**Files:** Create `docs/phase-3/SUMMARY.md`. Modify `docs/HANDOFF.md`.

- [ ] **Step 1:** Write `docs/phase-3/SUMMARY.md` in the shape of `docs/phase-2/SUMMARY.md`: what was delivered, numbers (tests, bundle size of `dist/`), each Review Focus item with the test that pins it, decisions taken on the owner's behalf, what is weak or unproven, and what Phase 4 (the chat bridge) can rely on: the four event types the page posts and their `context`, and which buttons wait on `yap listen`.
- [ ] **Step 2:** Update the status lines in `docs/HANDOFF.md`.
- [ ] **Step 3:** Request a whole-branch review (`phase-2-server..phase-3-player`) from a fresh reviewer with the spec, this plan and the Review Focus list. Fix Critical and Important findings test-first; list deferred Minors in the summary.
- [ ] **Step 4: Commit** `docs: phase 3 summary and handoff`.

## Out of scope for Phase 3 (so nobody builds it by accident)

Drag to reorder, trim, delete from the page, word-by-word caption highlight, a route for `captions.json`, a list of several videos, a settings screen, other themes, the animated mascot, `yap listen` and anything that makes Claude answer, remembering the server port across restarts, and changing `Cache-Control` on videos.

## Order of work

0 → 1 → 2 → 3 → (4, 5 in either order) → 6 → 7 → 8 → 9 → 10 → 11 → 12 → 13. Tasks 4 and 5 depend only on Task 3's types. Task 1 is independent of the player tasks and may run beside Task 2.
