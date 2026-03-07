import { randomUUID } from 'node:crypto';
import type { Collection, Db, IndexDescription } from 'mongodb';
import { Config } from '../config/Config.js';
import { OPNetService } from './OPNetService.js';
import type {
    PrizeDistribution,
    TournamentEntry,
    TournamentFeeConfig,
    TournamentInfo,
    TournamentType,
} from '../types/index.js';

type FeeConfigDoc = TournamentFeeConfig;
type EntryDoc     = TournamentEntry;

/**
 * Block-based tournament period for a single tournament type.
 */
export interface TournamentPeriod {
    readonly tournamentKey:  string;  // start block as string (deterministic ID)
    readonly startsAtBlock:  bigint;
    readonly endsAtBlock:    bigint;
    readonly prizeBlock:     bigint;  // endsAtBlock + 1
    readonly nextStartBlock: bigint;  // endsAtBlock + GAP + 1
    readonly isActive:       boolean; // currentBlock is within [startsAtBlock, endsAtBlock]
}

/**
 * TournamentService manages three block-based tournament types (daily, weekly, monthly).
 *
 * Timing (all in OPNet blocks):
 *  - Daily:   140 active blocks, 4-block gap, cycle = 144
 *  - Weekly:  980 active blocks, 4-block gap, cycle = 984
 *  - Monthly: 3920 active blocks, 4-block gap, cycle = 3924
 *
 * Period key = start block number (string).
 * Prize is distributed on prizeBlock = endBlock + 1.
 * Next period starts on nextStartBlock = endBlock + 5.
 *
 * Entry fees are paid in a single developer-configured OP-20 token.
 * Each fee is split: 5 % dev / 15 % next pool / 80 % current prize pool.
 *
 * MongoDB collections:
 *  - tournament_config  — one doc per type holding the configurable entry fee
 *  - tournament_entries — one doc per player entry (with payment proof)
 */
export class TournamentService {
    private static instance: TournamentService;

    private feeConfigs!:    Collection<FeeConfigDoc>;
    private entries!:       Collection<EntryDoc>;
    private distributions!: Collection<PrizeDistribution>;

    private constructor() {}

    public static getInstance(): TournamentService {
        if (!TournamentService.instance) {
            TournamentService.instance = new TournamentService();
        }
        return TournamentService.instance;
    }

    // ── Lifecycle ──────────────────────────────────────────────────────────────

    public async connect(db: Db): Promise<void> {
        this.feeConfigs    = db.collection<FeeConfigDoc>('tournament_config');
        this.entries       = db.collection<EntryDoc>('tournament_entries');
        this.distributions = db.collection<PrizeDistribution>('prize_distributions');

        await this.ensureIndexes();
        await this.seedFeeConfigs();

        console.log('[TournamentService] Connected');
    }

    // ── Block-based timing ─────────────────────────────────────────────────────

    /**
     * Returns the active block counts and cycle length for each tournament type.
     */
    private static durationFor(type: TournamentType): { active: bigint; cycle: bigint } {
        const gap = Config.TOURNAMENT_GAP_BLOCKS;
        switch (type) {
            case 'daily':   return { active: Config.DAILY_ACTIVE_BLOCKS,   cycle: Config.DAILY_ACTIVE_BLOCKS   + gap };
            case 'weekly':  return { active: Config.WEEKLY_ACTIVE_BLOCKS,  cycle: Config.WEEKLY_ACTIVE_BLOCKS  + gap };
            case 'monthly': return { active: Config.MONTHLY_ACTIVE_BLOCKS, cycle: Config.MONTHLY_ACTIVE_BLOCKS + gap };
        }
    }

