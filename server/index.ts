import 'dotenv/config';
import { createServer } from 'node:http';
import { createReadStream, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { WebSocketServer, WebSocket } from 'ws';
import { ReleaseSession, validMeter } from './session';
import { TwitchBridge } from './twitch';
import { COMMANDS, type AudioDetails, type ServerMessage } from '../src/core/types';

const root = fileURLToPath(new URL('../', import.meta.url));
const production = process.argv.includes('--production');
const port = Number(process.env.PORT || 5173);
const mode = process.env.MODE === 'twitch' ? 'twitch' : 'demo';
const session = new ReleaseSession(undefined, mode);
const server = createServer();
const sockets = new WebSocketServer({ noServer: true, maxPayload: 12000 });
let controller: WebSocket | null = null;
const send = (ws: WebSocket, message: ServerMessage) => { if (ws.readyState === WebSocket.OPEN && ws.bufferedAmount < 1000000) ws.send(JSON.stringify(message)); };
const snapshot = (ws: WebSocket) => send(ws, { type: 'state', state: session.state, now: Date.now() });

server.on('upgrade', (request, socket, head) => {
  const origin = request.headers.origin;
  const allowed = [`http://127.0.0.1:${port}`, `http://localhost:${port}`];
  if (!allowed.includes(origin ?? '') || !request.url?.startsWith('/ws?')) { socket.destroy(); return; }
  const role = new URL(request.url, `http://127.0.0.1:${port}`).searchParams.get('role');
  sockets.handleUpgrade(request, socket, head, ws => sockets.emit('connection', ws, role));
});

sockets.on('connection', (ws, role: string) => {
  ws.on('error', () => ws.close());
  const ownsAudio = role === 'controller' && !controller;
  if (ownsAudio) controller = ws;
  send(ws, { type: 'role', controller: ownsAudio }); snapshot(ws);
  let bucket = 0, bucketAt = Date.now();
  ws.on('message', raw => {
    if (Date.now() - bucketAt > 1000) { bucket = 0; bucketAt = Date.now(); }
    if (++bucket > 40) return;
    let message: Record<string, unknown>;
    try { message = JSON.parse(raw.toString()); } catch { return; }
    if (!message || typeof message !== 'object') return;
    if (message.type === 'get-state') { snapshot(ws); return; }
    if (role !== 'controller') return;
    if (message.type === 'take-control') {
      if (ws === controller) return;
      if (session.state.audioActive || session.state.audioDetails.paused) {
        send(ws, { type: 'error', message: 'The other control room is playing or paused with a track loaded. Close that tab before taking control.' });
        return;
      }
      if (controller) send(controller, { type: 'role', controller: false });
      controller = ws;
      send(ws, { type: 'role', controller: true });
      sockets.clients.forEach(snapshot);
      return;
    }
    if (ws !== controller) return;
    if (message.type === 'meters' && validMeter(message.meters)) session.meters(message.meters);
    else if (message.type === 'audio' && typeof message.active === 'boolean' && typeof message.source === 'string') {
      const details = message.details as AudioDetails | undefined;
      if (details !== undefined && (!details || typeof details !== 'object' || !['demo', 'file', 'input'].includes(details.kind) || !['original', 'hot'].includes(details.preset) || typeof details.paused !== 'boolean' || typeof details.muted !== 'boolean')) return;
      session.setAudio(message.active, message.source, details);
    }
    else if (message.type === 'command' && COMMANDS.includes(message.command as typeof COMMANDS[number])) {
      const error = session.command('you', 'local:you', message.command as string);
      if (error) send(ws, { type: 'error', message: error });
    } else if (message.type === 'demo-chat' && session.state.mode === 'demo' && typeof message.text === 'string' && message.text.length <= 350) {
      const text = message.text.trim();
      if (!text) return;
      session.log('you', text, 'chat');
      const error = session.command('you', 'local:you', text, false);
      if (error) send(ws, { type: 'error', message: error });
    } else if (message.type === 'demo-reward' && session.state.mode === 'demo') {
      const error = session.reward('you');
      if (error) send(ws, { type: 'error', message: error });
    } else if (message.type === 'reset') session.reset();
    if (message.type !== 'meters') sockets.clients.forEach(snapshot);
  });
  ws.on('close', () => { if (controller === ws) {
    controller = null;
    session.setAudio(false, '', { kind: 'demo', preset: 'original', paused: false, muted: true });
  } });
});

server.on('request', (request, response) => {
  if (request.url === '/api/health') {
    response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    response.end(JSON.stringify({ ok: true, mode, audioActive: session.state.audioActive }));
  }
});

let closeVite: (() => Promise<void>) | undefined;
if (!production) {
  const { createServer: createVite } = await import('vite');
  const vite = await createVite({ root, server: { middlewareMode: true }, appType: 'spa' });
  closeVite = () => vite.close();
  server.on('request', (req, res) => { if (!res.writableEnded) vite.middlewares(req, res); });
} else {
  if (!existsSync(path.join(root, 'dist/index.html'))) throw new Error('Run npm run build before npm start.');
  const mime: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.woff2': 'font/woff2' };
  server.on('request', (req, res) => {
    if (res.writableEnded) return;
    let pathname: string;
    try { pathname = decodeURIComponent(new URL(req.url ?? '/', `http://127.0.0.1:${port}`).pathname); }
    catch { res.writeHead(400); res.end(); return; }
    const relative = pathname === '/' || pathname === '/overlay' ? 'index.html' : pathname.slice(1);
    const absolute = path.resolve(root, 'dist', relative);
    if (!absolute.startsWith(path.join(root, 'dist') + path.sep) || !existsSync(absolute) || relative.endsWith('/')) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': mime[path.extname(absolute)] ?? 'application/octet-stream', 'Cache-Control': relative === 'index.html' ? 'no-store' : 'public, max-age=3600' });
    const stream = createReadStream(absolute); stream.on('error', () => res.destroy()); stream.pipe(res);
  });
}

const timer = setInterval(() => { session.tick(); sockets.clients.forEach(snapshot); }, 250);
let twitch: TwitchBridge | null = null;
if (mode === 'twitch') {
  twitch = new TwitchBridge({ clientId: process.env.TWITCH_CLIENT_ID ?? '', token: process.env.TWITCH_USER_ACCESS_TOKEN ?? '', rewardId: process.env.TWITCH_REWARD_ID, rewardTitle: process.env.TWITCH_REWARD_TITLE ?? 'Request a release check' }, session);
  void twitch.start();
}
server.listen(port, '127.0.0.1', () => console.log(`\n  Release Check Live\n  Control room: http://127.0.0.1:${port}\n  OBS overlay:  http://127.0.0.1:${port}/overlay\n  Mode: ${mode}\n`));
let shuttingDown = false;
async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true; clearInterval(timer); twitch?.stop();
  for (const ws of sockets.clients) ws.terminate();
  sockets.close(); await closeVite?.(); server.close();
}
process.once('SIGINT', () => { void shutdown(); });
process.once('SIGTERM', () => { void shutdown(); });
