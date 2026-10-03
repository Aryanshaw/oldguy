import { createRequire } from 'node:module';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

const require = createRequire(import.meta.url);
const { startFixture } = require('./make-fixture.cjs') as typeof import('./make-fixture.cjs');

type Fixture = Awaited<ReturnType<typeof startFixture>>;
interface VideoEvt { kind: string; chapter: string; t: number; ct: number }
interface FrameEvt { chapter: string; shown: number; visible: boolean }

const JOIN_GAP_MS = 250;

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
    for (const kind of ['timeupdate', 'error']) {
      document.addEventListener(
        kind,
        (e) => {
          if (e.target instanceof HTMLVideoElement) {
            w.__v.push({ kind, chapter: chapterOf(e.target), t: performance.now(), ct: e.target.currentTime });
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

  await test.step('plays across two joins with a gap under 250 ms', async () => {
    await page.getByRole('button', { name: 'Play video' }).click();
    await expect
      .poll(async () => (await events(page)).some((e) => e.kind === 'timeupdate' && e.chapter === 'three-end' && e.ct > 0.5), {
        timeout: 12_000,
        intervals: [100],
      })
      .toBe(true);
    const ev = (await events(page)).filter((e) => e.kind === 'timeupdate');
    const ids = ['one-intro', 'two-middle', 'three-end'];
    // The brief's measure: last timeupdate of one chapter to the first of the next. Chromium fires timeupdate about
    // every 250 ms, so a seamless join already reads about 250 here; the cadence is logged beside it.
    const within = ev.filter((e, i) => i > 0 && ev[i - 1].chapter === e.chapter).map((e, i, a) => e.t - ev[ev.indexOf(e) - 1].t);
    const cadence = within.sort((a, b) => a - b)[Math.floor(within.length / 2)];
    const tuGaps: number[] = [];
    // The precise measure: last painted frame of one chapter to the first painted frame of the next.
    const fr = await frames(page);
    const frGaps: number[] = [];
    for (let i = 0; i < 2; i++) {
      const last = ev.filter((e) => e.chapter === ids[i]).at(-1);
      const first = ev.find((e) => e.chapter === ids[i + 1]);
      expect(last, `a timeupdate of ${ids[i]}`).toBeTruthy();
      expect(first, `a timeupdate of ${ids[i + 1]}`).toBeTruthy();
      tuGaps.push(first!.t - last!.t);
      const lastF = fr.filter((x) => x.visible && x.chapter === ids[i]).at(-1);
      const firstF = fr.find((x) => x.visible && x.chapter === ids[i + 1]);
      expect(lastF, `a painted frame of ${ids[i]}`).toBeTruthy();
      expect(firstF, `a painted frame of ${ids[i + 1]}`).toBeTruthy();
      frGaps.push(firstF!.shown - lastF!.shown);
    }
    console.log(`JOIN_TIMEUPDATE_GAPS_MS ${tuGaps.map((g) => g.toFixed(0)).join(' ')} (timeupdate cadence ${cadence.toFixed(0)})`);
    console.log(`JOIN_FRAME_GAPS_MS ${frGaps.map((g) => g.toFixed(0)).join(' ')}`);
    for (const g of frGaps) expect(g).toBeLessThan(JOIN_GAP_MS);
    // the timeupdate gap may not exceed the cadence by more than the brief's 250 ms
    for (const g of tuGaps) expect(g - cadence).toBeLessThan(JOIN_GAP_MS);
    await expect(clock(page)).toHaveText(/^0:0[6-9] \/ 0:09$/);
  });

  await test.step('captions show during chapter one, audio is not muted, no video error', async () => {
    // seek back to the start of chapter one and look for its cue
    await page.getByRole('group', { name: 'Chapters' }).getByRole('button').nth(0).click();
    await expect(page.getByText('One intro caption line.')).toBeVisible();
    const muted = await page.evaluate(() =>
      [...document.querySelectorAll('video')].filter((v) => getComputedStyle(v).visibility !== 'hidden').map((v) => v.muted),
    );
    expect(muted.length).toBe(1);
    expect(muted).toEqual([false]);
    expect((await events(page)).filter((e) => e.kind === 'error')).toEqual([]);
    const errs = await page.evaluate(() => [...document.querySelectorAll('video')].map((v) => v.error?.code ?? null));
    expect(errs).toEqual([null, null]);
  });

  await test.step('a seek into another chapter lands at the right offset', async () => {
    await page.getByRole('button', { name: 'Pause', exact: true }).click();
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