    /**
     * Compute the tournament period for a given block number and type.
     * Returns the period that was/is active at `currentBlock`,
     * OR the next upcoming period if `currentBlock` falls in the gap.
     */
    public computePeriod(type: TournamentType, currentBlock: bigint): TournamentPeriod {
        const genesis = Config.TOURNAMENT_GENESIS_BLOCK;
        const { active, cycle } = TournamentService.durationFor(type);

        // How far are we from genesis?
        const offset = currentBlock >= genesis ? currentBlock - genesis : 0n;

        // Which cycle number are we in?
        const periodNum = offset / cycle;

        // Start of current period's active window
        const startsAtBlock  = genesis + periodNum * cycle;
        const endsAtBlock    = startsAtBlock + active - 1n;
        const prizeBlock     = endsAtBlock + 1n;
        const nextStartBlock = endsAtBlock + Config.TOURNAMENT_GAP_BLOCKS + 1n;

        const isActive = currentBlock >= startsAtBlock && currentBlock <= endsAtBlock;

        return {
            tournamentKey:  startsAtBlock.toString(),
            startsAtBlock,
            endsAtBlock,
            prizeBlock,
            nextStartBlock,
            isActive,
        };
    }

    /**
     * Returns the previous period's tournament key for a given type and current period key.
     * The previous period started one `cycle` before the current period.
     * Returns null if the current period is the very first one (at genesis).
     */
    public getPreviousPeriodKey(type: TournamentType, currentPeriodKey: string): string | null {
        const currentStart = BigInt(currentPeriodKey);
        const genesis      = Config.TOURNAMENT_GENESIS_BLOCK;
        const { cycle }    = TournamentService.durationFor(type);

        // If current start is at or before genesis, there is no previous period
        if (currentStart <= genesis) return null;

        const prevStart = currentStart - cycle;
        // Guard against underflow — shouldn't happen with properly aligned keys
        if (prevStart < genesis) return null;

        return prevStart.toString();
    }

    /**
     * Fetch the current block from OPNet and compute the tournament period.
     */
    public async getCurrentPeriod(type: TournamentType): Promise<TournamentPeriod> {
        const provider     = OPNetService.getInstance().getProvider();
        const currentBlock = await provider.getBlockNumber();
        return this.computePeriod(type, currentBlock);
    }

    /**
     * Returns the tournament key (start block string) for the current period.
     * Throws if the current block is in the inter-tournament gap.
     */
    public async getTournamentKey(type: TournamentType): Promise<string> {
        const period = await this.getCurrentPeriod(type);
        if (!period.isActive) {
            throw Object.assign(
                new Error(`No active ${type} tournament right now (in gap between periods)`),
                { statusCode: 404 },
            );
        }
        return period.tournamentKey;
    }

    // ── Fee config ─────────────────────────────────────────────────────────────

    public async getFeeConfig(type: TournamentType): Promise<TournamentFeeConfig> {
        const doc = await this.feeConfigs.findOne({ _id: type });
        if (!doc) throw new Error(`Fee config not found for type: ${type}`);
        return doc;
    }

    public async updateFeeConfig(type: TournamentType, amount: string): Promise<void> {
        await this.feeConfigs.updateOne(
            { _id: type },
            { $set: { entryFee: amount, updatedAt: Date.now() } },
        );
    }

    // ── Split helpers ──────────────────────────────────────────────────────────

    /**
     * Compute the 5 / 15 / 80 split from a total amount.
     * All values are floor-divided; prize gets the remainder to avoid rounding loss.
     */
    public computeSplit(amountPaid: bigint): {
        devAmount: bigint;
        nextPoolAmount: bigint;
        prizeAmount: bigint;
    } {
        const devAmount      = (amountPaid * BigInt(Config.ENTRY_FEE_DEV_BPS))       / 10_000n;
        const nextPoolAmount = (amountPaid * BigInt(Config.ENTRY_FEE_NEXT_POOL_BPS)) / 10_000n;
        const prizeAmount    = amountPaid - devAmount - nextPoolAmount;
        return { devAmount, nextPoolAmount, prizeAmount };
    }

    // ── Entry management ───────────────────────────────────────────────────────

    /**
     * Check whether the player has any unused turns for the given period.
     */
    public async hasAvailableTurn(
        playerAddress: string,
        type: TournamentType,
        key: string,
    ): Promise<boolean> {
        const count = await this.entries.countDocuments({
            playerAddress,
            tournamentType: type,
            tournamentKey: key,
            isVerified: true,
            turnsRemaining: { $gt: 0 },
        });
        return count > 0;
    }

