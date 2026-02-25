import type { KillFeedEntry, SupplySnapshot, WsMessageType } from '../types';

// ─── Typed handler map ────────────────────────────────────────────────────────

type WsHandlerMap = {
  supply_update:    (data: SupplySnapshot) => void;
  kill_feed:        (data: KillFeedEntry)  => void;
  leaderboard_update: (data: unknown)      => void;
  pong:             (data: unknown)        => void;
};

type HandlerSet<T extends WsMessageType> = Set<WsHandlerMap[T]>;

// ─── WsClient ─────────────────────────────────────────────────────────────────

export class WsClient {
  private ws: WebSocket | null = null;
  private reconnectDelay = 1000;
  private stopped = false;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private handlers: { [K in WsMessageType]?: HandlerSet<any> } = {};

  constructor(private readonly url: string) {}

  connect(): void {
    if (this.stopped) return;
    try {
      this.ws = new WebSocket(this.url);
    } catch {
      this.scheduleReconnect();
      return;
    }

    this.ws.onopen = () => {
      this.reconnectDelay = 1000;
      console.log('[WsClient] Connected');
    };

    this.ws.onmessage = (evt: MessageEvent<string>) => {
      try {
        const msg = JSON.parse(evt.data) as { type: WsMessageType; data: unknown };
        const set = this.handlers[msg.type];
        if (set) {
          for (const handler of set) {
            // eslint-disable-next-line @typescript-eslint/no-unsafe-call
            (handler as (d: unknown) => void)(msg.data);
          }
        }
      } catch { /* malformed message */ }
    };

    this.ws.onerror = () => { /* handled by onclose */ };

    this.ws.onclose = () => {
      this.ws = null;
      if (!this.stopped) this.scheduleReconnect();
    };
  }

  private scheduleReconnect(): void {
    setTimeout(() => this.connect(), this.reconnectDelay);
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, 30_000);
  }

  subscribe<T extends WsMessageType>(type: T, handler: WsHandlerMap[T]): void {
    if (!this.handlers[type]) {
      this.handlers[type] = new Set();
    }
    (this.handlers[type] as HandlerSet<T>).add(handler);
  }

  unsubscribe<T extends WsMessageType>(type: T, handler: WsHandlerMap[T]): void {
    (this.handlers[type] as HandlerSet<T> | undefined)?.delete(handler);
  }

  disconnect(): void {
    this.stopped = true;
    this.ws?.close();
    this.ws = null;
  }
}
