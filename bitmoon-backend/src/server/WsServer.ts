import uWS from '@btc-vision/uwebsockets.js';
import { Config } from '../config/Config.js';
import { SupplyWatcher } from '../services/SupplyWatcher.js';
import { LeaderboardService } from '../services/LeaderboardService.js';
import type { KillFeedEntry, LeaderboardPeriod, SupplySnapshot, WsMessage } from '../types/index.js';

type WsClient = uWS.WebSocket<unknown>;

/** Message clients send to the server */
interface WsClientMessage {
    readonly action: 'ping' | 'subscribe' | 'unsubscribe';
    readonly channel?: 'supply' | 'kill_feed' | 'leaderboard';
    readonly period?: LeaderboardPeriod;
}

/** Per-client subscription state (stored in WebSocket user data) */
interface ClientData {
    subscribedSupply: boolean;
    subscribedKillFeed: boolean;
    subscribedLeaderboard: boolean;
}

/**
 * Real-time WebSocket server using @btc-vision/uwebsocket.js.
 *
 * Channels:
 *  supply     — $BITMOON supply updates every poll interval
 *  kill_feed  — individual kill events from active game sessions
 *  leaderboard — pushed whenever a new high score is saved
 */
export class WsServer {
    private static instance: WsServer;

    private app!: uWS.TemplatedApp;
    private readonly watcher: SupplyWatcher;
    private readonly leaderboard: LeaderboardService;

    /** All connected WebSocket clients */
    private readonly clients: Set<WsClient> = new Set();

    private constructor() {
        this.watcher     = SupplyWatcher.getInstance();
        this.leaderboard = LeaderboardService.getInstance();
    }

    public static getInstance(): WsServer {
        if (!WsServer.instance) {
            WsServer.instance = new WsServer();
        }
        return WsServer.instance;
    }

    // ── Lifecycle ────────────────────────────────────────────────────────────

    /**
     * Start the WebSocket server.
     *
     * @param existingApp  If provided, WebSocket routes are added to this uWS
     *                     app instead of creating a standalone listener. This
     *                     allows HTTP + WS to share a single port (required for
     *                     Railway / single-port deployments).
     */
    public start(existingApp?: uWS.TemplatedApp): void {
        if (existingApp) {
            // Attach WS route to the existing HTTP server (shared port)
            this.app = existingApp;
            this.attachWsRoute(this.app);
            console.log(`[WsServer] Attached to HTTP server (shared port)`);
        } else {
            // Standalone WS server on its own port
            this.app = uWS.App();
            this.attachWsRoute(this.app);
            this.app.listen(Config.WS_PORT, (token) => {
                if (token) {
                    console.log(`[WsServer] Listening on port ${Config.WS_PORT}`);
                } else {
                    console.error(`[WsServer] Failed to bind port ${Config.WS_PORT}`);
                }
            });
        }

        this.registerWatchers();
    }

    private attachWsRoute(app: uWS.TemplatedApp): void {
        app.ws<ClientData>('/*', {
            /* Compression off for low latency */
            compression: 0,
            maxPayloadLength: 64 * 1024,    // 64 KB
            idleTimeout: 120,

            open: (ws) => {
                this.clients.add(ws as WsClient);
                // Default: subscribed to everything
                (ws as uWS.WebSocket<ClientData>).getUserData().subscribedSupply      = true;
                (ws as uWS.WebSocket<ClientData>).getUserData().subscribedKillFeed    = true;
                (ws as uWS.WebSocket<ClientData>).getUserData().subscribedLeaderboard = true;

                // Send current supply snapshot immediately
                const snapshot = this.watcher.getLastSnapshot();
                if (snapshot) {
                    this.sendTo(ws as WsClient, SupplyWatcher.buildSupplyMessage(snapshot));
                }
            },

            message: (ws, rawMsg, _isBinary) => {
                this.handleMessage(ws as WsClient, rawMsg);
            },

            close: (ws) => {
                this.clients.delete(ws as WsClient);
            },
        });
    }

    // ── Internal message handling ────────────────────────────────────────────

    private handleMessage(ws: WsClient, raw: ArrayBuffer): void {
        let msg: WsClientMessage;
        try {
            msg = JSON.parse(new TextDecoder().decode(raw)) as WsClientMessage;
        } catch {
            return; // ignore malformed messages
        }

        const data = (ws as uWS.WebSocket<ClientData>).getUserData();

        switch (msg.action) {
            case 'ping':
                this.sendTo(ws, { type: 'pong', data: null, timestamp: Date.now() });
                break;

            case 'subscribe':
                if (msg.channel === 'supply')      data.subscribedSupply      = true;
                if (msg.channel === 'kill_feed')   data.subscribedKillFeed    = true;
                if (msg.channel === 'leaderboard') data.subscribedLeaderboard = true;
                break;

            case 'unsubscribe':
                if (msg.channel === 'supply')      data.subscribedSupply      = false;
                if (msg.channel === 'kill_feed')   data.subscribedKillFeed    = false;
                if (msg.channel === 'leaderboard') data.subscribedLeaderboard = false;
                break;
        }
    }

    // ── Watchers ─────────────────────────────────────────────────────────────

    private registerWatchers(): void {
        // Supply updates
        this.watcher.onSupplyUpdate((snapshot: SupplySnapshot) => {
            const msg = SupplyWatcher.buildSupplyMessage(snapshot);
            this.broadcast(msg, (d) => d.subscribedSupply);
        });

        // Kill feed
        this.watcher.onKillFeed((entry: KillFeedEntry) => {
            const msg = SupplyWatcher.buildKillFeedMessage(entry);
            this.broadcast(msg, (d) => d.subscribedKillFeed);
        });
    }

    // ── Broadcast helpers ────────────────────────────────────────────────────

    /**
     * Push a leaderboard update to all subscribed clients.
     * Called externally by ApiServer after a score is saved.
     */
    public async pushLeaderboardUpdate(): Promise<void> {
        const [daily, weekly, alltime] = await Promise.all([
            this.leaderboard.getLeaderboard('daily', 10),
            this.leaderboard.getLeaderboard('weekly', 10),
            this.leaderboard.getLeaderboard('alltime', 10),
        ]);

        const msg: WsMessage<{ daily: unknown; weekly: unknown; alltime: unknown }> = {
            type: 'leaderboard_update',
            data: { daily, weekly, alltime },
            timestamp: Date.now(),
        };

        this.broadcast(msg, (d) => d.subscribedLeaderboard);
    }

    private broadcast(
        msg: WsMessage<unknown>,
        filter: (data: ClientData) => boolean,
    ): void {
        const payload = JSON.stringify(msg);
        for (const ws of this.clients) {
            const data = (ws as uWS.WebSocket<ClientData>).getUserData();
            if (filter(data)) {
                ws.send(payload, false);
            }
        }
    }

    private sendTo(ws: WsClient, msg: WsMessage<unknown>): void {
        ws.send(JSON.stringify(msg), false);
    }
}
