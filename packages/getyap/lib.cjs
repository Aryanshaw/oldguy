'use strict';
// getyap: installs the Yap plugin into Claude Code, then offers Yap's own setup checklist. Plain JavaScript on
// purpose: npx runs it from node_modules, where Node will not run Yap's TypeScript, and it must explain itself on
// an old Node. Every outside call (programs, prompts, printing) is passed in, so tests run nothing real.
const path = require('node:path');

const NODE_FLOOR = [22, 18, 0];
const MARKETPLACE = 'Aryanshaw/yap';
const PLUGIN = 'yap@yap';
const HELP = `npx getyap: install Yap (Claude yaps. You watch.) into Claude Code.

  npx getyap               install or update the plugin, then choose what to set up
  npx getyap --yes         also set up everything Yap offers, without asking
  npx getyap --plugin-only only install or update the plugin

Nothing is set up without your yes. More: https://github.com/Aryanshaw/yap
`;

// Reads the flags; anything else is a usage error.
function parseArgs(argv) {
  const opts = { yes: false, pluginOnly: false, help: false };
  for (const a of argv) {
    if (a === '--yes' || a === '-y') opts.yes = true;
    else if (a === '--plugin-only') opts.pluginOnly = true;
    else if (a === '--help' || a === '-h') opts.help = true;
    else throw new Error(`unknown option ${a}`);
  }
  return opts;
}

// True when the running Node is 22.18 or newer, the floor Yap needs.
function nodeOk(version) {
  const parts = String(version).replace(/^v/, '').split('.').map(Number);
  for (let i = 0; i < 3; i += 1) {
    if ((parts[i] || 0) !== NODE_FLOOR[i]) return (parts[i] || 0) > NODE_FLOOR[i];
  }
  return true;
}

// Claude Code's config folder: an absolute CLAUDE_CONFIG_DIR, else ~/.claude.
function configDir(env, home) {
  const c = env.CLAUDE_CONFIG_DIR;
  return typeof c === 'string' && path.isAbsolute(c) ? c : path.join(home, '.claude');
}

// Where Claude Code keeps Yap's data (its Python venv and the doctor's marker), named after plugin and marketplace.
function dataDir(env, home) {
  return path.join(configDir(env, home), 'plugins', 'data', 'yap-yap');
}

// Parses a program's JSON output; null when it is not JSON.
function json(text) {
  try { return JSON.parse(String(text || '')); } catch { return null; }
}

// Runs a program and throws with its own words when it fails.
async function must(run, cmd, args, what) {
  const r = await run(cmd, args);
  if (r.code !== 0) {
    const why = String(r.stderr || r.stdout || '').trim().split('\n').slice(-2).join(' ') || `exit code ${r.code}`;
    throw new Error(`${what} failed: ${why}`);
  }
  return r;
}

// Adds (or refreshes) the Yap marketplace and installs (or updates) the plugin; returns the installed folder.
async function installPlugin(run, log) {
  const markets = json((await run('claude', ['plugin', 'marketplace', 'list', '--json'])).stdout) || [];
  if (markets.some((m) => m && m.name === 'yap')) {
    log('Refreshing the Yap marketplace…');
    await must(run, 'claude', ['plugin', 'marketplace', 'update', 'yap'], 'claude plugin marketplace update');
  } else {
    log(`Adding the Yap marketplace (${MARKETPLACE})…`);
    await must(run, 'claude', ['plugin', 'marketplace', 'add', MARKETPLACE], 'claude plugin marketplace add');
  }
  const installed = (json((await run('claude', ['plugin', 'list', '--json'])).stdout) || []).some((p) => p && p.id === PLUGIN);
  log(installed ? 'Updating the Yap plugin…' : 'Installing the Yap plugin…');
  await must(run, 'claude', ['plugin', installed ? 'update' : 'install', PLUGIN], `claude plugin ${installed ? 'update' : 'install'}`);
  const entry = (json((await run('claude', ['plugin', 'list', '--json'])).stdout) || []).find((p) => p && p.id === PLUGIN);
  if (!entry || typeof entry.installPath !== 'string') throw new Error('the plugin installed, but Claude Code did not say where');
  return entry;
}

