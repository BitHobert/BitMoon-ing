import type { Collection, Db } from 'mongodb';
import { Config } from '../config/Config.js';
import type { SupplySnapshot } from '../types/index.js';

/** Shape of the single global supply document in MongoDB */
interface SupplyDoc {
    readonly _id: 'global';
    currentSupply: string;   // BigInt as string
    totalBurned: string;     // BigInt as string
    sequenceNumber: number;  // Monotonic counter, incremented on every burn
    updatedAt: number;
}

/**
 * GameSupplyService manages the global in-game token supply counter.
 *
 * The supply starts at INITIAL_SUPPLY and is atomically decremented each
 * time a game session ends with validated kills. As supply drops, the
 * scarcity multiplier increases — driving higher scores across all players.
 *
 * This is a pure game mechanic: no on-chain transactions occur.
 */
export class GameSupplyService {
    private static instance: GameSupplyService;

    private collection!: Collection<SupplyDoc>;

    private constructor() {}

    public static getInstance(): GameSupplyService {
        if (!GameSupplyService.instance) {
            GameSupplyService.instance = new GameSupplyService();
        }
        return GameSupplyService.instance;
    }

    // ── Lifecycle ────────────────────────────────────────────────────────────

    /**
     * Initialise the collection and seed the supply document if it doesn't exist.
     * Must be called once at startup before any other method.
     */
    public async connect(db: Db): Promise<void> {
        this.collection = db.collection<SupplyDoc>('game_supply');

        // Seed the global supply document on first boot
        await this.collection.updateOne(
            { _id: 'global' },
            {
                $setOnInsert: {
                    _id: 'global',
                    currentSupply: Config.INITIAL_SUPPLY.toString(),
                    totalBurned: '0',
                    sequenceNumber: 0,
                    updatedAt: Date.now(),
                },
            },
            { upsert: true },
        );

        console.log('[GameSupplyService] Connected — supply initialised');
    }

    // ── Read ─────────────────────────────────────────────────────────────────

    /**
     * Get the current supply snapshot including scarcity multiplier.
     * Fast: single MongoDB document read.
     */
    public async getSnapshot(): Promise<SupplySnapshot> {
        const doc = await this.getDoc();
        const currentSupply = BigInt(doc.currentSupply);
        const totalBurned   = BigInt(doc.totalBurned);

        return {
            currentSupply,
            totalBurned,
            scarcityMultiplier: this.computeMultiplier(currentSupply),
            sequenceNumber: doc.sequenceNumber,
            timestamp: Date.now(),
        };
    }

    /**
     * Get the current supply value to use as the scoring baseline
     * when a new game session starts.
     */
    public async getSupplyAtSessionStart(): Promise<bigint> {
        const doc = await this.getDoc();
        return BigInt(doc.currentSupply);
    }

    // ── Write ────────────────────────────────────────────────────────────────

    /**
     * Atomically reduce the global supply by `amount`.
     * Supply is floored at 0 — it can never go negative.
     *
     * Uses a two-phase approach:
     *  1. $inc sequenceNumber and updatedAt (always)
     *  2. Only decrement if currentSupply as a number > amount (to avoid BigInt in Mongo)
     *
     * Since Mongo doesn't support BigInt natively, we do a read-modify-write
     * with an optimistic loop. Contention is low (end-of-session writes only).
     */
    public async burnSupply(amount: bigint): Promise<void> {
        if (amount <= 0n) return;

        let retries = 5;
        while (retries-- > 0) {
            const doc = await this.getDoc();
            const current = BigInt(doc.currentSupply);
            const next    = current > amount ? current - amount : 0n;
            const burned  = BigInt(doc.totalBurned) + (current - next);

            const result = await this.collection.updateOne(
                { _id: 'global', currentSupply: doc.currentSupply },
                {
                    $set: {
                        currentSupply: next.toString(),
                        totalBurned: burned.toString(),
                        updatedAt: Date.now(),
                    },
                    $inc: { sequenceNumber: 1 },
                },
            );

            if (result.modifiedCount === 1) return;  // success
            // If modifiedCount === 0, another session raced us — retry
        }

        console.error('[GameSupplyService] burnSupply: exceeded retry limit');
    }

    // ── Private helpers ──────────────────────────────────────────────────────

    private async getDoc(): Promise<SupplyDoc> {
        const doc = await this.collection.findOne({ _id: 'global' });
        if (!doc) throw new Error('[GameSupplyService] Supply document missing — was connect() called?');
        return doc;
    }

    /**
     * Scarcity multiplier = initialSupply / currentSupply.
     * Grows as supply is consumed. Capped at 4x.
     */
    private computeMultiplier(currentSupply: bigint): number {
        if (currentSupply <= 0n) return 4.0;
        const ratio = Number(Config.INITIAL_SUPPLY) / Number(currentSupply);
        return Math.min(4.0, ratio);
    }
}
