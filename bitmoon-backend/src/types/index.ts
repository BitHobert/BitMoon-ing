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
    /** Actual points awarded (for kill events — handles bosses vs regular enemies) */
    readonly points?: number;
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
    /** Hex-encoded compressed public key (33 bytes) from the wallet */
    readonly publicKey?: string;
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
    /** Number of game turns purchased in this entry (default 1) */
    readonly turnsTotal: number;
    /** Number of game turns still available (starts at turnsTotal, decremented each game) */
    readonly turnsRemaining: number;
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
    /** Total prize pool = 80 % contributions + carryover from previous period (as string) */
    readonly prizePool: string;
    /** 15 % carryover from the previous period included in prizePool (as string) */
    readonly carryover: string;
    /** Sum of verified 15 % next-pool contributions for this period (as string) */
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
    /** Sponsor bonuses deposited for this tournament period (if any) */
    readonly sponsorBonuses?: ReadonlyArray<{ readonly tokenAddress: string; readonly tokenSymbol: string; readonly amount: string }>;
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
        readonly score: number;             // player's tournament score
    }>;
    /** Total prize distributed (mainPool + activeCarry), as string */
    readonly totalPrize: string;
    readonly distributedAt: number;
    /** Block at which distribution was triggered */
    readonly blockNumber: string;
    /** Native BTC transfer transaction IDs (one per winner, when BTC prizes enabled) */
    readonly btcTxIds?: string[];
    /** OP-20 token transfer transaction IDs (one per winner, when token prizes enabled) */
    readonly tokenTxIds?: string[];
    /** Transaction ID of the 5 % dev cut transfer to DEV_WALLET_ADDRESS (if sent) */
    readonly devCutTxId?: string;
}

// ─── Sponsor Bonus ────────────────────────────────────────────────────────────

/**
 * Request body for POST /v1/admin/sponsor-bonus.
 * The operator must verify the on-chain OP-20 transfer of the bonus tokens
 * to the PrizeDistributor contract before calling this endpoint.
 */
export interface SponsorBonusRequest {
    /** Tournament type receiving the bonus */
    readonly tournamentType: TournamentType;
    /**
     * Period key (start block number as a string).
     * Must be a non-negative integer and must not be an already-distributed period.
     */
    readonly periodKey: string;
    /** OP-20 token contract address of the sponsor's bonus token */
    readonly tokenAddress: string;
    /** Human-readable token ticker symbol (e.g. "MOTO", "tBTC") */
    readonly tokenSymbol: string;
    /** Bonus amount in raw token units (positive integer as string, for BigInt safety) */
    readonly amount: string;
}

/**
 * MongoDB document for a recorded sponsor bonus deposit.
 * Stored in the 'sponsor_bonuses' collection.
 */
export interface SponsorBonus {
    readonly _id: string;                    // UUID v4
    readonly tournamentType: TournamentType;
    /** Period start block — matches tournamentKey in tournament_entries */
    readonly tournamentKey: string;
    /** OP-20 token contract address of the bonus token */
    readonly tokenAddress: string;
    /** Human-readable token ticker symbol (e.g. "MOTO", "tBTC") */
    readonly tokenSymbol: string;
    /** Bonus amount in raw token units, as string */
    readonly amount: string;
    /** On-chain slot index assigned by the contract (0-based) */
    readonly slotIndex: number;
    /** On-chain depositBonus() transaction hash */
    readonly txHash: string;
    readonly depositedAt: number;            // Unix timestamp (ms)
}
