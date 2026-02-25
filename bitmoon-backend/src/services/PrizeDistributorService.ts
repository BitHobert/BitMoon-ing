import { randomUUID } from 'node:crypto';
import type { Collection, Db } from 'mongodb';
import { Address, Wallet } from '@btc-vision/transaction';
import { getContract, type TransactionParameters } from 'opnet';
import { networks } from '@btc-vision/bitcoin';
import { Config } from '../config/Config.js';
import { OPNetService } from './OPNetService.js';
import { TournamentService } from './TournamentService.js';
import { LeaderboardService } from './LeaderboardService.js';
import {
    PRIZE_DISTRIBUTOR_ABI,
    type IPrizeDistributorContract,
} from '../contracts/PrizeDistributorABI.js';
import type { PrizeDistribution, TournamentType } from '../types/index.js';

type DistributionDoc = PrizeDistribution;

/**
 * PrizeDistributorService manages all interactions with the on-chain PrizeDistributor contract.
 *
 * Responsibilities:
 *  1. notifyEntry()   — called after PaymentService verifies a transfer; posts recordEntry() to chain.
 *  2. startWatcher()  — polls for prizeBlock and auto-triggers distributePrize() at the right block.
 *  3. triggerDistribute() — queries top-3 winners from MongoDB, calls distributePrize() on chain.
 */
export class PrizeDistributorService {
    private static instance: PrizeDistributorService;

    private distributions!: Collection<DistributionDoc>;
    private wallet!: Wallet;
    private operatorAddress!: Address;
    private watcherTimer: ReturnType<typeof setTimeout> | null = null;

    private constructor() {}

    public static getInstance(): PrizeDistributorService {
        if (!PrizeDistributorService.instance) {
            PrizeDistributorService.instance = new PrizeDistributorService();
        }
        return PrizeDistributorService.instance;
    }

    // ── Lifecycle ──────────────────────────────────────────────────────────────

    public async connect(db: Db): Promise<void> {
        this.distributions = db.collection<DistributionDoc>('prize_distributions');
        await this.distributions.createIndex(
            { tournamentType: 1, tournamentKey: 1 },
            { unique: true, name: 'unique_distribution_per_period' },
        );

        if (Config.OPERATOR_PRIVATE_KEY) {
            const network = Config.OPNET_NETWORK === 'mainnet'
                ? networks.bitcoin
                : networks.testnet;
            this.wallet = new Wallet(Config.OPERATOR_PRIVATE_KEY, Config.OPERATOR_MLDSA_KEY, network);
            this.operatorAddress = Address.fromString(this.wallet.p2tr);
        }

        console.log('[PrizeDistributorService] Connected');
    }

    /** Start the block-polling loop. Runs indefinitely until stopWatcher() is called. */
    public startWatcher(): void {
        if (!Config.PRIZE_CONTRACT_ADDRESS || !Config.OPERATOR_PRIVATE_KEY) {
            console.warn('[PrizeDistributorService] PRIZE_CONTRACT_ADDRESS or OPERATOR_PRIVATE_KEY not set — watcher disabled');
            return;
        }
        console.log('[PrizeDistributorService] Prize watcher started');
        this.scheduleWatch();
    }

    public stopWatcher(): void {
        if (this.watcherTimer) {
            clearTimeout(this.watcherTimer);
            this.watcherTimer = null;
        }
    }

    // ── Public API ─────────────────────────────────────────────────────────────

    /**
     * Called by ApiServer after a tournament entry payment is verified.
     * Posts recordEntry() to the PrizeDistributor contract so pool accounting is updated on-chain.
     * Non-blocking — errors are logged but not propagated.
     */
    public async notifyEntry(
        tournamentType: TournamentType,
        periodKey: string,
        amountPaid: bigint,
    ): Promise<void> {
        if (!this.isContractReady()) return;

        const typeIndex = this.typeIndex(tournamentType);
        const periodKeyBigInt = BigInt(periodKey);

        try {
            const contract = this.getContract();
            const call = await contract.recordEntry(typeIndex, periodKeyBigInt, amountPaid);
            const txResult = await call.sendTransaction(this.txParams());
            console.log(
                `[PrizeDistributorService] recordEntry tx sent for ${tournamentType}/${periodKey}:`,
                txResult.transactionId,
            );
        } catch (err) {
            console.error('[PrizeDistributorService] recordEntry failed:', err);
        }
    }

    /**
     * Returns all prize distributions, newest first.
     */
    public async getDistributions(
        limit = 20,
        offset = 0,
    ): Promise<PrizeDistribution[]> {
        return this.distributions
            .find({}, { sort: { distributedAt: -1 }, skip: offset, limit })
            .toArray();
    }

    /**
     * Returns the most recent distribution for a tournament type, or null.
     */
    public async getLatestDistribution(type: TournamentType): Promise<PrizeDistribution | null> {
        return this.distributions.findOne(
            { tournamentType: type },
            { sort: { distributedAt: -1 } },
        );
    }

    // ── Watcher internals ──────────────────────────────────────────────────────

    private scheduleWatch(): void {
        this.watcherTimer = setTimeout(async () => {
            try {
                await this.runWatchCycle();
            } catch (err) {
                console.error('[PrizeDistributorService] Watcher error:', err);
            } finally {
                this.scheduleWatch();
            }
        }, Config.PRIZE_WATCHER_INTERVAL_MS);
    }

