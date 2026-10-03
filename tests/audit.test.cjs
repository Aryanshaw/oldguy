const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { audit } = require('../lib/audit.mts');

const CLI = path.join(__dirname, '..', 'bin', 'yap.cjs');
const FILE_TEXT = 'alpha one\nbeta two\ngamma three\ndelta four\nepsilon five\n';

// Makes a temp "repo" holding src/a.txt and an empty sibling folder for outside files; cleans up after fn.
function withRepo(fn) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'yap-audit-'));
  const root = path.join(base, 'repo');
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src', 'a.txt'), FILE_TEXT);
  try {
    return fn({ base, root });
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
}

// Builds one source entry with sensible defaults that tests override.
function src(over = {}) {
  return { id: 's1', file: 'src/a.txt', lines: [1, 1], quote: 'alpha one', ...over };
}

// Audits a single source (and one claim citing it) and returns the result.
function auditSource(root, source) {
  return audit({ root, sources: [source], sentences: [{ text: 'x', kind: 'claim', source_ids: [source.id] }] });
}

test('passes a real quote on the stated lines', () => {
  withRepo(({ root }) => {
    const r = auditSource(root, src({ lines: [2, 3], quote: 'beta two\ngamma three' }));
    assert.deepEqual(r, { ok: true, failures: [] });
  });
});

test('rejects a quote that exists in the file but outside the stated lines', () => {
  withRepo(({ root }) => {
    const r = auditSource(root, src({ lines: [3, 4], quote: 'alpha one' }));
    assert.equal(r.ok, false);
    assert.deepEqual(r.failures, [{ id: 's1', reason: 'quote not on lines 3-4' }]);
  });
});

test('accepts CRLF and tab differences', () => {
  withRepo(({ root }) => {
    fs.writeFileSync(path.join(root, 'src', 'w.txt'), 'if (x) {\r\n\treturn   1;\r\n}\r\n');
    const r = auditSource(root, src({ file: 'src/w.txt', lines: [1, 2], quote: 'if (x) {\n  return 1;' }));
    assert.equal(r.ok, true);
  });
});

test('rejects a missing file', () => {
  withRepo(({ root }) => {
    const r = auditSource(root, src({ file: 'src/nope.txt' }));
    assert.equal(r.failures[0].id, 's1');
    assert.match(r.failures[0].reason, /file not found/);
  });
});

test('rejects start > end', () => {
  withRepo(({ root }) => {
    const r = auditSource(root, src({ lines: [4, 2] }));
    assert.match(r.failures[0].reason, /invalid line range 4-2/);
  });
});

test('rejects a line past the end of the file', () => {
  withRepo(({ root }) => {
    const r = auditSource(root, src({ lines: [4, 9], quote: 'delta four' }));
    assert.match(r.failures[0].reason, /lines 4-9 past end of file \(5 lines\)/);
    const zero = auditSource(root, src({ lines: [0, 1] }));
    assert.match(zero.failures[0].reason, /invalid line range 0-1/);
  });
});

test('rejects ../../outside paths and a symlink that points outside root', () => {
  withRepo(({ base, root }) => {
    fs.writeFileSync(path.join(base, 'secret.txt'), 'top secret\n');
    const up = auditSource(root, src({ file: '../secret.txt', quote: 'top secret' }));
    assert.match(up.failures[0].reason, /outside root/);

    fs.symlinkSync(path.join(base, 'secret.txt'), path.join(root, 'src', 'link.txt'));
    const link = auditSource(root, src({ file: 'src/link.txt', quote: 'top secret' }));
    assert.match(link.failures[0].reason, /outside root/);

    const abs = auditSource(root, src({ file: path.join(base, 'secret.txt'), quote: 'top secret' }));
    assert.match(abs.failures[0].reason, /outside root/);
  });
});

test('rejects a claim sentence with no source ids', () => {
  withRepo(({ root }) => {
    const r = audit({ root, sources: [src()], sentences: [{ text: 'a', kind: 'claim', source_ids: [] }] });
    assert.deepEqual(r.failures, [{ id: 'sentence 0', reason: 'claim has no source ids' }]);
  });
});

test('rejects an unknown source id', () => {
  withRepo(({ root }) => {
    const r = audit({ root, sources: [src()], sentences: [{ text: 'a', kind: 'claim', source_ids: ['s1', 'ghost'] }] });
    assert.deepEqual(r.failures, [{ id: 'sentence 0', reason: 'unknown source id ghost' }]);
  });
});

test('allows framing without sources', () => {
  withRepo(({ root }) => {
    const r = audit({ root, sources: [], sentences: [{ text: 'hello', kind: 'framing', source_ids: [] }] });
    assert.deepEqual(r, { ok: true, failures: [] });
  });
});

// Audits one sentence with no sources at all and returns the failure reasons.
function reasonsFor(root, sentence) {
  return audit({ root, sources: [], sentences: [sentence] }).failures.map((f) => `${f.id}: ${f.reason}`);
}

test('a sentence with no kind is treated as a claim and fails without sources', () => {
  withRepo(({ root }) => {
    const r = reasonsFor(root, { text: 'a', source_ids: [] });
    assert.ok(r.includes('sentence 0: claim has no source ids'), r.join('|'));
    assert.ok(r.includes('sentence 0: unknown kind "undefined"'), r.join('|'));
  });
});

