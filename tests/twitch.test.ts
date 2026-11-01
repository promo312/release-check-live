import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
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
  let session: ReleaseSession, bridge: TwitchBridge, fetcher: Mock<(...args: any[]) => any>;
  beforeEach(() => {
    vi.useFakeTimers(); instances.length = 0;
    session = new ReleaseSession(() => Date.now(), 'twitch');
    session.setAudio(true, 'Test input'); session.meters(goodFrame({ measurementId: session.state.runId }));
    fetcher = vi.fn(async (url: string) => url.includes('validate')
      ? new Response(JSON.stringify({ client_id: 'client', user_id: '123', login: 'broadcaster', scopes: ['user:read:chat', 'user:write:chat', 'channel:read:redemptions'] }))
      : url.includes('/chat/messages') ? new Response(JSON.stringify({ data: [{ message_id: 'sent', is_sent: true }] }))
      : url.includes('/channel_points/custom_rewards') ? new Response(JSON.stringify({ data: [] }))
      : new Response(JSON.stringify({ data: [] }), { status: 202 }));
    vi.stubGlobal('fetch', fetcher);
    bridge = new TwitchBridge({ clientId: 'client', token: 'local-test-token', rewardTitle: 'Request a release check' }, session);
  });
  afterEach(() => { bridge.stop(); vi.useRealTimers(); vi.unstubAllGlobals(); });
  const settled = async () => { await vi.advanceTimersByTimeAsync(0); };
  it('validates credentials and creates chat and reward subscriptions on the welcome session', async () => {
    await bridge.start(); welcome(socket()); await settled();
    expect(fetcher).toHaveBeenCalledTimes(4);
    const body = JSON.parse(fetcher.mock.calls[1][1]?.body as string);
    expect(body.type).toBe('channel.chat.message');
    expect(body.condition).toEqual({ broadcaster_user_id: '123', user_id: '123' });
    expect(body.transport.session_id).toBe('abc');
    expect(session.state.twitchDetail).toBe('Chat + channel points connected');
    expect(JSON.stringify(session.state)).not.toContain('local-test-token');
  });
  it('keeps real chat commands working when the rewards API rejects an ineligible channel', async () => {
    const normalResponse = fetcher.getMockImplementation()!;
    fetcher.mockImplementation(async (url: string) => url.includes('/channel_points/custom_rewards')
      ? new Response(JSON.stringify({ error: 'Forbidden', status: 403, message: 'The broadcaster must have partner or affiliate status.' }), { status: 403 })
      : normalResponse(url));
    await bridge.start(); welcome(socket()); await settled();
    expect(session.state.twitchStatus).toBe('connected');
    expect(session.state.twitchDetail).toBe('Chat connected · channel points unavailable');
    expect(session.state.chat.some(entry => entry.text.includes('Partner or Affiliate'))).toBe(true);
    const subscriptions = fetcher.mock.calls.filter(([url]) => String(url).includes('/eventsub/subscriptions'));
    expect(subscriptions).toHaveLength(1);
    expect(JSON.parse(subscriptions[0][1].body as string).type).toBe('channel.chat.message');
    socket().emit('message', event('notification', { event: { chatter_user_name: 'broadcaster', chatter_user_id: '123', message: { text: '!check' } } }, 'channel.chat.message'));
    expect(session.state.phase).toBe('checking');
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
  it('posts one ordered check acknowledgement, score/vote prompt, fix and result using the authorized user token', async () => {
    await bridge.start(); welcome(socket()); await settled();
    const command = (text: string, user = '123', messageId = String(++id)) =>
      socket().emit('message', event('notification', { event: { chatter_user_name: 'listener', chatter_user_id: user, message: { text } } }, 'channel.chat.message', messageId));
    command('!check', '123', 'one-check'); command('!check', '123', 'one-check');
    await settled();
    vi.setSystemTime(Date.now() + 30000);
    session.meters(goodFrame({ measurementId: session.state.runId })); session.tick(); session.tick();
    await settled();
    command('!fix');
    command('!ready', 'a'); command('!ready', 'b'); command('!notyet', 'c');
    await settled();
    vi.setSystemTime(Date.now() + 20000);
    session.meters(goodFrame({ measurementId: session.state.runId })); session.tick(); session.tick();
    await settled();
    const posts = fetcher.mock.calls.filter(([url]) => String(url).endsWith('/chat/messages'));
    const messages = posts.map(([, options]) => JSON.parse(options.body).message);
    expect(messages).toHaveLength(4);
    expect(messages[0]).toContain('started a 30-second release check');
    expect(messages[1]).toContain('100/100');
    expect(messages[1]).toContain('Vote !ready or !notyet');
    expect(messages[2]).toBe(session.state.result!.fix);
    expect(messages[3]).toBe('Chat result: ready (3 votes). 2 ready · 1 not yet.');
    for (const [, options] of posts) {
      expect(options.method).toBe('POST');
      expect(options.headers.Authorization).toBe('Bearer local-test-token');
      expect(options.headers['Client-Id']).toBe('client');
      expect(JSON.parse(options.body)).toMatchObject({ broadcaster_id: '123', sender_id: '123' });
    }
    expect(JSON.stringify(session.state)).not.toContain('local-test-token');
    bridge.stop(); session.announce('After shutdown'); await settled();
    expect(fetcher.mock.calls.filter(([url]) => String(url).endsWith('/chat/messages'))).toHaveLength(4);
  });
  it('keeps commands, score and voting working without attempting replies when user:write:chat is absent', async () => {
    fetcher.mockImplementation(async (url: string) => url.includes('validate')
      ? new Response(JSON.stringify({ client_id: 'client', user_id: '123', scopes: ['user:read:chat'] }))
      : new Response(JSON.stringify({ data: [] }), { status: 202 }));
    await bridge.start(); welcome(socket()); await settled();
    expect(session.state.twitchCanSendChat).toBe(false);
    expect(session.state.twitchDetail).toContain('missing user:write:chat');
    socket().emit('message', event('notification', { event: { chatter_user_name: 'listener', chatter_user_id: '123', message: { text: '!check' } } }, 'channel.chat.message'));
    vi.setSystemTime(Date.now() + 30000);
    session.meters(goodFrame({ measurementId: session.state.runId })); session.tick();
    expect(session.state.result!.score).toBe(100);
    expect(session.state.phase).toBe('voting');
    session.command('listener', '123', '!ready');
    vi.setSystemTime(Date.now() + 20000);
    session.meters(goodFrame({ measurementId: session.state.runId })); session.tick(); await settled();
    expect(session.state.verdict).toBe('Too few votes');
    expect(session.state.twitchStatus).toBe('connected');
    expect(fetcher.mock.calls.filter(([url]) => String(url).endsWith('/chat/messages'))).toHaveLength(0);
  });
  it.each([403, 200])('reports rejected or dropped chat replies (HTTP %i) without breaking EventSub or exposing tokens', async status => {
    const normalResponse = fetcher.getMockImplementation()!;
    fetcher.mockImplementation(async (url: string) => url.endsWith('/chat/messages')
      ? new Response(JSON.stringify({ data: [{ is_sent: false }], message: 'local-test-token' }), { status })
      : normalResponse(url));
    await bridge.start(); welcome(socket()); await settled();
    session.announce('Measured score: 100/100. Vote !ready or !notyet.'); await settled();
    expect(session.state.twitchStatus).toBe('connected');
    expect(session.state.chat.at(-1)!.text).toContain('reply could not be sent');
    expect(JSON.stringify(session.state)).not.toContain('local-test-token');
    if (status === 403) {
      expect(session.state.twitchCanSendChat).toBe(false);
      session.announce('No unauthorized retry'); await settled();
      expect(fetcher.mock.calls.filter(([url]) => String(url).endsWith('/chat/messages'))).toHaveLength(1);
    }
    socket().emit('message', event('notification', { event: { chatter_user_name: 'listener', chatter_user_id: '123', message: { text: '!check' } } }, 'channel.chat.message'));
    expect(session.state.phase).toBe('checking');
  });
  it('migrates to the reconnect URL without resubscribing, then closes the old socket', async () => {
    await bridge.start(); welcome(socket()); await settled();
    const old = socket();
    old.emit('message', event('session_reconnect', { session: { reconnect_url: 'wss://eventsub.wss.twitch.tv/ws?reconnect=fixture' } }));
    expect(old.closed).toBe(false); expect(socket(1).url).toContain('reconnect=fixture');
    welcome(socket(1), 'migrated'); await settled();
    expect(old.closed).toBe(true); expect(fetcher).toHaveBeenCalledTimes(4);
  });
  it('reconnects after a lost session and stops on subscription revocation', async () => {
    await bridge.start(); welcome(socket()); await settled(); socket().close();
    await vi.advanceTimersByTimeAsync(1001); expect(instances).toHaveLength(2);
    welcome(socket(1), 'replacement'); await settled(); expect(fetcher).toHaveBeenCalledTimes(7);
    socket(1).emit('message', event('revocation', { subscription: { type: 'channel.chat.message', status: 'authorization_revoked' } }));
    expect(session.state.twitchStatus).toBe('error'); expect(socket(1).closed).toBe(true);
    await vi.advanceTimersByTimeAsync(60000); expect(instances).toHaveLength(2);
  });
});
