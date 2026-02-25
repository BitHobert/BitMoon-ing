/**
 * Shared TypeScript types for the BitMoon'ing backend.
 */

// ─── Enemy Tiers ─────────────────────────────────────────────────────────────

/** 1-indexed tier number */
export type TierNumber = 1 | 2 | 3 | 4 | 5;

export interface EnemyTierConfig {
    readonly tier: TierNumber;
    /** Hit points required to destroy this enemy */
    readonly hp: number;
    /** Base points awarded on kill (before scarcity multiplier) */
    readonly basePoints: number;
    /** Game supply units removed per kill (mirrors token burn feel) */
    readonly burnPerKill: bigint;
    /** Whether this tier fires back at the player */
    readonly firesBack: boolean;
    /** Relative speed factor (1.0 = baseline) */
    readonly speedFactor: number;
}

// ─── Game Events (sent from client for server-side validation) ────────────────

export type GameEventType = 'kill' | 'hit' | 'miss' | 'powerup' | 'wave_clear' | 'player_death';

export interface GameEvent {
    /** Monotonically increasing tick counter from the client */
    readonly tick: number;
    readonly type: GameEventType;
    /** Enemy tier involved (for kill/hit events) */
    readonly tier?: TierNumber;
    /** Power-up type collected */
    readonly powerupType?: string;
    /** Wave number when event occurred */
    readonly wave: number;
}

// ─── Game Session ─────────────────────────────────────────────────────────────

export interface GameSession {
    readonly sessionId: string;
    readonly playerAddress: string;
    readonly startedAt: number;
    readonly expiresAt: number;
    /** Whether the session has been finalised (scored) */
    isActive: boolean;
    /** Tournament this session is linked to (if any) */
    readonly tournamentType?: TournamentType;
    readonly tournamentKey?: string;
}

export interface SessionStartRequest {
    readonly playerAddress: string;
    /** Signed message proving wallet ownership */
    readonly signature: string;
    /** The plaintext message that was signed */
    readonly message: string;
}

export interface SessionEndRequest {
    readonly sessionId: string;
    readonly playerAddress: string;
    /** Ordered list of game events for server replay */
    readonly events: GameEvent[];
    /** Client-reported final score (server will validate) */
    readonly clientScore: number;
    /** Client-reported total supply units consumed */
    readonly clientBurned: bigint;
}

// ─── Scoring ──────────────────────────────────────────────────────────────────

export interface ScoreResult {
    readonly sessionId: string;
    readonly playerAddress: string;
    readonly validatedScore: number;
    readonly totalBurned: bigint;
    readonly wavesCleared: number;
    readonly kills: number;
    readonly isValid: boolean;
    /** Reason score was rejected (if isValid = false) */
    readonly rejectionReason?: string;
    /** Tournament this session was played in (if any) */
    readonly tournamentType?: TournamentType;
    readonly tournamentKey?: string;
}

// ─── Leaderboard ─────────────────────────────────────────────────────────────

export type LeaderboardPeriod = 'daily' | 'weekly' | 'monthly' | 'alltime';
export type LeaderboardType = 'score' | 'burned';

export interface LeaderboardEntry {
    readonly rank: number;
    readonly playerAddress: string;
    readonly score: number;
    readonly totalBurned: string;   // bigint serialised as string for JSON
    readonly wavesCleared: number;
    readonly kills: number;
    readonly achievedAt: number;    // Unix timestamp (ms)
    readonly badgeLevel: BadgeLevel;
}

export type BadgeLevel = 'bronze' | 'silver' | 'gold' | 'diamond' | 'lunar';

// ─── Supply ───────────────────────────────────────────────────────────────────

export interface SupplySnapshot {
    /** Current in-game supply (raw units, 8 decimals) */
    readonly currentSupply: bigint;
    /** Total supply consumed by kills so far */
    readonly totalBurned: bigint;
    /** Scarcity multiplier = initialSupply / currentSupply */
    readonly scarcityMultiplier: number;
    /** Monotonic sequence number for cache invalidation */
    readonly sequenceNumber: number;
    readonly timestamp: number;
}

// ─── Player ───────────────────────────────────────────────────────────────────

