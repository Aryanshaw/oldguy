// The one way yap's own commands talk to the local server: plain http to 127.0.0.1 with the session key.
import http from 'node:http';

// What askServer takes: where the server is, the session key, and the request to make.
type AskOptions = {
  port: number;
  key: string;
  method?: string;
  path: string;
  body?: unknown;
  timeoutMs: number;
  maxBytes: number;
};

// What askServer always resolves with: the answer, or why there was none.
type AskResult =
  | { ok: true; status: number; body: string }
  | { ok: false; reason: 'refused' | 'timeout' | 'toobig' | 'error' };

// The fields of state/server.json that usableInfo has checked.
type ServerInfo = { pid: number; port: number; key: string };

// True when the value is a whole number (a type guard, so the range checks after it can compare it).
function isWholeNumber(value: unknown): value is number {
  return Number.isInteger(value);
}

// Reads state/server.json fields that are safe to use (a real pid, a port and a 32-hex key), or null when they are not.
function usableInfo(info: { pid?: unknown; port?: unknown; key?: unknown } | null | undefined): ServerInfo | null {
  if (!info || !isWholeNumber(info.pid) || info.pid <= 1) return null;
  if (!isWholeNumber(info.port) || info.port < 1 || info.port > 65535) return null;
  if (typeof info.key !== 'string' || !/^[0-9a-f]{32}$/.test(info.key)) return null;
  // pid, port and key were all just checked; the same object is returned, as before
  return info as ServerInfo;
}

// True when a process with this pid exists (permission denied still means it exists).
function pidAlive(pid: number): boolean {
  // process.kill only throws system errors, which carry a code
  try { process.kill(pid, 0); return true; } catch (err) { return (err as NodeJS.ErrnoException).code === 'EPERM'; }
}

// Sends one request and always resolves, never rejects: { ok: true, status, body } with the body as text, or
// { ok: false, reason } where reason is 'refused' (nothing listens), 'timeout' (the one deadline for the whole
// request ran out, however slowly bytes arrive), 'toobig' (the answer passed maxBytes) or 'error'.
function askServer({ port, key, method = 'GET', path, body, timeoutMs, maxBytes }: AskOptions): Promise<AskResult> {
  return new Promise((resolve) => {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const headers: Record<string, string | number> = { host: `127.0.0.1:${port}`, 'x-yap-key': key };
    if (payload !== undefined) { headers['content-type'] = 'application/json'; headers['content-length'] = Buffer.byteLength(payload); }
    let req: http.ClientRequest | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let done = false;
    // Answers once, stops the timer and drops the connection.
    const finish = (result: AskResult) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (req) req.destroy();
      resolve(result);
    };
    // One timer for the whole request: it is never reset by arriving bytes.
    timer = setTimeout(() => finish({ ok: false, reason: 'timeout' }), timeoutMs);
    req = http.request({ host: '127.0.0.1', port, method, path, agent: false, headers }, (res) => {
      const chunks: Buffer[] = [];
      let size = 0;
      res.on('data', (c: Buffer) => {
        size += c.length;
        if (size > maxBytes) return finish({ ok: false, reason: 'toobig' });
        chunks.push(c);
      });
      res.on('end', () => finish({ ok: true, status: res.statusCode as number, body: Buffer.concat(chunks).toString('utf8') }));
      res.on('error', () => finish({ ok: false, reason: 'error' }));
      res.on('aborted', () => finish({ ok: false, reason: 'error' }));
    });
    // a failed connection carries a system error code
    req.on('error', (err) => finish({ ok: false, reason: (err as NodeJS.ErrnoException).code === 'ECONNREFUSED' ? 'refused' : 'error' }));
    req.end(payload);
  });
}

export { askServer, pidAlive, usableInfo };
export type { AskOptions, AskResult, ServerInfo };
