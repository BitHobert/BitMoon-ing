import { Config } from '../config/Config.js';
import { GameSupplyService } from './GameSupplyService.js';
import type { KillFeedEntry, SupplySnapshot, WsMessage } from '../types/index.js';

/** Callback type for supply update subscribers */
type SupplyUpdateCallback = (snapshot: SupplySnapshot) => void;

/** Callback type for kill feed broadcasts */
type KillFeedCallback = (entry: KillFeedEntry) => void;

/**
 * SupplyWatcher polls the in-game supply from MongoDB on a fixed interval
 * and notifies all registered WebSocket subscribers when it changes.
 *
 * It also acts as the event bus for kill feed entries.
 * No OPNet / blockchain calls are made here.
 */
export class SupplyWatcher {
    private static instance: SupplyWatcher;

    private readonly gameSupply: GameSupplyService;

    private readonly supplyCallbacks: Set<SupplyUpdateCallback> = new Set();
    private readonly killFeedCallbacks: Set<KillFeedCallback>   = new Set();

    private lastSnapshot: SupplySnapshot | null = null;
    private pollTimer: ReturnType<typeof setInterval> | null = null;

    private constructor() {
        this.gameSupply = GameSupplyService.getInstance();
    }

    public static getInstance(): SupplyWatcher {
        if (!SupplyWatcher.instance) {
            SupplyWatcher.instance = new SupplyWatcher();
        }
        return SupplyWatcher.instance;
    }

    // ── Lifecycle ────────────────────────────────────────────────────────────

    public start(): void {
        if (this.pollTimer) return;

        void this.poll();
        this.pollTimer = setInterval(() => { void this.poll(); }, Config.SUPPLY_POLL_INTERVAL_MS);
        console.log(`[SupplyWatcher] Started (interval=${Config.SUPPLY_POLL_INTERVAL_MS}ms)`);
    }

    public stop(): void {
        if (this.pollTimer) {
            clearInterval(this.pollTimer);
            this.pollTimer = null;
        }
    }

    // ── Subscriptions ────────────────────────────────────────────────────────

    public onSupplyUpdate(cb: SupplyUpdateCallback): () => void {
        this.supplyCallbacks.add(cb);
        if (this.lastSnapshot) cb(this.lastSnapshot);
        return () => { this.supplyCallbacks.delete(cb); };
    }

    public onKillFeed(cb: KillFeedCallback): () => void {
        this.killFeedCallbacks.add(cb);
        return () => { this.killFeedCallbacks.delete(cb); };
    }

    // ── Broadcasting ─────────────────────────────────────────────────────────

    public broadcastKill(entry: KillFeedEntry): void {
        for (const cb of this.killFeedCallbacks) cb(entry);
    }

    public getLastSnapshot(): SupplySnapshot | null {
        return this.lastSnapshot;
    }

    // ── Internal ─────────────────────────────────────────────────────────────

    private async poll(): Promise<void> {
        try {
            const snapshot = await this.gameSupply.getSnapshot();

            const changed =
                this.lastSnapshot === null ||
                this.lastSnapshot.currentSupply !== snapshot.currentSupply ||
                this.lastSnapshot.sequenceNumber !== snapshot.sequenceNumber;

            this.lastSnapshot = snapshot;

            if (changed) {
                for (const cb of this.supplyCallbacks) cb(snapshot);
            }
        } catch (err) {
            console.error('[SupplyWatcher] Poll error:', err);
        }
    }

    // ── Message builders (used by WsServer) ──────────────────────────────────

    public static buildSupplyMessage(snapshot: SupplySnapshot): WsMessage<{
        currentSupply: string;
        totalBurned: string;
        scarcityMultiplier: number;
        sequenceNumber: number;
    }> {
        return {
            type: 'supply_update',
            data: {
                currentSupply: snapshot.currentSupply.toString(),
                totalBurned: snapshot.totalBurned.toString(),
                scarcityMultiplier: snapshot.scarcityMultiplier,
                sequenceNumber: snapshot.sequenceNumber,
            },
            timestamp: snapshot.timestamp,
        };
    }

    public static buildKillFeedMessage(entry: KillFeedEntry): WsMessage<KillFeedEntry> {
        return {
            type: 'kill_feed',
            data: entry,
            timestamp: Date.now(),
        };
    }
}