    /**
     * Atomically consume one turn from the player's entry.
     * Picks the most recent entry that still has remaining turns.
     * Throws 403 if no turns remain.
     */
    public async consumeTurn(
        playerAddress: string,
        type: TournamentType,
        key: string,
    ): Promise<{ turnsRemaining: number }> {
        const result = await this.entries.findOneAndUpdate(
            {
                playerAddress,
                tournamentType: type,
                tournamentKey: key,
                isVerified: true,
                turnsRemaining: { $gt: 0 },
            },
            { $inc: { turnsRemaining: -1 } },
            { sort: { paidAt: -1 }, returnDocument: 'after' },
        );
        if (!result) {
            throw Object.assign(
                new Error('No turns remaining — purchase more to play again'),
                { statusCode: 403 },
            );
        }
        // Sum remaining across ALL entries for this player/period
        const totalRemaining = await this.getRemainingTurns(playerAddress, type, key);
        return { turnsRemaining: totalRemaining };
    }

    /**
     * Total unused turns across all entries for a player in a given period.
     */
    public async getRemainingTurns(
        playerAddress: string,
        type: TournamentType,
        key: string,
    ): Promise<number> {
        const entries = await this.entries
            .find({
                playerAddress,
                tournamentType: type,
                tournamentKey: key,
                isVerified: true,
            })
            .toArray();
        return entries.reduce(
            (sum, e) => sum + Math.max(0, e.turnsRemaining ?? 0),
            0,
        );
    }

    public async recordEntry(data: Omit<TournamentEntry, '_id'>): Promise<TournamentEntry> {
        const entry: TournamentEntry = { _id: randomUUID(), ...data };
        await this.entries.insertOne(entry);
        return entry;
    }

    public async updateEntryConfirmations(
        txHash: string,
        confirmations: number,
        isVerified: boolean,
    ): Promise<void> {
        await this.entries.updateOne(
            { paymentTxHash: txHash },
            { $set: { confirmations, isVerified } },
        );
    }

    // ── Carryover ─────────────────────────────────────────────────────────────

    /**
     * Compute the total undistributed carryover for a tournament period.
     *
     * Walks backwards through previous periods, summing each period's 15 % nextPool,
     * until it reaches a period that was actually distributed (had winners).
     * This ensures carryover rolls forward across empty periods instead of being lost.
     *
     * Example: Period A (distributed, nextPool=750) → B (empty) → C (empty) → D (current)
     *   → D's carryover = A.nextPool + B.nextPool(0) + C.nextPool(0) = 750
     */
    public async computeCarryover(type: TournamentType, currentPeriodKey: string): Promise<bigint> {
        const MAX_LOOKBACK = 50; // safety limit to prevent runaway walk-backs
        let total = 0n;
        let key: string | null = this.getPreviousPeriodKey(type, currentPeriodKey);
        let iterations = 0;

        while (key !== null && iterations < MAX_LOOKBACK) {
            iterations++;

            // Add this period's 15 % nextPool contribution
            const nextPool = await this.getNextPool(type, key);
            total += nextPool;

            // Check if this period was distributed WITH winners.
            // Empty distributions (0 winners from the old bug) are treated as "not distributed"
            // so carryover continues to accumulate past them.
            const dist = await this.distributions.findOne(
                { tournamentType: type, tournamentKey: key },
                { projection: { winners: 1 } },
            );

            if (dist && dist.winners && dist.winners.length > 0) {
                // This period had a real distribution — its carryover was consumed. Stop here.
                break;
            }

            // No distribution (or empty distribution) — keep walking back
            key = this.getPreviousPeriodKey(type, key);
        }

        return total;
    }

    // ── Aggregations ───────────────────────────────────────────────────────────

