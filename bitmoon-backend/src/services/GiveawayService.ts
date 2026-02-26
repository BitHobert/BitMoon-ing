import type { Collection, Db } from 'mongodb';
import { LeaderboardService } from './LeaderboardService.js';
import type {
    GiveawaySnapshot,
    GiveawaySnapshotMeta,
    LeaderboardEntry,
    LeaderboardPeriod,
    LeaderboardType,
} from '../types/index.js';

/** MongoDB document shape for a giveaway snapshot */
interface GiveawayDoc {
    readonly _id: string;              // label (unique slug)
    readonly period: LeaderboardPeriod;
    readonly type: LeaderboardType;
    readonly takenAt: number;
    readonly entries: LeaderboardEntry[];
}

/**
 * GiveawayService freezes leaderboard snapshots for prize payouts.
 *
 * When you're ready to run a giveaway, call snapshotLeaderboard() with
 * a unique label (e.g. "week-2026-W08-score"). The snapshot captures the
 * top-N entries at that exact moment, including verified wallet addresses.
 *
 * Admin endpoints in ApiServer expose these snapshots so you can export
 * the winner list and send prizes to the correct wallet addresses.
 */
export class GiveawayService {
    private static instance: GiveawayService;

    private collection!: Collection<GiveawayDoc>;
    private readonly leaderboard: LeaderboardService;

    private constructor() {
        this.leaderboard = LeaderboardService.getInstance();
    }

    public static getInstance(): GiveawayService {
        if (!GiveawayService.instance) {
            GiveawayService.instance = new GiveawayService();
        }
        return GiveawayService.instance;
    }

    // ── Lifecycle ────────────────────────────────────────────────────────────

    public async connect(db: Db): Promise<void> {
        this.collection = db.collection<GiveawayDoc>('giveaway_snapshots');
        // _id is always unique by default — no need to create an explicit index for it
        await this.collection.createIndex({ takenAt: -1 });
        console.log('[GiveawayService] Connected');
    }

    // ── Write ────────────────────────────────────────────────────────────────

    /**
     * Freeze the current top-N leaderboard entries into a named snapshot.
     *
     * @param label  - Unique slug, e.g. "week-2026-W08-score"
     * @param period - 'daily' | 'weekly' | 'alltime'
     * @param type   - 'score' | 'burned'
     * @param limit  - Number of winners to capture (default 100)
     */
    public async snapshotLeaderboard(
        label: string,
        period: LeaderboardPeriod,
        type: LeaderboardType,
        limit = 100,
    ): Promise<GiveawaySnapshot> {
        if (!label || !/^[a-z0-9-]+$/i.test(label)) {
            throw new Error('Label must be alphanumeric with dashes only');
        }

        const existing = await this.collection.findOne({ _id: label });
        if (existing) {
            throw new Error(`Snapshot with label "${label}" already exists`);
        }

        const entries: LeaderboardEntry[] = type === 'burned'
            ? await this.leaderboard.getBurnLeaderboard(period, limit)
            : await this.leaderboard.getLeaderboard(period, limit);

        const doc: GiveawayDoc = {
            _id: label,
            period,
            type,
            takenAt: Date.now(),
            entries,
        };

        await this.collection.insertOne(doc);

        return {
            label,
            period,
            type,
            takenAt: doc.takenAt,
            entries,
        };
    }

    // ── Read ─────────────────────────────────────────────────────────────────

    /**
     * Retrieve a snapshot by label, including all winner wallet addresses.
     */
    public async getSnapshot(label: string): Promise<GiveawaySnapshot | null> {
        const doc = await this.collection.findOne({ _id: label });
        if (!doc) return null;
        return {
            label: doc._id,
            period: doc.period,
            type: doc.type,
            takenAt: doc.takenAt,
            entries: doc.entries,
        };
    }

    /**
     * List metadata for all past snapshots (no entries — lightweight).
     */
    public async listSnapshots(): Promise<GiveawaySnapshotMeta[]> {
        const docs = await this.collection
            .find({}, { projection: { entries: 0 } })
            .sort({ takenAt: -1 })
            .toArray();

        return docs.map((doc) => ({
            label: doc._id,
            period: doc.period,
            type: doc.type,
            takenAt: doc.takenAt,
            entryCount: doc.entries?.length ?? 0,
        }));
    }
}
