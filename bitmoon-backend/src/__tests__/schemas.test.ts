import { describe, it, expect } from 'vitest';
import {
    SessionStartSchema,
    CreateGameSessionSchema,
    SessionEndSchema,
    TournamentEnterSchema,
    AdminSnapshotSchema,
    AdminUpdateFeeSchema,
    AdminSponsorBonusSchema,
} from '../validators/schemas.js';

// ── SessionStartSchema ──────────────────────────────────────────────────────

describe('SessionStartSchema', () => {
    it('accepts valid body', () => {
        const result = SessionStartSchema.safeParse({
            playerAddress: 'opt1pabc123',
            signature: 'dGVzdA==',
            message: 'Sign to play',
        });
        expect(result.success).toBe(true);
    });

    it('accepts with optional fields', () => {
        const result = SessionStartSchema.safeParse({
            playerAddress: 'opt1pabc123',
            signature: 'dGVzdA==',
            message: 'Sign to play',
            tournamentType: 'daily',
            publicKey: 'abcdef1234567890',
        });
        expect(result.success).toBe(true);
    });

    it('rejects missing playerAddress', () => {
        const result = SessionStartSchema.safeParse({
            signature: 'dGVzdA==',
            message: 'Sign to play',
        });
        expect(result.success).toBe(false);
    });

    it('rejects empty signature', () => {
        const result = SessionStartSchema.safeParse({
            playerAddress: 'opt1pabc123',
            signature: '',
            message: 'Sign to play',
        });
        expect(result.success).toBe(false);
    });

    it('rejects invalid tournamentType', () => {
        const result = SessionStartSchema.safeParse({
            playerAddress: 'opt1pabc123',
            signature: 'dGVzdA==',
            message: 'Sign to play',
            tournamentType: 'hourly',
        });
        expect(result.success).toBe(false);
    });
});

// ── CreateGameSessionSchema ─────────────────────────────────────────────────

describe('CreateGameSessionSchema', () => {
    it('accepts empty body (undefined)', () => {
        const result = CreateGameSessionSchema.safeParse(undefined);
        expect(result.success).toBe(true);
    });

    it('accepts empty object', () => {
        const result = CreateGameSessionSchema.safeParse({});
        expect(result.success).toBe(true);
    });

    it('accepts with tournamentType', () => {
        const result = CreateGameSessionSchema.safeParse({ tournamentType: 'weekly' });
        expect(result.success).toBe(true);
    });

    it('rejects invalid tournamentType', () => {
        const result = CreateGameSessionSchema.safeParse({ tournamentType: 'biweekly' });
        expect(result.success).toBe(false);
    });
});

// ── SessionEndSchema ────────────────────────────────────────────────────────

describe('SessionEndSchema', () => {
    it('accepts valid body', () => {
        const result = SessionEndSchema.safeParse({
            sessionId: 'abc-123',
            events: [
                { tick: 0, type: 'kill', tier: 1, points: 100, wave: 1 },
                { tick: 1, type: 'player_death', wave: 1 },
            ],
            clientScore: 100,
            clientBurned: '100000000',
        });
        expect(result.success).toBe(true);
    });

    it('rejects missing sessionId', () => {
        const result = SessionEndSchema.safeParse({
            events: [],
            clientScore: 0,
            clientBurned: '0',
        });
        expect(result.success).toBe(false);
    });

    it('rejects negative clientScore', () => {
        const result = SessionEndSchema.safeParse({
            sessionId: 'abc',
            events: [],
            clientScore: -1,
            clientBurned: '0',
        });
        expect(result.success).toBe(false);
    });

    it('rejects non-integer clientScore', () => {
        const result = SessionEndSchema.safeParse({
            sessionId: 'abc',
            events: [],
            clientScore: 100.5,
            clientBurned: '0',
        });
        expect(result.success).toBe(false);
    });

    it('rejects clientBurned with non-numeric string', () => {
        const result = SessionEndSchema.safeParse({
            sessionId: 'abc',
            events: [],
            clientScore: 0,
            clientBurned: 'not-a-number',
        });
        expect(result.success).toBe(false);
    });

    it('rejects negative clientBurned', () => {
        const result = SessionEndSchema.safeParse({
            sessionId: 'abc',
            events: [],
            clientScore: 0,
            clientBurned: '-100',
        });
        expect(result.success).toBe(false);
    });

    it('rejects invalid event type', () => {
        const result = SessionEndSchema.safeParse({
            sessionId: 'abc',
            events: [{ tick: 0, type: 'explode', wave: 1 }],
            clientScore: 0,
            clientBurned: '0',
        });
        expect(result.success).toBe(false);
    });

    it('rejects invalid tier number', () => {
        const result = SessionEndSchema.safeParse({
            sessionId: 'abc',
            events: [{ tick: 0, type: 'kill', tier: 99, wave: 1 }],
            clientScore: 0,
            clientBurned: '0',
        });
        expect(result.success).toBe(false);
    });

    it('rejects negative tick', () => {
        const result = SessionEndSchema.safeParse({
            sessionId: 'abc',
            events: [{ tick: -1, type: 'kill', tier: 1, wave: 1 }],
            clientScore: 0,
            clientBurned: '0',
        });
        expect(result.success).toBe(false);
    });
});