    public async getActiveTournaments(): Promise<TournamentInfo[]> {
        const provider     = OPNetService.getInstance().getProvider();
        const currentBlock = await provider.getBlockNumber();
        const types: TournamentType[] = ['daily', 'weekly', 'monthly'];

        return Promise.all(
            types.map(async (type) => {
                const period = this.computePeriod(type, currentBlock);
                const config = await this.getFeeConfig(type);

                // Walk backwards to accumulate all undistributed carryover
                const [currentPool, carryover, nextPool, count] = await Promise.all([
                    this.getPrizePool(type, period.tournamentKey),
                    this.computeCarryover(type, period.tournamentKey),
                    this.getNextPool(type, period.tournamentKey),
                    this.getEntryCount(type, period.tournamentKey),
                ]);
                const totalPrize = currentPool + carryover;

                return {
                    tournamentType:  type,
                    tournamentKey:   period.tournamentKey,
                    entryFee:        config.entryFee,
                    tokenAddress:         Config.ENTRY_TOKEN_ADDRESS,
                    prizeContractAddress: Config.PRIZE_CONTRACT_ADDRESS,
                    prizePool:       totalPrize.toString(),
                    carryover:       carryover.toString(),
                    nextPool:        nextPool.toString(),
                    entrantCount:    count,
                    startsAtBlock:   period.startsAtBlock.toString(),
                    endsAtBlock:     period.endsAtBlock.toString(),
                    prizeBlock:      period.prizeBlock.toString(),
                    nextStartBlock:  period.nextStartBlock.toString(),
                    isActive:        period.isActive,
                } satisfies TournamentInfo;
            }),
        );
    }

    /** Sum of all verified 80 % prize contributions for a period. */
    public async getPrizePool(type: TournamentType, key: string): Promise<bigint> {
        const docs = await this.entries
            .find(
                { tournamentType: type, tournamentKey: key, isVerified: true },
                { projection: { prizeAmount: 1 } },
            )
            .toArray();
        return docs.reduce((acc, doc) => acc + BigInt(doc.prizeAmount), 0n);
    }

    /** Sum of all verified 15 % next-pool contributions for a period. */
    public async getNextPool(type: TournamentType, key: string): Promise<bigint> {
        const docs = await this.entries
            .find(
                { tournamentType: type, tournamentKey: key, isVerified: true },
                { projection: { nextPoolAmount: 1 } },
            )
            .toArray();
        return docs.reduce((acc, doc) => acc + BigInt(doc.nextPoolAmount), 0n);
    }

    public async getEntryCount(type: TournamentType, key: string): Promise<number> {
        return this.entries.countDocuments({
            tournamentType: type,
            tournamentKey: key,
            isVerified: true,
        });
    }

    // ── Private helpers ────────────────────────────────────────────────────────

    private async seedFeeConfigs(): Promise<void> {
        const defaults: Record<TournamentType, bigint> = {
            daily:   Config.DAILY_ENTRY_FEE,
            weekly:  Config.WEEKLY_ENTRY_FEE,
            monthly: Config.MONTHLY_ENTRY_FEE,
        };

        await Promise.all(
            (Object.entries(defaults) as [TournamentType, bigint][]).map(
                ([type, fee]) =>
                    this.feeConfigs.updateOne(
                        { _id: type },
                        {
                            $set: {
                                entryFee:  fee.toString(),
                                updatedAt: Date.now(),
                            },
                        },
                        { upsert: true },
                    ),
            ),
        );
    }

    private async ensureIndexes(): Promise<void> {
        // Drop legacy unique indexes that are now too restrictive.
        // Players can re-enter (multiple payments add to pool), and
        // the same txHash dup is handled gracefully by the API layer.
        for (const name of ['unique_player_per_tournament_period', 'paymentTxHash_1']) {
            try { await this.entries.dropIndex(name); } catch { /* index may not exist */ }
        }

        const entryIndexes: IndexDescription[] = [
            // Non-unique: lookup by player+period (multiple entries allowed)
            { key: { playerAddress: 1, tournamentType: 1, tournamentKey: 1 } },
            // Non-unique: lookup by txHash (dups handled in API layer)
            { key: { paymentTxHash: 1 } },
            // Leaderboard queries
            { key: { isVerified: 1, tournamentType: 1, tournamentKey: 1 } },
        ];
        await this.entries.createIndexes(entryIndexes);
    }
}
