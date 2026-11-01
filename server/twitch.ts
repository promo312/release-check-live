import WebSocket from 'ws';
import type { ReleaseSession } from './session';

const ENDPOINT = 'wss://eventsub.wss.twitch.tv/ws?keepalive_timeout_seconds=30';
interface Config { clientId: string; token: string; rewardId?: string; rewardTitle: string }
interface Envelope {
  metadata: { message_id: string; message_type: string; subscription_type?: string };
  payload: {
    session?: { id: string; keepalive_timeout_seconds: number | null; reconnect_url?: string };
    subscription?: { type: string; status: string };
    event?: { chatter_user_name?: string; chatter_user_id?: string; message?: { text: string }; user_name?: string; reward?: { id: string; title: string } };
  };
}

/** Installed broadcaster client. Credentials remain in the Node process. */
export class TwitchBridge {
  private sockets = new Set<WebSocket>();
  private active: WebSocket | null = null;
  private watchdog: ReturnType<typeof setTimeout> | null = null;
  private retry: ReturnType<typeof setTimeout> | null = null;
  private revalidate: ReturnType<typeof setInterval> | null = null;
  private stopped = false;
  private seen = new Set<string>();
  private broadcaster = '';
  private failures = 0;
  private chatReady = false;
  private rewardsReady = false;
  private scopes: string[] = [];
  private unsubscribeAnnouncements?: () => void;
  private replyQueue = Promise.resolve();

  constructor(private config: Config, private session: ReleaseSession) {}

  async start() {
    try {
      await this.validate();
      if (this.stopped) return;
      this.unsubscribeAnnouncements ??= this.session.onAnnouncement(text => this.queueReply(text));
      this.status('connecting', 'Connecting to Twitch EventSub');
      this.connect(ENDPOINT, false);
      this.revalidate = setInterval(() => { void this.validate().catch(() => {
        this.status('error', 'Twitch authorization expired. Update .env and restart.'); this.stop();
      }); }, 55 * 60 * 1000);
    } catch (error) { this.status('error', error instanceof Error ? error.message : 'Twitch setup failed.'); }
  }

