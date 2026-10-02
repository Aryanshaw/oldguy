// Decides how many chapter renders may run at once, and runs them with one safe retry.

// Turns free memory (GB) into how many renders to run together: keep 2 GB spare, at least 1, at most 3.
function renderCap(freeRamGb) {
  if (!Number.isFinite(freeRamGb) || freeRamGb < 0) return 1;
  return Math.max(1, Math.min(3, Math.floor(freeRamGb - 2)));
}

// Runs one render and never throws: a sync throw or a rejection both come back as { error }.
async function attempt(render, chapter) {
  try {
    await render(chapter);
    return {};
  } catch (err) {
    return { error: err && err.message ? err.message : String(err) };
  }
}

// Runs every job with at most `limit` in flight at once; each job's outcome lands in `out` at its own index.
async function runPool(jobs, limit, out) {
  let next = 0;
  // Each worker keeps taking the next waiting job until none are left.
  async function worker() {
    while (next < jobs.length) {
      const i = next++;
      out[i] = await jobs[i]();
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, jobs.length) }, worker));
}

// Renders all chapters at most `cap` at a time; a failed one is retried once, alone, after everything else has finished.
async function runRenders(chapters, { cap, render }) {
  const limit = Number.isFinite(cap) && cap >= 1 ? Math.floor(cap) : 1;
  const first = new Array(chapters.length);
  await runPool(chapters.map((c) => () => attempt(render, c)), limit, first);

  const results = chapters.map((c, i) => ({ id: c.id, status: 'ready', attempts: 1, ...first[i] }));
  // Retries go one at a time so a retry never competes with another render for memory.
  for (let i = 0; i < chapters.length; i++) {
    if (!first[i].error) continue;
    const second = await attempt(render, chapters[i]);
    results[i] = { id: chapters[i].id, status: second.error ? 'failed' : 'ready', attempts: 2, ...second };
  }
  return results.map((r) => (r.error === undefined ? { id: r.id, status: r.status, attempts: r.attempts } : r));
}

module.exports = { renderCap, runRenders };
