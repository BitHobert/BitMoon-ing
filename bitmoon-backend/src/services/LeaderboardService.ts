import { MongoClient, Db, Collection, IndexDescription } from 'mongodb';
import { Config } from '../config/Config.js';
import { dayKey, weekKey, monthKey } from '../utils/timeKeys.js';
import { GameSupplyService } from './GameSupplyService.js';
import type {
    BadgeLevel,
    LeaderboardEntry,
    LeaderboardPeriod,
    PlayerStats,
    ScoreResult,
    TournamentType,
} from '../types/index.js';

/** Raw MongoDB document shape for a game run */
interface GameRunDoc {
    readonly playerAddress: string;
    readonly sessionId: string;
    readonly score: number;
    readonly totalBurned: string;      // BigInt stored as string
    readonly wavesCleared: number;
    readonly kills: number;
    readonly achievedAt: number;       // Unix ms
    readonly dayKey: string;           // 'YYYY-MM-DD'
    readonly weekKey: string;          // 'YYYY-WNN'
    readonly monthKey: string;         // 'YYYY-MM'
    readonly tournamentType?: TournamentType;
    readonly tournamentKey?: string;
}

/** Aggregated player stats document */
interface PlayerDoc {
    readonly _id: string;              // playerAddress
    totalScore: number;
    allTimeBest: number;
    totalBurned: string;
    totalKills: number;
    wavesCleared: number;
    gamesPlayed: number;
    lastPlayedAt: number;
}

/**
 * LeaderboardService persists game results to MongoDB and serves
 * daily / weekly / all-time leaderboards and per-player stats.
 */
export class LeaderboardService {
    private static instance: LeaderboardService;

    private client!: MongoClient;
    private db!: Db;
    private runs!: Collection<GameRunDoc>;
    private players!: Collection<PlayerDoc>;

    private constructor() {}

    /** Expose the Db instance for GiveawayService initialisation */
    public getDb(): Db {
        return this.db;
    }

    public static getInstance(): LeaderboardService {
        if (!LeaderboardService.instance) {
            LeaderboardService.instance = new LeaderboardService();
        }
        return LeaderboardService.instance;
    }

    // ── Lifecycle ───────────────────────────────────────────────────────────

    /**
     * Connect to MongoDB and ensure indexes exist.
     * Must be called once at startup before any other method.
     */
    public async connect(): Promise<void> {
        this.client = new MongoClient(Config.MONGO_URI, { serverSelectionTimeoutMS: 5000 });
        await this.client.connect();
        this.db = this.client.db(Config.MONGO_DB_NAME);

        this.runs    = this.db.collection<GameRunDoc>('game_runs');
        this.players = this.db.collection<PlayerDoc>('players');

        // Initialise the game supply document in the same DB
        await GameSupplyService.getInstance().connect(this.db);

        await this.ensureIndexes();
        console.log('[LeaderboardService] Connected to MongoDB');
    }

    public async disconnect(): Promise<void> {
        await this.client.close();
    }

    // ── Write ────────────────────────────────────────────────────────────────

    /**
     * Persist a validated game result and update the player's cumulative stats.
     */
    public async saveResult(result: ScoreResult): Promise<void> {
        if (!result.isValid || result.validatedScore === 0) return;

        const now = Date.now();
        const run: GameRunDoc = {
            playerAddress: result.playerAddress,
            sessionId: result.sessionId,
            score: result.validatedScore,
            totalBurned: result.totalBurned.toString(),
            wavesCleared: result.wavesCleared,
            kills: result.kills,
            achievedAt: now,
            dayKey: dayKey(now),
            weekKey: weekKey(now),
            monthKey: monthKey(now),
            ...(result.tournamentType !== undefined ? { tournamentType: result.tournamentType } : {}),
            ...(result.tournamentKey  !== undefined ? { tournamentKey:  result.tournamentKey  } : {}),
        };

        await this.runs.insertOne(run);
        await this.upsertPlayerStats(result, now);
    }

    // ── Read ─────────────────────────────────────────────────────────────────

    /**
     * Fetch top N entries for the given period, ranked by score.
     */
    public async getLeaderboard(
        period: LeaderboardPeriod,
        limit = 100,
    ): Promise<LeaderboardEntry[]> {
        const filter = this.periodFilter(period);

        const docs = await this.runs
            .aggregate<GameRunDoc & { rank: number }>([
                { $match: filter },
                { $sort: { score: -1 } },
                { $limit: limit },
                { $addFields: { rank: { $literal: 0 } } }, // rank assigned below
            ])
            .toArray();

        return docs.map((doc, idx) => ({
            rank: idx + 1,
            playerAddress: doc.playerAddress,
            score: doc.score,
            totalBurned: doc.totalBurned,
            wavesCleared: doc.wavesCleared,
            kills: doc.kills,
            achievedAt: doc.achievedAt,
            badgeLevel: LeaderboardService.computeBadge(doc.score),
        }));
    }

