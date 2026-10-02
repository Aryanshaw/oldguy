'use strict';
// A tiny HTTP server: POST /todos adds, GET /todos lists, POST /todos/<id>/done completes.
const http = require('node:http');
const { addTodo } = require('./add');
const { listTodos } = require('./list');
const { completeTodo } = require('./complete');

// Sends a JSON reply with a status code.
function reply(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

// Collects the request body and parses it as JSON.
function readJson(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => {
      try { resolve(raw ? JSON.parse(raw) : {}); } catch (err) { reject(err); }
    });
  });
}

// Routes each request to add, list or complete.
async function handle(req, res) {
  try {
    if (req.method === 'POST' && req.url === '/todos') {
      const body = await readJson(req);
      return reply(res, 201, addTodo(body.title));
    }
    if (req.method === 'GET' && req.url === '/todos') return reply(res, 200, listTodos());
    const done = req.url.match(/^\/todos\/(\d+)\/done$/);
    if (req.method === 'POST' && done) return reply(res, 200, completeTodo(done[1]));
    return reply(res, 404, { error: 'not found' });
  } catch (err) {
    return reply(res, 400, { error: err.message });
  }
}

// Starts listening when run directly: node server.js
if (require.main === module) {
  http.createServer(handle).listen(process.env.PORT || 3000);
}

module.exports = { handle };
