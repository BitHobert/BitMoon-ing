/**
 * Zod schemas for request body validation on all POST/PATCH endpoints.
 * Replaces ad-hoc manual presence checks with strict runtime validation.
 */
import { z } from 'zod';

// ── Shared enums & primitives ───────────────────────────────────────────────

const TournamentType = z.enum(['daily', 'weekly', 'monthly']);
const LeaderboardPeriod = z.enum(['daily', 'weekly', 'monthly', 'alltime']);
const LeaderboardType = z.enum(['score', 'burned']);
const GameEventType = z.enum(['kill', 'hit', 'miss', 'powerup', 'wave_clear', 'player_death']);
const TierNumber = z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]);
const TxHash = z.string().regex(/^[a-f0-9]{64}$/i, 'Must be 64-char hex hash');
const BigIntString = z.string().regex(/^\d+$/, 'Must be non-negative integer string');
const SponsorPlatform = z.enum(['x', 'telegram', 'website', 'instagram', 'discord', 'youtube']);

// ── GameEvent ───────────────────────────────────────────────────────────────

const GameEvent = z.object({
    tick:        z.number().int().nonnegative(),
    type:        GameEventType,
    tier:        TierNumber.optional(),
    points:      z.number().int().optional(),
    powerupType: z.string().optional(),
    wave:        z.number().int().nonnegative(),
});

// ── POST /v1/session/start ──────────────────────────────────────────────────

export const SessionStartSchema = z.object({
    playerAddress:  z.string().min(1),
    signature:      z.string().min(1),
    message:        z.string().min(1),
    tournamentType: TournamentType.optional(),
    publicKey:      z.string().optional(),
});

// ── POST /v1/session/game ───────────────────────────────────────────────────

export const CreateGameSessionSchema = z.object({
    tournamentType: TournamentType.optional(),
}).optional();

// ── POST /v1/session/end ────────────────────────────────────────────────────

export const SessionEndSchema = z.object({
    sessionId:    z.string().min(1),
    events:       z.array(GameEvent).max(10_000),
    clientScore:  z.number().int().nonnegative(),
    clientBurned: BigIntString,
});

// ── POST /v1/tournament/enter ───────────────────────────────────────────────

export const TournamentEnterSchema = z.object({
    tournamentType: TournamentType,
    txHash:         TxHash,
    quantity:       z.number().int().min(1).max(10).optional(),
});

// ── POST /v1/admin/giveaway/snapshot ────────────────────────────────────────

export const AdminSnapshotSchema = z.object({
    label:  z.string().min(1).max(200),
    period: LeaderboardPeriod,
    type:   LeaderboardType,
    limit:  z.number().int().positive().optional(),
});

// ── PATCH /v1/admin/tournament/:type/fee ────────────────────────────────────

export const AdminUpdateFeeSchema = z.object({
    amount: BigIntString.refine(v => BigInt(v) > 0n, 'Must be positive'),
});

// ── POST /v1/admin/sponsor-bonus ────────────────────────────────────────────

const SponsorLink = z.object({
    platform: SponsorPlatform,
    url:      z.string().url(),
});

const PrizeShare = z.object({
    place:   z.number().int().min(1).max(3),
    percent: z.number().int().min(0).max(100),
});

export const AdminSponsorBonusSchema = z.object({
    tournamentType: TournamentType,
    periodKey:      BigIntString,
    tokenAddress:   z.string().min(1),
    tokenSymbol:    z.string().min(1).max(20),
    amount:         BigIntString.refine(v => BigInt(v) > 0n, 'Must be positive'),
    decimals:       z.number().int().min(0).max(18).optional(),
    links:          z.array(SponsorLink).max(3).optional(),
    prizeShares:    z.array(PrizeShare).max(3)
                        .refine(
                            shares => !shares.length || shares.reduce((s, p) => s + p.percent, 0) === 100,
                            'Prize shares must sum to 100',
                        )
                        .optional(),
});
