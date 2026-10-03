// The shapes the server's files share: what a route handler is given, the state they all read, and the options for
// starting. Types only: nothing here runs, so no server file has to import another just to name a type.
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import type { Hub } from '../lib/sse.mts';
import type { Manifest, ManifestFs } from '../lib/manifest.mts';
import type { ProjectScan } from '../lib/chapter-scan.mts';
import type { Watcher } from '../lib/watcher.mts';
import type { JsonObject } from '../lib/http-guard.mts';
import type { ExecFn } from '../lib/export.mts';
import type { CreateReadStream } from '../lib/range.mts';

// Sends a JSON answer with a status.
type SendJson = (res: ServerResponse, status: number, body: unknown) => void;
// Reads a request's JSON body (the handler's copy already knows its response, so a 413/408 can be answered).
type ReadJsonBody = (req: IncomingMessage, opts?: { maxBytes?: number; timeoutMs?: number }) => Promise<JsonObject>;
// Everything a route handler is handed.
type RouteContext = {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  params: Record<string, string>;
  state: ServerState;
  sendJson: SendJson;
  readJsonBody: ReadJsonBody;
};
// One row of the route table: the method, a path pattern (a ":id" segment matches any one segment) and the handler.
type Route = { method: string; pattern: string; handler: (ctx: RouteContext) => unknown };
// The one queue every manifest change goes through: give it a change, get the saved manifest back. `idle()` resolves when every queued job is done.
type ManifestQueue = {
  (change: (loaded: Manifest) => Manifest | Promise<Manifest>): Promise<Manifest>;
  idle: () => Promise<unknown>;
};
// Things a test may replace (all optional): see startServer for what each one does.
type ServerDeps = {
  routes?: Route[];
  now?: () => number;
  pingMs?: number;
  fs?: ManifestFs;
  scan?: (slugDir: string) => ProjectScan;
  intervalMs?: number;
  setInterval?: typeof setInterval;
  clearInterval?: typeof clearInterval;
  setTimeout?: typeof setTimeout;
  clearTimeout?: typeof clearTimeout;
  exec?: ExecFn;
  ffmpeg?: string;
  posterWaitMs?: number;
  queueWaitMs?: number;
  beforeSave?: () => unknown;
  afterCheck?: () => unknown;
  createReadStream?: CreateReadStream;
  logError?: (err: unknown) => void;
  playerDir?: string;
};
// What every handler can read: where the video lives, the session key, the port, the live parts and the flags.
type ServerState = {
  slugDir: string;
  key: string;
  port: number;
  deps: ServerDeps;
  hub: Hub;
  lastHeartbeat: number | null;
  updateManifest: ManifestQueue;
  logError: (err: unknown) => void;
  closing?: boolean;
  exporting?: boolean;
  stopExport?: (() => Promise<void>) | null;
  heartbeatTimer?: ReturnType<typeof setTimeout> | null;
  posterIdle?: () => Promise<unknown>;
  watcher?: Watcher;
};
// What startServer needs.
type StartOptions = { slugDir: string; key?: string; port?: number; deps?: ServerDeps };
// What startServer hands back: how to reach the server, the live parts, and close().
type RunningServer = {
  url: string;
  key: string;
  port: number;
  address: string;
  family: string;
  server: Server;
  state: ServerState;
  close: () => Promise<void>;
};

export type { SendJson, ReadJsonBody, RouteContext, Route, ManifestQueue, ServerDeps, ServerState, StartOptions, RunningServer };
