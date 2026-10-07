const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { main, parseArgs, nodeOk, dataDir, chooseItems } = require('../packages/oldguy/lib.cjs');

const HOME = '/home/u';
const INSTALL = '/home/u/.claude/plugins/cache/oldguy/oldguy/0.1.0';
const OLDGUY = path.join(INSTALL, 'bin', 'oldguy.cjs');
const DATA = '/home/u/.claude/plugins/data/oldguy-oldguy';
const OK = { code: 0, stdout: '', stderr: '' };
const PLAN = {
  items: [
    { id: 'voice', what: 'Voice: a Python venv', size: 'about 130 MB', steps: [] },
    { id: 'chrome', what: 'Chrome for rendering', size: 'one headless Chrome download', steps: [] },
  ],
  manual: [],
};

// A pretend machine: claude is installed, the marketplace and plugin are absent unless `over` says so.
function machine(over = {}) {
  const calls = [];
  const live = [];
  const out = [];
  let installed = over.installed || false;
  const deps = {
    argv: over.argv || [],
    env: over.env || {},
    home: HOME,
    nodeVersion: over.nodeVersion || 'v22.18.0',
    isTTY: over.isTTY ?? false,
    ask: over.ask || (async () => ''),
    log: (s) => out.push(s),
    warn: (s) => out.push(`WARN ${s}`),
    runLive: async (cmd, args) => { live.push([cmd, ...args].join(' ')); return over.installCode ?? 0; },
    run: async (cmd, args) => {
      const line = [cmd, ...args].join(' ');
      calls.push(line);
      if (cmd === 'claude' && args[0] === '--version') return over.noClaude ? { code: -1, stderr: 'ENOENT' } : OK;
      if (line === 'claude plugin marketplace list --json') return { code: 0, stdout: JSON.stringify(over.market ? [{ name: 'oldguy' }] : []) };
      if (line === 'claude plugin list --json') return { code: 0, stdout: JSON.stringify(installed ? [{ id: 'oldguy@oldguy', version: '0.1.0', installPath: INSTALL }] : []) };
      if (line === 'claude plugin install oldguy@oldguy' || line === 'claude plugin update oldguy@oldguy') { installed = true; return OK; }
      if (cmd === 'claude') return OK;
      if (args[0] === OLDGUY && args[1] === 'setup') return { code: 0, stdout: JSON.stringify(over.plan || PLAN) };
      return { code: 127, stderr: 'not found' };
    },
  };
  return { deps, calls, live, out };
}

test('parseArgs and nodeOk', () => {
  assert.deepEqual(parseArgs(['--yes', '--plugin-only']), { yes: true, pluginOnly: true, help: false });
  assert.throws(() => parseArgs(['--force']), /unknown option --force/);
  assert.equal(nodeOk('v22.18.0'), true);
  assert.equal(nodeOk('v24.1.0'), true);
  assert.equal(nodeOk('v22.17.9'), false);
  assert.equal(nodeOk('v20.11.0'), false);
});

test('the data folder follows CLAUDE_CONFIG_DIR, else ~/.claude', () => {
  assert.equal(dataDir({}, HOME), DATA);
  assert.equal(dataDir({ CLAUDE_CONFIG_DIR: '/cfg' }, HOME), '/cfg/plugins/data/oldguy-oldguy');
  assert.equal(dataDir({ CLAUDE_CONFIG_DIR: 'relative' }, HOME), DATA);
});

test('an old Node or a missing claude stops before anything runs', async () => {
  const old = machine({ nodeVersion: 'v20.0.0' });
  assert.equal(await main(old.deps), 1);
  assert.deepEqual(old.calls, []);
  assert.match(old.out.join('\n'), /needs Node 22.18 or newer/);
  const none = machine({ noClaude: true });
  assert.equal(await main(none.deps), 1);
  assert.deepEqual(none.calls, ['claude --version']);
  assert.match(none.out.join('\n'), /Claude Code is not installed/);
});