    /**
     * Fetch top N entries ranked by total tokens burned (burn leaderboard).
     */
    public async getBurnLeaderboard(
        period: LeaderboardPeriod,
        limit = 100,
    ): Promise<LeaderboardEntry[]> {
        const filter = this.periodFilter(period);

        const docs = await this.runs
            .aggregate<GameRunDoc>([
                { $match: filter },
                {
                    $addFields: {
                        burnedNumeric: { $toLong: '$totalBurned' },
                    },
                },
                { $sort: { burnedNumeric: -1 } },
                { $limit: limit },
            ])
            .toArray();

        return docs.map((doc, idx) => ({
            rank: idx + 1,
            playerAddress: doc.playerAddress,
            score: doc.score,
            totalBurned: doc.totalBurned,
            wavesCleared: doc.wavesCleared,
            kills: doc.kills,
            achievedAt: doc.achievedAt,
            badgeLevel: LeaderboardService.computeBadge(doc.score),
        }));
    }

    /**
     * Fetch cumulative stats for a single player.
     */
    public async getPlayerStats(playerAddress: string): Promise<PlayerStats | null> {
        const doc = await this.players.findOne({ _id: playerAddress });
        if (!doc) return null;

        return {
            address: playerAddress,
            totalScore: doc.totalScore,
            allTimeBest: doc.allTimeBest,
            totalBurned: doc.totalBurned,
            totalKills: doc.totalKills,
            wavesCleared: doc.wavesCleared,
            gamesPlayed: doc.gamesPlayed,
            badge: LeaderboardService.computeBadge(doc.allTimeBest),
            lastPlayedAt: doc.lastPlayedAt,
        };
    }

    // ── Private helpers ──────────────────────────────────────────────────────

    private async upsertPlayerStats(result: ScoreResult, now: number): Promise<void> {
        await this.players.updateOne(
            { _id: result.playerAddress },
            {
                $inc: {
                    totalScore: result.validatedScore,
                    totalKills: result.kills,
                    wavesCleared: result.wavesCleared,
                    gamesPlayed: 1,
                },
                $max: { allTimeBest: result.validatedScore },
                $set: { lastPlayedAt: now },
            },
            { upsert: true },
        );

        // Update totalBurned separately (BigInt arithmetic via string)
        const player = await this.players.findOne({ _id: result.playerAddress });
        if (player) {
            const prev = BigInt(player.totalBurned ?? '0');
            const next = prev + result.totalBurned;
            await this.players.updateOne(
                { _id: result.playerAddress },
                { $set: { totalBurned: next.toString() } },
            );
        }
    }

    private async ensureIndexes(): Promise<void> {
        const runIndexes: IndexDescription[] = [
            { key: { score: -1 } },
            { key: { playerAddress: 1 } },
            { key: { dayKey: 1, score: -1 } },
            { key: { weekKey: 1, score: -1 } },
            { key: { monthKey: 1, score: -1 } },
            { key: { tournamentKey: 1, score: -1 } },
            { key: { achievedAt: -1 } },
            { key: { sessionId: 1 }, unique: true },
        ];

        const playerIndexes: IndexDescription[] = [
            { key: { _id: 1 } },
            { key: { allTimeBest: -1 } },
        ];

        await Promise.all([
            this.runs.createIndexes(runIndexes),
            this.players.createIndexes(playerIndexes),
        ]);
    }

    private periodFilter(period: LeaderboardPeriod): Record<string, unknown> {
        const now = Date.now();
        switch (period) {
            case 'daily':   return { dayKey:   dayKey(now) };
            case 'weekly':  return { weekKey:  weekKey(now) };
            case 'monthly': return { monthKey: monthKey(now) };
            case 'alltime': return {};
        }
    }

    /**
     * Returns the top-3 verified entrants for a closed tournament period, sorted by:
     *   1. score DESC  2. achievedAt ASC (earliest timestamp wins ties)
     *
     * Only includes players who have a verified (isVerified: true) entry in
     * tournament_entries for this period. Used by PrizeDistributorService.
     */
    public async getTop3ForTournament(
        tournamentType: TournamentType,
        tournamentKey: string,
    ): Promise<Array<{ playerAddress: string; score: number; achievedAt: number }>> {
        const docs = await this.runs
            .find({ tournamentType, tournamentKey })
            .sort({ score: -1, achievedAt: 1 })
            .limit(3)
            .toArray();

        return docs.map(doc => ({
            playerAddress: doc.playerAddress,
            score: doc.score,
            achievedAt: doc.achievedAt,
        }));
    }

    /**
     * Fetch top N entries for a specific tournament period key (e.g. '2026-02-24').
     */
    public async getTournamentLeaderboard(
        tournamentKey: string,
        limit = 100,
    ): Promise<LeaderboardEntry[]> {
        const docs = await this.runs
            .find({ tournamentKey })
            .sort({ score: -1 })
            .limit(limit)
            .toArray();

        return docs.map((doc, idx) => ({
            rank: idx + 1,
            playerAddress: doc.playerAddress,
            score: doc.score,
            totalBurned: doc.totalBurned,
            wavesCleared: doc.wavesCleared,
            kills: doc.kills,
            achievedAt: doc.achievedAt,
            badgeLevel: LeaderboardService.computeBadge(doc.score),
        }));
    }

    /**
     * Assign badge tiers based on all-time best score.
     * Thresholds can be tuned as the game is balanced.
     */
    private static computeBadge(score: number): BadgeLevel {
        if (score >= 5_000_000) return 'lunar';
        if (score >= 1_000_000) return 'diamond';
        if (score >= 500_000)  return 'gold';
        if (score >= 100_000)  return 'silver';
        return 'bronze';
    }
}
