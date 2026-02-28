// ─── Shared types (mirrors bitmoon-backend/src/types/index.ts) ────────────────

export type TournamentType = 'daily' | 'weekly' | 'monthly';
export type LeaderboardPeriod = 'daily' | 'weekly' | 'monthly' | 'alltime';
export type LeaderboardType = 'score' | 'burned';
export type BadgeLevel = 'bronze' | 'silver' | 'gold' | 'diamond' | 'lunar';
export type TierNumber = 1 | 2 | 3 | 4 | 5;
export type GameEventType = 'kill' | 'hit' | 'miss' | 'powerup' | 'wave_clear' | 'player_death';
export type WsMessageType = 'supply_update' | 'kill_feed' | 'leaderboard_update' | 'pong';

export interface GameEvent {
  readonly tick: number;
  readonly type: GameEventType;
  readonly tier?: TierNumber;
  readonly powerupType?: string;
  readonly wave: number;
}

export interface LeaderboardEntry {
  readonly rank: number;
  readonly playerAddress: string;
  readonly score: number;
  readonly totalBurned: string;
  readonly wavesCleared: number;
  readonly kills: number;
  readonly achievedAt: number;
  readonly badgeLevel: BadgeLevel;
}

export interface TournamentInfo {
  readonly tournamentType: TournamentType;
  readonly tournamentKey: string;
  readonly entryFee: string;
  readonly tokenAddress: string;
  readonly prizeContractAddress: string;
  readonly prizePool: string;
  readonly nextPool: string;
  readonly entrantCount: number;
  readonly startsAtBlock: string;
  readonly endsAtBlock: string;
  readonly prizeBlock: string;
  readonly nextStartBlock: string;
  readonly isActive: boolean;
  readonly sponsorBonuses?: ReadonlyArray<{ readonly tokenAddress: string; readonly tokenSymbol: string; readonly amount: string }>;
}

export interface PrizeDistribution {
  readonly _id: string;
  readonly tournamentType: TournamentType;
  readonly tournamentKey: string;
  readonly txHash: string;
  readonly winners: ReadonlyArray<{
    readonly place: 1 | 2 | 3;
    readonly address: string;
    readonly amount: string;
  }>;
  readonly totalPrize: string;
  readonly distributedAt: number;
  readonly blockNumber: string;
}

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

export interface SupplySnapshot {
  readonly currentSupply: string;   // bigint as string
  readonly totalBurned: string;
  readonly scarcityMultiplier: number;
  readonly sequenceNumber: number;
  readonly timestamp: number;
}

export interface ScoreResult {
  readonly sessionId: string;
  readonly playerAddress: string;
  readonly validatedScore: number;
  readonly totalBurned: string;
  readonly wavesCleared: number;
  readonly kills: number;
  readonly isValid: boolean;
  readonly rejectionReason?: string;
  readonly tournamentType?: TournamentType;
  readonly tournamentKey?: string;
}

export interface KillFeedEntry {
  readonly playerAddress: string;
  readonly tier: TierNumber;
  readonly points: number;
  readonly scarcityMultiplier: number;
}

export interface WsMessage<T = unknown> {
  readonly type: WsMessageType;
  readonly data: T;
  readonly timestamp: number;
}

// ─── API request/response shapes ─────────────────────────────────────────────

export interface SessionStartRequest {
  readonly playerAddress: string;
  readonly signature: string;
  readonly message: string;
  readonly publicKey?: string;
  readonly tournamentType?: TournamentType;
}

export interface SessionStartResponse {
  readonly sessionId: string;
  readonly token: string;
  readonly expiresAt: number;
}

export interface SessionEndRequest {
  readonly sessionId: string;
  readonly events: GameEvent[];
  readonly clientScore: number;
  readonly clientBurned: string;   // bigint as string
}

export interface TournamentEnterRequest {
  readonly tournamentType: TournamentType;
  readonly txHash: string;
}

export interface TournamentEnterResponse {
  readonly success: boolean;
  readonly entry: {
    readonly id: string;
    readonly tournamentType: TournamentType;
    readonly tournamentKey: string;
  };
  readonly confirmations: number;
  readonly isVerified: boolean;
  readonly message: string;
}

// ─── Sponsor Bonus ──────────────────────────────────────────────────────────

export interface SponsorBonusRequest {
  readonly tournamentType: TournamentType;
  readonly periodKey: string;
  readonly tokenAddress: string;
  readonly tokenSymbol: string;
  readonly amount: string;
}

export interface SponsorBonus {
  readonly _id: string;
  readonly tournamentType: TournamentType;
  readonly tournamentKey: string;
  readonly tokenAddress: string;
  readonly tokenSymbol: string;
  readonly amount: string;
  readonly slotIndex: number;
  readonly txHash: string;
  readonly depositedAt: number;
}