// ── TournamentEnterSchema ───────────────────────────────────────────────────

describe('TournamentEnterSchema', () => {
    const validTxHash = 'a'.repeat(64);

    it('accepts valid body', () => {
        const result = TournamentEnterSchema.safeParse({
            tournamentType: 'daily',
            txHash: validTxHash,
        });
        expect(result.success).toBe(true);
    });

    it('accepts with quantity', () => {
        const result = TournamentEnterSchema.safeParse({
            tournamentType: 'monthly',
            txHash: validTxHash,
            quantity: 5,
        });
        expect(result.success).toBe(true);
    });

    it('rejects invalid txHash (too short)', () => {
        const result = TournamentEnterSchema.safeParse({
            tournamentType: 'daily',
            txHash: 'abc',
        });
        expect(result.success).toBe(false);
    });

    it('rejects invalid txHash (non-hex)', () => {
        const result = TournamentEnterSchema.safeParse({
            tournamentType: 'daily',
            txHash: 'g'.repeat(64), // 'g' is not hex
        });
        expect(result.success).toBe(false);
    });

    it('rejects txHash with special characters', () => {
        const result = TournamentEnterSchema.safeParse({
            tournamentType: 'daily',
            txHash: 'a'.repeat(63) + '!',
        });
        expect(result.success).toBe(false);
    });

    it('rejects quantity > 10', () => {
        const result = TournamentEnterSchema.safeParse({
            tournamentType: 'daily',
            txHash: validTxHash,
            quantity: 11,
        });
        expect(result.success).toBe(false);
    });

    it('rejects quantity < 1', () => {
        const result = TournamentEnterSchema.safeParse({
            tournamentType: 'daily',
            txHash: validTxHash,
            quantity: 0,
        });
        expect(result.success).toBe(false);
    });

    it('accepts case-insensitive hex', () => {
        const result = TournamentEnterSchema.safeParse({
            tournamentType: 'daily',
            txHash: 'aAbBcCdDeEfF'.repeat(5) + 'aabb',
        });
        expect(result.success).toBe(true);
    });
});

// ── AdminSnapshotSchema ─────────────────────────────────────────────────────

describe('AdminSnapshotSchema', () => {
    it('accepts valid body', () => {
        const result = AdminSnapshotSchema.safeParse({
            label: 'weekly-giveaway-1',
            period: 'weekly',
            type: 'score',
        });
        expect(result.success).toBe(true);
    });

    it('accepts with optional limit', () => {
        const result = AdminSnapshotSchema.safeParse({
            label: 'test',
            period: 'alltime',
            type: 'burned',
            limit: 50,
        });
        expect(result.success).toBe(true);
    });

    it('rejects label > 200 chars', () => {
        const result = AdminSnapshotSchema.safeParse({
            label: 'x'.repeat(201),
            period: 'daily',
            type: 'score',
        });
        expect(result.success).toBe(false);
    });

    it('rejects invalid period', () => {
        const result = AdminSnapshotSchema.safeParse({
            label: 'test',
            period: 'yearly',
            type: 'score',
        });
        expect(result.success).toBe(false);
    });

    it('rejects invalid type', () => {
        const result = AdminSnapshotSchema.safeParse({
            label: 'test',
            period: 'daily',
            type: 'kills',
        });
        expect(result.success).toBe(false);
    });
});