    private async runWatchCycle(): Promise<void> {
        const provider     = OPNetService.getInstance().getProvider();
        const currentBlock = await provider.getBlockNumber();
        const ts           = TournamentService.getInstance();
        const types: TournamentType[] = ['daily', 'weekly', 'monthly'];

        for (const type of types) {
            const period = ts.computePeriod(type, currentBlock);

            // We are in the distribution window: [prizeBlock, nextStartBlock)
            if (currentBlock >= period.prizeBlock && currentBlock < period.nextStartBlock) {
                const alreadyDone = await this.distributions.countDocuments({
                    tournamentType: type,
                    tournamentKey:  period.tournamentKey,
                }) > 0;

                if (!alreadyDone) {
                    await this.triggerDistribute(type, period.tournamentKey, period.prizeBlock);
                }
            }
        }
    }

    private async triggerDistribute(
        type: TournamentType,
        periodKey: string,
        prizeBlock: bigint,
    ): Promise<void> {
        console.log(`[PrizeDistributorService] Distributing prizes for ${type}/${periodKey}`);

        const top3 = await LeaderboardService.getInstance().getTop3ForTournament(type, periodKey);
        const zero  = Address.dead();

        const w1: Address = top3[0] ? Address.fromString(top3[0].playerAddress) : zero;
        const w2: Address = top3[1] ? Address.fromString(top3[1].playerAddress) : zero;
        const w3: Address = top3[2] ? Address.fromString(top3[2].playerAddress) : zero;

        let txid = '';
        if (this.isContractReady()) {
            try {
                const contract = this.getContract();
                const call = await contract.distributePrize(
                    this.typeIndex(type),
                    BigInt(periodKey),
                    w1, w2, w3,
                );
                const result = await call.sendTransaction(this.txParams());
                txid = result.transactionId;
                console.log(`[PrizeDistributorService] distributePrize tx: ${txid}`);
            } catch (err) {
                console.error('[PrizeDistributorService] distributePrize failed:', err);
                return; // Don't record — will retry next watcher cycle
            }
        }

        // Compute prize amounts from the on-chain pool (use backend DB as approximation)
        const ts = TournamentService.getInstance();
        const currentMainPool  = await ts.getPrizePool(type, periodKey);
        const previousNextPool = await ts.getNextPool(type, periodKey);
        const totalPrize       = currentMainPool + previousNextPool;

        const winners: Array<{ place: 1|2|3; address: string; amount: string }> = [];
        if (top3[0]) {
            const p1 = top3.length === 1 ? totalPrize
                     : top3.length === 2 ? (totalPrize * 80n / 100n)
                     : (totalPrize * 70n / 100n);
            winners.push({ place: 1, address: top3[0].playerAddress, amount: p1.toString() });
        }
        if (top3[1]) {
            const p2 = top3.length === 2
                ? (totalPrize - totalPrize * 80n / 100n)
                : (totalPrize * 20n / 100n);
            winners.push({ place: 2, address: top3[1].playerAddress, amount: p2.toString() });
        }
        if (top3[2]) {
            const p3 = totalPrize - (totalPrize * 70n / 100n) - (totalPrize * 20n / 100n);
            winners.push({ place: 3, address: top3[2].playerAddress, amount: p3.toString() });
        }

        const doc: PrizeDistribution = {
            _id:            randomUUID(),
            tournamentType: type,
            tournamentKey:  periodKey,
            txHash:         txid,
            winners,
            totalPrize:     totalPrize.toString(),
            distributedAt:  Date.now(),
            blockNumber:    prizeBlock.toString(),
        };

        try {
            await this.distributions.insertOne(doc);
        } catch (err) {
            // Unique index violation means another process beat us to it — that's fine
            if ((err as NodeJS.ErrnoException & { code?: number }).code !== 11000) {
                throw err;
            }
        }
    }

    // ── Helpers ────────────────────────────────────────────────────────────────

    private isContractReady(): boolean {
        return !!(Config.PRIZE_CONTRACT_ADDRESS && Config.OPERATOR_PRIVATE_KEY && this.wallet);
    }

    private getContract() {
        const provider = OPNetService.getInstance().getProvider();
        const network  = Config.OPNET_NETWORK === 'mainnet'
            ? networks.bitcoin
            : networks.testnet;

        return getContract<IPrizeDistributorContract>(
            Config.PRIZE_CONTRACT_ADDRESS,
            PRIZE_DISTRIBUTOR_ABI,
            provider,
            network,
            this.operatorAddress,
        );
    }

    private txParams(): TransactionParameters {
        return {
            signer:                   this.wallet.keypair,
            mldsaSigner:              null,
            refundTo:                 Config.OPERATOR_P2TR_ADDRESS || this.wallet.p2tr,
            maximumAllowedSatToSpend: 10_000n,
            feeRate:                  10,
            priorityFee:              0n,
            network:                  Config.OPNET_NETWORK === 'mainnet'
                ? networks.bitcoin
                : networks.testnet,
        };
    }

    private typeIndex(type: TournamentType): number {
        switch (type) {
            case 'daily':   return 0;
            case 'weekly':  return 1;
            case 'monthly': return 2;
        }
    }
}
