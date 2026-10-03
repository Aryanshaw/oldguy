import { createRequire } from 'node:module';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

const require = createRequire(import.meta.url);
const { startFixture } = require('./make-fixture.cjs') as typeof import('./make-fixture.cjs');

type Fixture = Awaited<ReturnType<typeof startFixture>>;
interface VideoEvt { kind: string; chapter: string; t: number; ct: number; played: [number, number][] }
interface FrameEvt { chapter: string; shown: number; visible: boolean }

const JOIN_GAP_MS = 100;
const SECONDS = 3;

test.describe.configure({ mode: 'serial' });

let fixture: Fixture;
let exportDir = '';
const problems: string[] = [];

test.beforeAll(async () => {
  fixture = await startFixture();
  exportDir = mkdtempSync(join(tmpdir(), 'yap-e2e-export-'));
});

test.afterAll(async () => {
  await fixture?.stop().catch(() => {});
  if (exportDir) rmSync(exportDir, { recursive: true, force: true });
});

// Records every video timeupdate/error (capture phase, since media events do not bubble) and every CSP violation.
async function instrument(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __v: VideoEvt[]; __csp: string[] };
    w.__v = [];
    w.__csp = [];
    const chapterOf = (el: EventTarget | null) => {
      const src = (el as HTMLVideoElement | null)?.currentSrc || (el as HTMLVideoElement | null)?.src || '';
      const m = /\/chapters\/([^/]+)\/video/.exec(src);
      return m ? decodeURIComponent(m[1]) : '';
    };
    for (const kind of ['timeupdate', 'error', 'ended', 'play', 'playing', 'canplay']) {
      document.addEventListener(
        kind,
        (e) => {
          if (e.target instanceof HTMLVideoElement) {
            const pr: [number, number][] = [];
            for (let i = 0; i < e.target.played.length; i++) pr.push([e.target.played.start(i), e.target.played.end(i)]);
            w.__v.push({ kind, chapter: chapterOf(e.target), t: performance.now(), ct: e.target.currentTime, played: pr });
          }
        },
        true,
      );
    }
    // Every painted frame of every video element: when it reached the screen (the page clock, ms) and which chapter it is from.
    const f: FrameEvt[] = [];
    (w as unknown as { __f: FrameEvt[] }).__f = f;
    const seen = new WeakSet<HTMLVideoElement>();
    const watch = (v: HTMLVideoElement) => {
      const tick = (_now: number, meta: { expectedDisplayTime: number }) => {
        f.push({ chapter: chapterOf(v), shown: meta.expectedDisplayTime, visible: getComputedStyle(v).visibility !== 'hidden' });
        v.requestVideoFrameCallback(tick);
      };
      v.requestVideoFrameCallback(tick);
    };
    setInterval(() => {
      for (const v of document.querySelectorAll('video')) if (!seen.has(v)) { seen.add(v); watch(v); }
    }, 20);
    document.addEventListener('securitypolicyviolation', (e) => w.__csp.push(`${e.violatedDirective} ${e.blockedURI}`));
  });
}

const events = (page: Page) => page.evaluate(() => (window as unknown as { __v: VideoEvt[] }).__v);
const frames = (page: Page) => page.evaluate(() => (window as unknown as { __f: FrameEvt[] }).__f);
const clock = (page: Page) => page.getByText(/^\d+:\d\d \/ \d+:\d\d$/);