test('kind "Claim" with no sources fails, and the odd kind is named', () => {
  withRepo(({ root }) => {
    const r = reasonsFor(root, { text: 'a', kind: 'Claim', source_ids: [] });
    assert.deepEqual(r, ['sentence 0: claim has no source ids', 'sentence 0: unknown kind "Claim"']);
  });
});

test('kind "framing" still passes with no sources', () => {
  withRepo(({ root }) => {
    assert.deepEqual(reasonsFor(root, { text: 'a', kind: 'framing', source_ids: [] }), []);
  });
});

test('kind "Framing" is not case-folded: it fails as unknown kind', () => {
  withRepo(({ root }) => {
    const r = reasonsFor(root, { text: 'a', kind: 'Framing', source_ids: [] });
    assert.ok(r.includes('sentence 0: unknown kind "Framing"'), r.join('|'));
    assert.ok(r.includes('sentence 0: claim has no source ids'), r.join('|'));
  });
});

test('a non-string kind (number) fails as a claim with an unknown-kind line', () => {
  withRepo(({ root }) => {
    const r = reasonsFor(root, { text: 'a', kind: 7, source_ids: [] });
    assert.ok(r.includes('sentence 0: unknown kind "7"'), r.join('|'));
  });
});

test('rejects an empty quote', () => {
  withRepo(({ root }) => {
    for (const quote of ['', '   \n\t ']) {
      const r = auditSource(root, src({ quote }));
      assert.equal(r.failures[0].reason, 'empty quote');
    }
  });
});

test('reports every failure, not just the first', () => {
  withRepo(({ root }) => {
    const r = audit({
      root,
      sources: [src({ id: 'a', quote: 'nothing like it' }), src({ id: 'b', file: 'src/nope.txt' })],
      sentences: [
        { text: '1', kind: 'claim', source_ids: [] },
        { text: '2', kind: 'claim', source_ids: ['zzz'] },
      ],
    });
    assert.deepEqual(r.failures.map((f) => f.id), ['a', 'b', 'sentence 0', 'sentence 1']);
  });
});

test('binary or non-UTF-8 file is rejected with a clear reason, not a crash', () => {
  withRepo(({ root }) => {
    fs.writeFileSync(path.join(root, 'src', 'bad.bin'), Buffer.from([0x61, 0xff, 0xfe, 0x0a]));
    fs.writeFileSync(path.join(root, 'src', 'nul.bin'), Buffer.from('ab\0cd\n'));
    for (const file of ['src/bad.bin', 'src/nul.bin']) {
      const r = auditSource(root, src({ file, quote: 'a' }));
      assert.match(r.failures[0].reason, /not valid UTF-8 text/);
    }
  });
});

test('rejects a file over 2 MB without reading it', () => {
  withRepo(({ root }) => {
    fs.writeFileSync(path.join(root, 'src', 'big.txt'), Buffer.alloc(2 * 1024 * 1024 + 1, 0x61));
    const r = auditSource(root, src({ file: 'src/big.txt', quote: 'a' }));
    assert.match(r.failures[0].reason, /file too large/);
  });
});

test('rejects a directory as a source file', () => {
  withRepo(({ root }) => {
    const r = auditSource(root, src({ file: 'src' }));
    assert.match(r.failures[0].reason, /not a regular file/);
  });
});

// ---- CLI ----

// Runs `yap audit` on a chapter object written to a temp file and returns the process result.
function runCli(chapter, root, extraArgs = []) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yap-audit-cli-'));
  try {
    const file = path.join(dir, 'chapter.json');
    fs.writeFileSync(file, typeof chapter === 'string' ? chapter : JSON.stringify(chapter));
    return spawnSync('node', [CLI, 'audit', file, '--root', root, ...extraArgs], { encoding: 'utf8' });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('cli exits 0 and prints nothing on stdout when the chapter is clean', () => {
  withRepo(({ root }) => {
    const r = runCli({ id: 'c', title: 't', sources: [src()], sentences: [{ text: 'x', kind: 'claim', source_ids: ['s1'] }], scene: {} }, root);
    assert.equal(r.status, 0);
    assert.equal(r.stdout, '');
  });
});

test('cli exits 1 and prints one "id: reason" line per failure', () => {
  withRepo(({ root }) => {
    const r = runCli({ sources: [src({ quote: 'nope' })], sentences: [{ text: 'x', kind: 'claim', source_ids: [] }] }, root);
    assert.equal(r.status, 1);
    assert.deepEqual(r.stdout.trim().split('\n'), ['s1: quote not on lines 1-1', 'sentence 0: claim has no source ids']);
  });
});

test('cli exits 2 on unreadable or malformed chapter.json and on missing arguments', () => {
  withRepo(({ root }) => {
    const bad = runCli('{not json', root);
    assert.equal(bad.status, 2);
    assert.match(bad.stderr, /chapter/i);
    const missing = spawnSync('node', [CLI, 'audit', path.join(root, 'nope.json'), '--root', root], { encoding: 'utf8' });
    assert.equal(missing.status, 2);
    const noArgs = spawnSync('node', [CLI, 'audit'], { encoding: 'utf8' });
    assert.equal(noArgs.status, 2);
    assert.match(noArgs.stderr, /usage/i);
    const noShape = runCli({ title: 'no sources or sentences' }, root);
    assert.equal(noShape.status, 2);
  });
});