// The checklist as lines: each offered item with its tick, size and commands, then what has to be done by hand.
function checklistText(plan, ticked) {
  const lines = [];
  plan.items.forEach((item, i) => {
    lines.push(`  ${i + 1}. [${ticked[i] ? 'x' : ' '}] ${item.what} (${item.size})`);
    if (item.note) lines.push(`         ${item.note}`);
  });
  if (plan.manual.length) {
    lines.push('', 'You will have to do these yourself:');
    for (const m of plan.manual) lines.push(`  - ${m.name}${m.required === false ? ' (optional)' : ''}: ${m.why}`, `    fix: ${m.fix}`);
  }
  return lines.join('\n');
}

// Asks until the user presses Enter (install the ticked items) or q (skip); a number toggles that item.
async function chooseItems(plan, ask, log) {
  const ticked = plan.items.map(() => true);
  for (;;) {
    log(checklistText(plan, ticked));
    const answer = String(await ask('\nEnter installs the ticked items; type a number to toggle one, or q to skip: ')).trim().toLowerCase();
    if (answer === '') return plan.items.filter((_, i) => ticked[i]).map((item) => item.id);
    if (answer === 'q') return [];
    const n = Number(answer);
    if (Number.isInteger(n) && n >= 1 && n <= plan.items.length) ticked[n - 1] = !ticked[n - 1];
    log('');
  }
}

// The whole run; returns the exit code. deps: run, runLive, argv, env, home, nodeVersion, isTTY, ask, log, warn.
async function main(deps) {
  const { run, runLive, env, home, log, warn } = deps;
  let opts;
  try {
    opts = parseArgs(deps.argv);
  } catch (err) {
    warn(`getyap: ${err.message}\n\n${HELP}`);
    return 2;
  }
  if (opts.help) { log(HELP); return 0; }
  if (!nodeOk(deps.nodeVersion)) {
    warn(`getyap: Yap needs Node 22.18 or newer, and this is Node ${deps.nodeVersion}. Install a newer Node (https://nodejs.org) and run npx getyap again.`);
    return 1;
  }
  if ((await run('claude', ['--version'])).code !== 0) {
    warn('getyap: Claude Code is not installed (no `claude` command on PATH). Install it first: https://claude.com/claude-code');
    return 1;
  }
  let plugin;
  try {
    plugin = await installPlugin(run, log);
  } catch (err) {
    warn(`getyap: ${err.message}`);
    return 1;
  }
  log(`Yap ${plugin.version} is installed in Claude Code.`);
  const nextSteps = '\nNext: start a new Claude Code session in your project and ask, for example:\n  /yap how does checkout work\n';
  if (opts.pluginOnly) { log(nextSteps); return 0; }
  const yap = path.join(plugin.installPath, 'bin', 'yap.cjs');
  const data = dataDir(env, home);
  const planRun = await run(process.execPath, [yap, 'setup', '--json', '--data-dir', data]);
  const plan = json(planRun.stdout);
  if (planRun.code !== 0 || !plan || !Array.isArray(plan.items) || !Array.isArray(plan.manual)) {
    warn(`getyap: could not read Yap's setup list: ${String(planRun.stderr || '').trim() || 'no output'}`);
    return 1;
  }
  const blocking = plan.manual.filter((m) => m.required !== false);
  if (!plan.items.length) {
    if (plan.manual.length) log(`\n${checklistText(plan, [])}`);
    log(blocking.length ? '\nYap needs the fixes above before it can make videos.' : `\nEverything Yap needs is set up.${nextSteps}`);
    return blocking.length ? 1 : 0;
  }
  log('\nYap needs a few things on this machine. Nothing is set up without your yes.\n');
  let picked;
  if (opts.yes) {
    log(checklistText(plan, plan.items.map(() => true)));
    picked = plan.items.map((i) => i.id);
  } else if (deps.isTTY) {
    picked = await chooseItems(plan, deps.ask, log);
  } else {
    log(checklistText(plan, plan.items.map(() => false)));
    log('\nThis is not an interactive terminal, so nothing was set up. Run npx getyap in a terminal, or npx getyap --yes.');
    return 0;
  }
  if (!picked.length) {
    log(`\nNothing set up. Yap's doctor (/yap doctor) will offer it again when you need it.${nextSteps}`);
    return 0;
  }
  log('');
  const code = await runLive(process.execPath, [yap, 'setup', '--install', picked.join(','), '--data-dir', data]);
  if (code === 0) log(nextSteps);
  return code;
}

module.exports = { parseArgs, nodeOk, configDir, dataDir, installPlugin, checklistText, chooseItems, main, HELP };