test('first run: adds the marketplace from GitHub and installs the plugin', async () => {
  const m = machine({ argv: ['--plugin-only'] });
  assert.equal(await main(m.deps), 0);
  assert.ok(m.calls.includes('claude plugin marketplace add Aryanshaw/oldguy'));
  assert.ok(m.calls.includes('claude plugin install oldguy@oldguy'));
  assert.ok(!m.calls.some((c) => c.includes('update')));
  assert.deepEqual(m.live, []);
});

test('second run: refreshes the marketplace and updates the plugin instead', async () => {
  const m = machine({ argv: ['--plugin-only'], market: true, installed: true });
  assert.equal(await main(m.deps), 0);
  assert.ok(m.calls.includes('claude plugin marketplace update oldguy'));
  assert.ok(m.calls.includes('claude plugin update oldguy@oldguy'));
  assert.ok(!m.calls.some((c) => c.includes(' add ') || c.endsWith('install oldguy@oldguy')));
});

test('setup runs from the installed plugin with its data folder; --yes installs every offered item', async () => {
  const m = machine({ argv: ['--yes'] });
  assert.equal(await main(m.deps), 0);
  assert.ok(m.calls.includes(`${process.execPath} ${OLDGUY} setup --json --data-dir ${DATA}`));
  assert.deepEqual(m.live, [`${process.execPath} ${OLDGUY} setup --install voice,chrome --data-dir ${DATA}`]);
});

test('no terminal and no --yes: shows the list and installs nothing', async () => {
  const m = machine();
  assert.equal(await main(m.deps), 0);
  assert.deepEqual(m.live, []);
  assert.match(m.out.join('\n'), /not an interactive terminal, so nothing was set up/);
});

test('in a terminal only the ticked items are installed; q installs nothing', async () => {
  const answers = ['1', ''];
  const m = machine({ isTTY: true, ask: async () => answers.shift() });
  assert.equal(await main(m.deps), 0);
  assert.deepEqual(m.live, [`${process.execPath} ${OLDGUY} setup --install chrome --data-dir ${DATA}`]);
  const q = machine({ isTTY: true, ask: async () => 'q' });
  assert.equal(await main(q.deps), 0);
  assert.deepEqual(q.live, []);
});

test('chooseItems ignores answers that are not item numbers', async () => {
  const answers = ['9', 'x', '2', ''];
  assert.deepEqual(await chooseItems(PLAN, async () => answers.shift(), () => {}), ['voice']);
});

test('a machine with nothing missing says so and runs no install', async () => {
  const m = machine({ argv: ['--yes'], plan: { items: [], manual: [] } });
  assert.equal(await main(m.deps), 0);
  assert.deepEqual(m.live, []);
  assert.match(m.out.join('\n'), /Everything oldguy needs is set up/);
});

test('nothing left but optional manual items: success; a required manual item: exit 1', async () => {
  const optional = machine({ argv: ['--yes'], plan: { items: [], manual: [{ name: 'whisper-cli', why: 'not on PATH', fix: 'build it', required: false }] } });
  assert.equal(await main(optional.deps), 0);
  assert.match(optional.out.join('\n'), /whisper-cli \(optional\)/);
  assert.match(optional.out.join('\n'), /Everything oldguy needs is set up/);
  const required = machine({ argv: ['--yes'], plan: { items: [], manual: [{ name: 'ffmpeg', why: 'does not run', fix: 'install ffmpeg', required: true }] } });
  assert.equal(await main(required.deps), 1);
  assert.match(required.out.join('\n'), /needs the fixes above/);
});

test('a failed install step or a failed plugin install is reported with exit 1', async () => {
  const m = machine({ argv: ['--yes'], installCode: 1 });
  assert.equal(await main(m.deps), 1);
  const broken = machine();
  const run = broken.deps.run;
  broken.deps.run = async (cmd, args) => (args[0] === 'plugin' && args[1] === 'install' ? { code: 1, stderr: 'network down' } : run(cmd, args));
  assert.equal(await main(broken.deps), 1);
  assert.match(broken.out.join('\n'), /claude plugin install failed: network down/);
});
