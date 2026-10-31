import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ReleaseSession } from '../server/session';
import { goodFrame } from './helpers';

const { instances } = vi.hoisted(() => ({ instances: [] as unknown[] }));
vi.mock('ws', async () => {
  const { EventEmitter: Emitter } = await import('node:events');
  class Socket extends Emitter {
    closed = false;
    constructor(public url: string) { super(); instances.push(this); }
    close() { if (!this.closed) { this.closed = true; this.emit('close'); } }
    terminate() { this.close(); }
  }
  return { default: Socket };
});
import { TwitchBridge } from '../server/twitch';
type FakeSocket = EventEmitter & { closed: boolean; close(): void; url: string };
let id = 0;
const socket = (i = 0) => instances[i] as FakeSocket;
const event = (type: string, payload: unknown, subscription_type?: string, messageId = String(++id)) => Buffer.from(JSON.stringify({ metadata: { message_type: type, message_id: messageId, subscription_type }, payload }));
const welcome = (ws: FakeSocket, session = 'abc') => ws.emit('message', event('session_welcome', { session: { id: session, keepalive_timeout_seconds: 30 } }));

describe('Twitch EventSub adapter with local socket fixtures', () => {
  let session: ReleaseSession, bridge: TwitchBridge, fetcher: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    vi.useFakeTimers(); instances.length = 0;
    session = new ReleaseSession(() => Date.now(), 'twitch');
    session.setAudio(true, 'Test input'); session.meters(goodFrame({ measurementId: session.state.runId }));
    fetcher = vi.fn(async (url: string) => url.includes('validate')
      ? new Response(JSON.stringify({ client_id: 'client', user_id: '123', login: 'broadcaster', scopes: ['user:read:chat', 'channel:read:redemptions'] }))
      : new Response(JSON.stringify({ data: [] }), { status: 202 }));
    vi.stubGlobal('fetch', fetcher);
    bridge = new TwitchBridge({ clientId: 'client', token: 'local-test-token', rewardTitle: 'Request a release check' }, session);
  });
  afterEach(() => { bridge.stop(); vi.useRealTimers(); vi.unstubAllGlobals(); });
  const settled = async () => { await vi.advanceTimersByTimeAsync(0); };
  it('validates credentials and creates chat and reward subscriptions on the welcome session', async () => {
    await bridge.start(); welcome(socket()); await settled();
    expect(fetcher).toHaveBeenCalledTimes(3);
    const body = JSON.parse(fetcher.mock.calls[1][1]?.body as string);
    expect(body.type).toBe('channel.chat.message');
    expect(body.condition).toEqual({ broadcaster_user_id: '123', user_id: '123' });
    expect(body.transport.session_id).toBe('abc');
    expect(session.state.twitchDetail).toBe('Chat + channel points connected');
    expect(JSON.stringify(session.state)).not.toContain('local-test-token');
  });
  it('routes commands, ignores unrelated rewards, and deduplicates deliveries', async () => {
    await bridge.start(); welcome(socket()); await settled();
    const message = event('notification', { event: { chatter_user_name: 'listener', chatter_user_id: '456', message: { text: '!check' } } }, 'channel.chat.message', 'same-id');
    socket().emit('message', message); socket().emit('message', message);
    expect(session.state.phase).toBe('checking');
    expect(session.state.chat.filter(c => c.text === '!check')).toHaveLength(1);
    session.reset();
    session.meters(goodFrame({ measurementId: session.state.runId }));
    socket().emit('message', event('notification', { event: { user_name: 'fan', reward: { id: 'r1', title: 'Other reward' } } }, 'channel.channel_points_custom_reward_redemption.add'));
    expect(session.state.phase).toBe('idle');
    socket().emit('message', event('notification', { event: { user_name: 'fan', reward: { id: 'r2', title: 'Request a release check' } } }, 'channel.channel_points_custom_reward_redemption.add'));
    expect(session.state.phase).toBe('checking');
  });
  it('migrates to the reconnect URL without resubscribing, then closes the old socket', async () => {
    await bridge.start(); welcome(socket()); await settled();
    const old = socket();
    old.emit('message', event('session_reconnect', { session: { reconnect_url: 'wss://eventsub.wss.twitch.tv/ws?reconnect=fixture' } }));
    expect(old.closed).toBe(false); expect(socket(1).url).toContain('reconnect=fixture');
    welcome(socket(1), 'migrated'); await settled();
    expect(old.closed).toBe(true); expect(fetcher).toHaveBeenCalledTimes(3);
  });
  it('reconnects after a lost session and stops on subscription revocation', async () => {
    await bridge.start(); welcome(socket()); await settled(); socket().close();
    await vi.advanceTimersByTimeAsync(1001); expect(instances).toHaveLength(2);
    welcome(socket(1), 'replacement'); await settled(); expect(fetcher).toHaveBeenCalledTimes(5);
    socket(1).emit('message', event('revocation', { subscription: { type: 'channel.chat.message', status: 'authorization_revoked' } }));
    expect(session.state.twitchStatus).toBe('error'); expect(socket(1).closed).toBe(true);
    await vi.advanceTimersByTimeAsync(60000); expect(instances).toHaveLength(2);
  });
});