export interface PlayerStats {
    readonly address: string;
    readonly totalScore: number;
    readonly allTimeBest: number;
    readonly totalBurned: string;
    readonly totalKills: number;
    readonly wavesCleared: number;
    readonly gamesPlayed: number;
    readonly badge: BadgeLevel;
    readonly lastPlayedAt: number;
}

// ─── WebSocket Messages ───────────────────────────────────────────────────────

export type WsMessageType = 'supply_update' | 'kill_feed' | 'leaderboard_update' | 'pong';

export interface WsMessage<T = unknown> {
    readonly type: WsMessageType;
    readonly data: T;
    readonly timestamp: number;
}

export interface KillFeedEntry {
    readonly playerAddress: string;
    readonly tier: TierNumber;
    readonly points: number;
    readonly scarcityMultiplier: number;
}

// ─── Giveaway ─────────────────────────────────────────────────────────────────

export interface GiveawaySnapshot {
    readonly label: string;
    readonly period: LeaderboardPeriod;
    readonly type: LeaderboardType;
    readonly takenAt: number;
    readonly entries: LeaderboardEntry[];
}

export interface GiveawaySnapshotMeta {
    readonly label: string;
    readonly period: LeaderboardPeriod;
    readonly type: LeaderboardType;
    readonly takenAt: number;
    readonly entryCount: number;
}

// ─── Tournament ────────────────────────────────────────────────────────────────

export type TournamentType = 'daily' | 'weekly' | 'monthly';

export interface TournamentFeeConfig {
    readonly _id: TournamentType;
    /**
     * Entry fee in raw OP-20 token units (stored as string for BigInt safety).
     * Token contract is configured globally via Config.ENTRY_TOKEN_ADDRESS.
     */
    readonly entryFee: string;
    readonly updatedAt: number;
}

export interface TournamentEntry {
    readonly _id: string;               // UUID v4
    readonly tournamentType: TournamentType;
    /** Period key — e.g. '2026-02-24' | '2026-W08' | '2026-02' */
    readonly tournamentKey: string;
    readonly playerAddress: string;
    readonly paymentTxHash: string;
    /** Total OP-20 token units paid (as string) */
    readonly amountPaid: string;
    /** 5 % dev cut (as string) */
    readonly devAmount: string;
    /** 15 % contribution to next tournament period's prize pool (as string) */
    readonly nextPoolAmount: string;
    /** 80 % contribution to current prize pool (as string) */
    readonly prizeAmount: string;
    readonly paidAt: number;
    readonly confirmations: number;
    /** True once payment has MIN_PAYMENT_CONFIRMATIONS on-chain */
    readonly isVerified: boolean;
}

export interface TournamentInfo {
    readonly tournamentType: TournamentType;
    /** Period key — the start block number as a string (e.g. "100") */
    readonly tournamentKey: string;
    /** Entry fee in raw OP-20 token units (as string) */
    readonly entryFee: string;
    /** Address of the OP-20 entry fee token contract */
    readonly tokenAddress: string;
    /** Address of the on-chain PrizeDistributor contract holding the prize pools */
    readonly prizeContractAddress: string;
    /** Sum of verified 80 % prize contributions for this period (as string) */
    readonly prizePool: string;
    /** Sum of verified 15 % next-pool contributions (as string) */
    readonly nextPool: string;
    readonly entrantCount: number;
    /** Block number when this period began (as string) */
    readonly startsAtBlock: string;
    /** Last active block of this period (as string) */
    readonly endsAtBlock: string;
    /** Prize distribution block = endsAtBlock + 1 (as string) */
    readonly prizeBlock: string;
    /** Block when the next period of this type begins = endsAtBlock + GAP + 1 (as string) */
    readonly nextStartBlock: string;
    /** Whether the current block is within this period's active range */
    readonly isActive: boolean;
}

export interface PrizeDistribution {
    readonly _id: string;                    // UUID v4
    readonly tournamentType: TournamentType;
    /** Period start block (matches tournamentKey in tournament_entries) */
    readonly tournamentKey: string;
    /** On-chain distributePrize() transaction hash */
    readonly txHash: string;
    readonly winners: ReadonlyArray<{
        readonly place: 1 | 2 | 3;
        readonly address: string;
        readonly amount: string;            // token units as string
    }>;
    /** Total prize distributed (mainPool + activeCarry), as string */
    readonly totalPrize: string;
    readonly distributedAt: number;
    /** Block at which distribution was triggered */
    readonly blockNumber: string;
}
