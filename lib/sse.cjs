'use strict';
// Live updates to open browser tabs: a hub that keeps the open event streams (SSE) and sends each one the same events.

// Turns one event into the exact text sent on the wire. JSON.stringify never leaves a raw newline in the data.
function frame(event, data) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

// Makes a hub. pingMs is how often a "ping" goes to every client so a dead connection shows up.
function createHub({ pingMs = 15000 } = {}) {
  const clients = new Set();

  // Forgets a client (its socket closed or failed).
  function drop(res) {
    clients.delete(res);
  }

  // Sends one frame to one client; if the write fails the client is dropped, never thrown at the caller.
  function sendTo(res, event, data) {
    try {
      res.write(frame(event, data));
    } catch {
      drop(res);
    }
  }

  // Sends an event to every connected client.
  function broadcast(event, data) {
    for (const res of [...clients]) sendTo(res, event, data);
  }

  // The ping timer is unref()ed so an idle hub never keeps the process alive.
  const timer = setInterval(() => broadcast('ping', { now: Date.now() }), pingMs);
  timer.unref();

  // Starts a stream on a response: writes the SSE headers, tracks the client, and returns a sender for that client only.
  function add(res) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    clients.add(res);
    res.on('close', () => drop(res));
    res.on('error', () => drop(res));
    return (event, data) => sendTo(res, event, data);
  }

  // Stops the timer and ends every open stream so the server can shut down.
  function close() {
    clearInterval(timer);
    for (const res of [...clients]) {
      drop(res);
      try { res.end(); } catch { /* already gone */ }
    }
  }

  return { add, broadcast, size: () => clients.size, close };
}

module.exports = { createHub };