// ── AdminUpdateFeeSchema ────────────────────────────────────────────────────

describe('AdminUpdateFeeSchema', () => {
    it('accepts valid positive BigInt string', () => {
        const result = AdminUpdateFeeSchema.safeParse({ amount: '1000000000' });
        expect(result.success).toBe(true);
    });

    it('rejects zero amount', () => {
        const result = AdminUpdateFeeSchema.safeParse({ amount: '0' });
        expect(result.success).toBe(false);
    });

    it('rejects non-numeric string', () => {
        const result = AdminUpdateFeeSchema.safeParse({ amount: 'abc' });
        expect(result.success).toBe(false);
    });

    it('rejects negative amount', () => {
        const result = AdminUpdateFeeSchema.safeParse({ amount: '-100' });
        expect(result.success).toBe(false);
    });

    it('rejects amount as number type', () => {
        const result = AdminUpdateFeeSchema.safeParse({ amount: 1000 });
        expect(result.success).toBe(false);
    });
});

// ── AdminSponsorBonusSchema ─────────────────────────────────────────────────

describe('AdminSponsorBonusSchema', () => {
    const validBonus = {
        tournamentType: 'daily',
        periodKey: '100',
        tokenAddress: '0xabc123',
        tokenSymbol: 'MOTO',
        amount: '1000000000',
    };

    it('accepts valid body', () => {
        const result = AdminSponsorBonusSchema.safeParse(validBonus);
        expect(result.success).toBe(true);
    });

    it('accepts with all optional fields', () => {
        const result = AdminSponsorBonusSchema.safeParse({
            ...validBonus,
            decimals: 8,
            links: [{ platform: 'x', url: 'https://x.com/sponsor' }],
            prizeShares: [
                { place: 1, percent: 70 },
                { place: 2, percent: 20 },
                { place: 3, percent: 10 },
            ],
        });
        expect(result.success).toBe(true);
    });

    it('rejects prizeShares not summing to 100', () => {
        const result = AdminSponsorBonusSchema.safeParse({
            ...validBonus,
            prizeShares: [
                { place: 1, percent: 50 },
                { place: 2, percent: 30 },
            ],
        });
        expect(result.success).toBe(false);
    });

    it('rejects zero amount', () => {
        const result = AdminSponsorBonusSchema.safeParse({
            ...validBonus,
            amount: '0',
        });
        expect(result.success).toBe(false);
    });

    it('rejects tokenSymbol > 20 chars', () => {
        const result = AdminSponsorBonusSchema.safeParse({
            ...validBonus,
            tokenSymbol: 'A'.repeat(21),
        });
        expect(result.success).toBe(false);
    });

    it('rejects invalid link platform', () => {
        const result = AdminSponsorBonusSchema.safeParse({
            ...validBonus,
            links: [{ platform: 'tiktok', url: 'https://tiktok.com/sponsor' }],
        });
        expect(result.success).toBe(false);
    });

    it('rejects invalid link URL', () => {
        const result = AdminSponsorBonusSchema.safeParse({
            ...validBonus,
            links: [{ platform: 'x', url: 'not-a-url' }],
        });
        expect(result.success).toBe(false);
    });

    it('rejects > 3 links', () => {
        const result = AdminSponsorBonusSchema.safeParse({
            ...validBonus,
            links: [
                { platform: 'x', url: 'https://x.com/1' },
                { platform: 'telegram', url: 'https://t.me/2' },
                { platform: 'website', url: 'https://example.com/3' },
                { platform: 'discord', url: 'https://discord.gg/4' },
            ],
        });
        expect(result.success).toBe(false);
    });

    it('rejects decimals > 18', () => {
        const result = AdminSponsorBonusSchema.safeParse({
            ...validBonus,
            decimals: 19,
        });
        expect(result.success).toBe(false);
    });
});