test('the player plays, joins, asks, exports and notices the server stopping', async ({ page }) => {
  page.on('console', (m) => {
    // Chromium reports a failed load as a console error; every message counts, whatever its type.
    problems.push(`console.${m.type()}: ${m.text()}`);
  });
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  await instrument(page);

  await test.step('loads from the keyed URL and shows title and four blocks', async () => {
    await page.goto(fixture.url);
    await expect(page).toHaveURL(`http://127.0.0.1:${fixture.port}/`);
    const state = await (await page.request.get(`http://127.0.0.1:${fixture.port}/api/state`)).json();
    expect(state.manifest.title).toBeTruthy();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(state.manifest.title);
    const blocks = page.getByRole('group', { name: 'Chapters' }).getByRole('button');
    await expect(blocks).toHaveCount(4);
    await expect(blocks.nth(3)).toHaveAttribute('data-look', 'rendering');
    await expect(blocks.nth(3)).toContainText('rendering');
    for (let i = 0; i < 3; i++) await expect(blocks.nth(i)).not.toHaveAttribute('data-look', 'rendering');
  });

  await test.step('plays across two joins; each ended -> first painted frame is at most 100 ms', async () => {
    await page.getByRole('button', { name: 'Play video' }).click();
    await expect
      .poll(async () => (await events(page)).some((e) => e.kind === 'timeupdate' && e.chapter === 'three-end' && e.ct > 0.5), {
        timeout: 12_000,
        intervals: [100],
      })
      .toBe(true);
    await expect(clock(page)).toHaveText(/^0:0[6-9] \/ 0:09$/);
    const all = await events(page);
    const ev = all.filter((e) => e.kind === 'timeupdate');
    const ids = ['one-intro', 'two-middle', 'three-end'];
    const fr = await frames(page);
    const endedToFrame: number[] = [];
    for (let i = 0; i < 2; i++) {
      // Spike 6's metric: the outgoing element's `ended` to the first painted frame of the incoming visible element.
      const ended = all.find((e) => e.kind === 'ended' && e.chapter === ids[i]);
      expect(ended, `an ended event of ${ids[i]}`).toBeTruthy();
      const firstF = fr.find((x) => x.visible && x.chapter === ids[i + 1] && x.shown >= ended!.t - 1);
      expect(firstF, `a painted frame of ${ids[i + 1]} after ${ids[i]} ended`).toBeTruthy();
      const ms = firstF!.shown - ended!.t;
      endedToFrame.push(ms);
      // Logged only: other events of the incoming element, the last-frame gap and the raw timeupdate gap.
      const inc = all.filter((e) => e.chapter === ids[i + 1] && e.t >= ended!.t - 1);
      const at = (k: string) => { const e = inc.find((x) => x.kind === k); return e ? (e.t - ended!.t).toFixed(0) : 'n/a'; };
      const lastF = fr.filter((x) => x.visible && x.chapter === ids[i]).at(-1);
      const lastTu = ev.filter((e) => e.chapter === ids[i]).at(-1);
      const firstTu = ev.find((e) => e.chapter === ids[i + 1]);
      console.log(
        `JOIN ${i + 1}: ended->first-frame ${ms.toFixed(0)} ms; incoming events after ended: play ${at('play')} playing ${at('playing')} canplay ${at('canplay')}; ` +
          `last-frame->first-frame ${(firstF!.shown - lastF!.shown).toFixed(0)} ms; timeupdate gap ${(firstTu!.t - lastTu!.t).toFixed(0)} ms`,
      );
    }
    console.log(`JOIN_ENDED_TO_FRAME_MS ${endedToFrame.map((g) => g.toFixed(0)).join(' ')}`);
    for (const g of endedToFrame) expect(g).toBeLessThanOrEqual(JOIN_GAP_MS);
  });

  await test.step('after the play-through: every chapter played [0, duration - 0.1], no error event, visible element not muted', async () => {
    // Wait for the end of the last chapter, then read the `played` ranges the elements reported, merged per chapter.
    await expect.poll(async () => (await events(page)).some((e) => e.kind === 'ended' && e.chapter === 'three-end'), { timeout: 8000 }).toBe(true);
    const all = await events(page);
    for (const id of ['one-intro', 'two-middle', 'three-end']) {
      const ranges = all.filter((e) => e.chapter === id).flatMap((e) => e.played).sort((a, b) => a[0] - b[0]);
      const merged: [number, number][] = [];
      for (const r of ranges) {
        const last = merged.at(-1);
        if (last && r[0] <= last[1] + 0.05) last[1] = Math.max(last[1], r[1]);
        else merged.push([r[0], r[1]]);
      }
      expect(merged.length, `${id} played ranges ${JSON.stringify(merged)}`).toBeGreaterThan(0);
      expect(merged[0][0], `${id} starts at 0`).toBeLessThanOrEqual(0.1);
      expect(merged[0][1], `${id} played to the end`).toBeGreaterThanOrEqual(SECONDS - 0.1);
      expect(merged.length, `${id} played in one piece: ${JSON.stringify(merged)}`).toBe(1);
    }
    expect(all.filter((e) => e.kind === 'error')).toEqual([]);
    const muted = await page.evaluate(() =>
      [...document.querySelectorAll('video')].filter((v) => getComputedStyle(v).visibility !== 'hidden').map((v) => v.muted),
    );
    expect(muted).toEqual([false]);
    const errs = await page.evaluate(() => [...document.querySelectorAll('video')].map((v) => v.error?.code ?? null));
    expect(errs).toEqual([null, null]);
  });

  await test.step('the caption cue shows during chapter one', async () => {
    await page.getByRole('group', { name: 'Chapters' }).getByRole('button').nth(0).click();
    await expect(page.getByText('One intro caption line.')).toBeVisible();
  });

  await test.step('a seek into another chapter lands at the right offset', async () => {
    const pause = page.getByRole('button', { name: 'Pause', exact: true });
    if (await pause.count()) await pause.click(); // after the play-through the player may already be stopped
    await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
    await page.getByRole('group', { name: 'Chapters' }).getByRole('button').nth(0).click({ position: { x: 1, y: 10 } });
    await expect(clock(page)).toHaveText(/^0:00 \//);
    await page.locator('body').click({ position: { x: 2, y: 2 } }); // focus off the block so the keys reach the page
    await page.keyboard.press('ArrowRight'); // +5 s: chapter two, 2 s in
    await expect(page.getByRole('heading', { level: 2 }).first()).toHaveText('Two middle');
    await expect(clock(page)).toHaveText(/^0:05 \//);
    const seen = await page.evaluate(() => {
      const v = [...document.querySelectorAll('video')].find((el) => getComputedStyle(el).visibility !== 'hidden')!;
      return { src: v.currentSrc, ct: v.currentTime };
    });
    expect(seen.src).toContain('/chapters/two-middle/video');
    expect(seen.ct).toBeGreaterThan(1.7);
    expect(seen.ct).toBeLessThan(2.4);
  });

  await test.step('clicking the third block shows its title and time of at least 6.0', async () => {
    await page.getByRole('group', { name: 'Chapters' }).getByRole('button', { name: /^Three end/ }).click();
    await expect(page.getByRole('heading', { level: 2 }).first()).toHaveText('Three end');
    await expect(clock(page)).toHaveText(/^0:0[6-9] \//);
  });

  await test.step('a question appears as a bubble and survives a reload', async () => {
    await page.getByRole('textbox', { name: 'Your question' }).fill('What does start() do?');
    await page.keyboard.press('Enter');
    await expect(page.locator('[data-role="viewer"]').getByText('What does start() do?')).toBeVisible();
    await page.reload();
    await expect(page.locator('[data-role="viewer"]').getByText('What does start() do?')).toBeVisible();
  });

  await test.step('Escape closes the export dialog', async () => {
    await page.getByRole('button', { name: 'Export', exact: true }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toBeHidden();
  });

  await test.step('exports drafts to a folder and the files exist', async () => {
    await page.getByRole('button', { name: 'Export', exact: true }).first().click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('textbox').fill(exportDir);
    await dialog.getByRole('button', { name: 'Export', exact: true }).click();
    await dialog.getByRole('button', { name: 'Export drafts' }).click();
    const items = dialog.locator('ul').first().getByRole('listitem'); // the Saved list; "Left out" is the second
    await expect(dialog.getByText('four-rendering')).toBeVisible();
    await expect(items).toHaveCount(3);
    const names = await items.allTextContents();
    expect(names.length).toBe(3);
    for (const n of names) expect(existsSync(join(exportDir, n)), `${n} exists in ${exportDir}`).toBe(true);
    expect(readdirSync(exportDir).sort()).toEqual([...names].sort());
    await page.keyboard.press('Escape');
  });

  await test.step('no console message and no CSP violation during the whole run', async () => {
    const csp = await page.evaluate(() => (window as unknown as { __csp: string[] }).__csp);
    expect(csp).toEqual([]);
    // The one expected message: Chromium logs the 409 the server answers to a full export while chapters are drafts.
    const is409 = (m: string) => m === 'console.error: Failed to load resource: the server responded with a status of 409 (Conflict)';
    expect(problems.filter(is409)).toHaveLength(1);
    expect(problems.filter((m) => !is409(m))).toEqual([]);
  });

  await test.step('stopping the server shows the stopped notice within 60 s', async () => {
    // Console noise from the dead connection is expected from here on.
    page.removeAllListeners('console');
    await fixture.stop();
    await expect(page.getByText("Yap's server stopped.")).toBeVisible({ timeout: 60_000 });
  });
});
