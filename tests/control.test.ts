import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { afterAll, beforeAll, expect, it } from 'vitest';
import WebSocket from 'ws';
import type { ServerMessage } from '../src/core/types';

let server: ChildProcess, port: number;
const clients: WebSocket[] = [];
beforeAll(async () => {
  const reservation = createServer(); reservation.listen(0, '127.0.0.1');
  await once(reservation, 'listening');
  port = (reservation.address() as { port: number }).port;
  await new Promise<void>(resolve => reservation.close(() => resolve()));
  server = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
    cwd: process.cwd(), env: { ...process.env, MODE: 'demo', PORT: String(port) }, stdio: 'ignore',
  });
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    try { if ((await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(500) })).ok) return; }
    catch { /* Wait for this isolated server, never the user's demo. */ }
    if (server.exitCode !== null) throw new Error('Isolated control server exited before startup.');
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Isolated control server did not start.');
}, 25000);

afterAll(async () => {
  for (const ws of clients) ws.terminate();
  if (server && server.exitCode === null) {
    const exited = once(server, 'exit'); server.kill('SIGTERM');
    const force = setTimeout(() => server.kill('SIGKILL'), 3000);
    await exited; clearTimeout(force);
  }
});

function connect() {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?role=controller`, { origin: `http://127.0.0.1:${port}` });
  clients.push(ws);
  const queue: ServerMessage[] = [];
  let pending: (() => void) | undefined;
  ws.on('message', raw => { queue.push(JSON.parse(raw.toString())); pending?.(); });
  async function next<T extends ServerMessage['type']>(type: T, matches = (_: Extract<ServerMessage, { type: T }>) => true) {
    return new Promise<Extract<ServerMessage, { type: T }>>((resolve, reject) => {
      const timer = setTimeout(() => { pending = undefined; reject(new Error(`No ${type} response`)); }, 4000);
      pending = () => {
        const index = queue.findIndex(message => message.type === type && matches(message as Extract<ServerMessage, { type: T }>));
        if (index < 0) return;
        const message = queue.splice(0, index + 1).at(-1)!;
        clearTimeout(timer); pending = undefined; resolve(message as Extract<ServerMessage, { type: T }>);
      };
      pending();
    });
  }
  return { ws, next, send: (message: object) => ws.send(JSON.stringify(message)) };
}

it('hands off an idle controller, protects playing and paused tracks, and releases a closed owner', async () => {
  const first = connect(); expect((await first.next('role')).controller).toBe(true);
  const second = connect(); expect((await second.next('role')).controller).toBe(false);
  second.send({ type: 'take-control' });
  expect((await second.next('role')).controller).toBe(true);
  expect((await first.next('role')).controller).toBe(false);

  const details = { kind: 'file', preset: 'original', paused: false, muted: false };
  second.send({ type: 'audio', active: true, source: 'Reference.wav', details });
  await first.next('state', message => message.state.audioActive);
  first.send({ type: 'take-control' });
  expect((await first.next('error')).message).toContain('playing or paused');

  second.send({ type: 'audio', active: false, source: 'Reference.wav', details: { ...details, paused: true } });
  await first.next('state', message => !message.state.audioActive && message.state.audioDetails.paused);
  first.send({ type: 'take-control' });
  expect((await first.next('error')).message).toContain('playing or paused');

  const closed = once(second.ws, 'close'); second.ws.close(); await closed;
  await first.next('state', message => message.state.audioSource === 'No audio selected' && !message.state.audioDetails.paused);
  first.send({ type: 'take-control' });
  expect((await first.next('role')).controller).toBe(true);
}, 20000);