  private async validate() {
    if (!this.config.clientId || !this.config.token) throw new Error('Set TWITCH_CLIENT_ID and TWITCH_USER_ACCESS_TOKEN in .env, then restart.');
    const response = await fetch('https://id.twitch.tv/oauth2/validate', {
      headers: { Authorization: `OAuth ${this.config.token}` }, signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new Error('Twitch token validation failed. Renew the user access token and restart.');
    const data = await response.json() as { client_id: string; user_id: string; scopes: string[]; login: string };
    if (data.client_id !== this.config.clientId) throw new Error('The Twitch token belongs to a different client ID.');
    if (!data.scopes.includes('user:read:chat')) throw new Error('The Twitch user token needs user:read:chat.');
    this.broadcaster = data.user_id; this.scopes = data.scopes;
    this.session.state.twitchCanSendChat = this.scopes.includes('user:write:chat');
  }

  private status(status: 'connecting' | 'connected' | 'error', detail: string) {
    this.session.state.twitchStatus = status;
    const replies = !this.scopes.includes('user:write:chat') ? ' · Chat replies unavailable (missing user:write:chat)'
      : !this.session.state.twitchCanSendChat ? ' · Chat replies rejected by Twitch' : '';
    this.session.state.twitchDetail = detail + (status === 'connected' ? replies : '');
  }

  private queueReply(text: string) {
    if (this.stopped || !this.chatReady || !this.session.state.twitchCanSendChat) return;
    // Keep score/prompt/result in order and never resend on EventSub reconnect.
    this.replyQueue = this.replyQueue.then(async () => {
      if (this.stopped || !this.chatReady || !this.session.state.twitchCanSendChat) return;
      const response = await fetch('https://api.twitch.tv/helix/chat/messages', {
        method: 'POST',
        headers: { 'Client-Id': this.config.clientId, Authorization: `Bearer ${this.config.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ broadcaster_id: this.broadcaster, sender_id: this.broadcaster, message: text.slice(0, 500) }),
        signal: AbortSignal.timeout(8000),
      });
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          this.session.state.twitchCanSendChat = false;
          this.session.state.twitchDetail = 'Chat connected · Twitch rejected chat replies; check chat-write permission';
        }
        throw new Error('Chat reply rejected');
      }
      const body = await response.json() as { data?: { is_sent?: boolean }[] };
      if (!body.data?.[0]?.is_sent) throw new Error('Chat reply dropped');
    }).catch(() => {
      // Never expose authorization headers, tokens, or upstream error bodies.
      if (!this.stopped) this.session.log('Release Check', 'A Twitch chat reply could not be sent. Scores and votes remain available in the control room and overlay.');
    });
  }

  private connect(url: string, migrating: boolean) {
    if (this.stopped) return;
    const socket = new WebSocket(url, { handshakeTimeout: 10000 });
    this.sockets.add(socket);
    let welcomed = false;
    socket.on('message', raw => {
      let data: Envelope;
      try { data = JSON.parse(raw.toString()) as Envelope; } catch { return; }
      const { metadata, payload } = data;
      if (!metadata?.message_id) return;
      if (metadata.message_type === 'session_welcome' && payload.session) {
        welcomed = true;
        const old = this.active;
        this.active = socket;
        if (migrating) old?.close();
        this.armWatchdog(socket, payload.session.keepalive_timeout_seconds ?? 30);
        if (!migrating) {
          this.chatReady = false; this.rewardsReady = false;
          void this.subscribe(payload.session.id).catch(() => {
            this.status('error', 'Twitch subscription failed. Check the token scopes and restart.');
            this.stop();
          });
        } else this.status('connected', this.rewardsReady ? 'Chat + channel points connected' : 'Chat connected · channel points unavailable');
        this.failures = 0;
        return;
      }
      if (socket === this.active) this.armWatchdog(socket, 30);
      if (this.seen.has(metadata.message_id)) return;
      this.seen.add(metadata.message_id);
      if (this.seen.size > 2048) this.seen.delete(this.seen.values().next().value!);
      if (metadata.message_type === 'session_reconnect' && payload.session?.reconnect_url) {
        const target = new URL(payload.session.reconnect_url);
        if (target.protocol === 'wss:' && target.hostname === 'eventsub.wss.twitch.tv') this.connect(payload.session.reconnect_url, true);
      }
      if (metadata.message_type === 'revocation') {
        this.status('error', `Twitch subscription revoked: ${payload.subscription?.status ?? 'unknown'}. Reauthorize and restart.`);
        this.stop();
      }
      if (metadata.message_type !== 'notification' || !payload.event) return;
      const event = payload.event;
      if (metadata.subscription_type === 'channel.chat.message') {
        const text = event.message?.text ?? '';
        const name = event.chatter_user_name ?? 'viewer';
        this.session.log(name, text, 'chat');
        const error = this.session.command(name, event.chatter_user_id ?? name, text, false);
        if (error) this.session.announce(error);
      }
      if (metadata.subscription_type === 'channel.channel_points_custom_reward_redemption.add') {
        const matches = this.config.rewardId ? event.reward?.id === this.config.rewardId : event.reward?.title === this.config.rewardTitle;
        if (matches) this.session.reward(event.user_name ?? 'viewer');
      }
    });
    socket.on('error', () => { /* close handles backoff; credentials and upstream bodies are never logged */ });
    socket.on('close', () => {
      this.sockets.delete(socket);
      if (this.stopped) return;
      if (this.active === socket || !welcomed) {
        if (this.active === socket) this.active = null;
        this.scheduleRetry();
      }
    });
  }

  private armWatchdog(socket: WebSocket, timeout: number) {
    if (this.watchdog) clearTimeout(this.watchdog);
    this.watchdog = setTimeout(() => socket.terminate(), (timeout + 3) * 1000);
  }

  private scheduleRetry() {
    if (this.retry || this.stopped) return;
    this.status('connecting', 'Twitch disconnected · reconnecting');
    this.retry = setTimeout(() => {
      this.retry = null;
      for (const socket of this.sockets) socket.terminate();
      this.connect(ENDPOINT, false);
    }, Math.min(30000, 1000 * 2 ** Math.min(5, this.failures++)));
  }

  private async subscribe(sessionId: string) {
    const transport = { method: 'websocket', session_id: sessionId };
    const create = async (type: string, condition: Record<string, string>) => {
      const response = await fetch('https://api.twitch.tv/helix/eventsub/subscriptions', {
        method: 'POST', headers: { 'Client-Id': this.config.clientId, Authorization: `Bearer ${this.config.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, version: '1', condition, transport }), signal: AbortSignal.timeout(8000),
      });
      if (!response.ok) throw new Error('Subscription failed');
    };
    await create('channel.chat.message', { broadcaster_user_id: this.broadcaster, user_id: this.broadcaster });
    this.chatReady = true;
    const hasRewardScope = this.scopes.includes('channel:read:redemptions') || this.scopes.includes('channel:manage:redemptions');
    if (hasRewardScope) {
      try {
        // EventSub can accept this subscription for a channel that cannot yet
        // offer rewards. Verify reward access before claiming it is usable.
        const rewards = await fetch(`https://api.twitch.tv/helix/channel_points/custom_rewards?broadcaster_id=${encodeURIComponent(this.broadcaster)}`, {
          headers: { 'Client-Id': this.config.clientId, Authorization: `Bearer ${this.config.token}` }, signal: AbortSignal.timeout(8000),
        });
        if (rewards.status === 403) throw new Error('Chat is connected. Channel Points rewards require Partner or Affiliate status for this channel.');
        if (!rewards.ok) throw new Error('Chat is connected. Channel points could not be connected; check broadcaster eligibility and reward permissions.');
        await create('channel.channel_points_custom_reward_redemption.add', {
          broadcaster_user_id: this.broadcaster, ...(this.config.rewardId ? { reward_id: this.config.rewardId } : {}),
        });
        this.rewardsReady = true;
      } catch (error) { this.session.log('Release Check', error instanceof Error && error.message.startsWith('Chat is connected.') ? error.message : 'Chat is connected. Channel points could not be connected; check broadcaster eligibility and reward permissions.'); }
    }
    if (!this.stopped) this.status('connected', this.chatReady && this.rewardsReady ? 'Chat + channel points connected' : 'Chat connected · channel points unavailable');
  }

  stop() {
    this.stopped = true;
    this.unsubscribeAnnouncements?.(); this.unsubscribeAnnouncements = undefined;
    if (this.watchdog) clearTimeout(this.watchdog);
    if (this.retry) clearTimeout(this.retry);
    if (this.revalidate) clearInterval(this.revalidate);
    for (const socket of this.sockets) socket.close();
    this.sockets.clear();
  }
}
