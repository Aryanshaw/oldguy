'use strict';
// Smoke check: adds, lists and completes todos through the HTTP server, using a throwaway data file.
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const http = require('node:http');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'todo-smoke-'));
process.env.TODO_FILE = path.join(dir, 'todos.json');
const { handle } = require('./server');

// Sends one request to the running server and returns { status, body }.
function call(port, method, url, body) {
  return new Promise((resolve, reject) => {
    const req = http.request({ port, method, path: url, headers: { 'Content-Type': 'application/json' } }, (res) => {
      let raw = '';
      res.on('data', (c) => { raw += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(raw) }));
    });
    req.on('error', reject);
    req.end(body ? JSON.stringify(body) : undefined);
  });
}

// Runs the add, list, complete round trip and checks the saved file.
async function main() {
  const server = http.createServer(handle).listen(0);
  const { port } = server.address();
  try {
    const added = await call(port, 'POST', '/todos', { title: 'buy milk' });
    assert.equal(added.status, 201);
    assert.deepEqual([added.body.id, added.body.title, added.body.done], [1, 'buy milk', false]);
    assert.equal((await call(port, 'POST', '/todos', { title: '  ' })).status, 400);
    assert.equal((await call(port, 'GET', '/todos')).body.length, 1);
    assert.equal((await call(port, 'POST', '/todos/1/done')).body.done, true);
    assert.equal(JSON.parse(fs.readFileSync(process.env.TODO_FILE, 'utf8'))[0].done, true);
    console.log('todo-app smoke: ok');
  } finally {
    server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
