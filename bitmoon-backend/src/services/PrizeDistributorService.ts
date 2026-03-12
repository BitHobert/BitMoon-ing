import { randomUUID } from 'node:crypto';
import type { Collection, Db } from 'mongodb';
import { Address, TransactionFactory, Wallet } from '@btc-vision/transaction';
import type { UTXO } from '@btc-vision/transaction';
import { getContract, type IOP20Contract, OP_20_ABI, type OPNetEvent, type TransactionParameters } from 'opnet';
import { Config } from '../config/Config.js';
import { OPNetService } from './OPNetService.js';
import { TournamentService } from './TournamentService.js';
import { LeaderboardService } from './LeaderboardService.js';
import {
    PRIZE_DISTRIBUTOR_ABI,
    type IPrizeDistributorContract,
    type SponsorBonusDepositedEventData,
} from '../contracts/PrizeDistributorABI.js';
import type { PrizeDistribution, SponsorBonus, TournamentEntry, TournamentType } from '../types/index.js';

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
    private sponsorBonuses!: Collection<SponsorBonus>;
    private entries!: Collection<TournamentEntry>;
    private wallet!: Wallet;
    private operatorAddress!: Address;
    private watcherTimer: ReturnType<typeof setTimeout> | null = null;

    /** Cached contract instances — created once, reused for all calls. */
    private cachedPrizeContract: IPrizeDistributorContract | null = null;
    private cachedTokenContract: IOP20Contract | null = null;

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

        this.entries = db.collection<TournamentEntry>('tournament_entries');

        this.sponsorBonuses = db.collection<SponsorBonus>('sponsor_bonuses');
        await this.sponsorBonuses.createIndex(
            { tournamentType: 1, tournamentKey: 1, slotIndex: 1 },
            { unique: true, name: 'unique_bonus_per_slot' },
        );

        if (Config.OPERATOR_PRIVATE_KEY) {
            this.wallet = new Wallet(Config.OPERATOR_PRIVATE_KEY, Config.OPERATOR_MLDSA_KEY, Config.NETWORK);
            // wallet.address is already an Address object (MLDSA public key hash);
            // Address.fromString() rejects bech32 addresses, so never pass wallet.p2tr.
            this.operatorAddress = this.wallet.address;
        }

        // One-time cleanup: remove distributions with 0 winners (from bug where
        // empty periods consumed carryover instead of rolling it forward).
        // This lets computeCarryover() walk past these periods and recover the tokens.
        const cleaned = await this.distributions.deleteMany({
            $or: [
                { winners: { $size: 0 } },
                { winners: { $exists: false } },
            ],
        });
        if (cleaned.deletedCount > 0) {
            console.log(`[PrizeDistributorService] Cleaned up ${cleaned.deletedCount} empty distribution records (carryover recovered)`);
        }

        console.log('[PrizeDistributorService] Connected');
    }

    /** Start the block-polling loop. Runs indefinitely until stopWatcher() is called. */
    public startWatcher(): void {
        if (!Config.OPERATOR_PRIVATE_KEY) {
            console.warn('[PrizeDistributorService] OPERATOR_PRIVATE_KEY not set — watcher disabled');
            return;
        }
        if (!Config.PRIZE_CONTRACT_ADDRESS) {
            console.log('[PrizeDistributorService] No PRIZE_CONTRACT_ADDRESS — BTC-only prize mode');
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

    /**
     * Returns the most recent N distributions for a tournament type, newest first.
     */
    public async getRecentDistributions(type: TournamentType, limit = 10): Promise<PrizeDistribution[]> {
        return this.distributions
            .find({ tournamentType: type }, { sort: { distributedAt: -1 }, limit })
            .toArray();
    }

    /**
     * Records a sponsor bonus on-chain by calling depositBonus() on the PrizeDistributor contract.
     *
     * The caller is responsible for verifying that `amount` of `tokenAddress` tokens have already
     * been transferred to the contract address on-chain BEFORE calling this method.
     *
     * Throws on validation failure, contract call failure, or DB error.
     * Returns the persisted SponsorBonus document.
     */
    public async depositBonus(
        tournamentType: TournamentType,
        periodKey: string,
        tokenAddress: string,
        tokenSymbol: string,
        amount: bigint,
    ): Promise<SponsorBonus> {
        let txid = '';
        let slotIndex = 0;

        // If on-chain PrizeDistributor contract is deployed, call depositBonus() on-chain.
        // Otherwise, record the bonus in the database only (off-chain mode for testing).
        if (this.isContractReady()) {
            try {
                const periodKeyBigInt = BigInt(periodKey);
                const typeIndex       = this.typeIndex(tournamentType);
                // tokenAddress may be bech32 (opt1s...) or hex (0x...); resolve accordingly.
                const tokenAddr       = tokenAddress.startsWith('0x')
                    ? Address.fromString(tokenAddress)
                    : await this.resolveAddress(tokenAddress, true);

                const contract = this.getContract();
                const call = await contract.depositBonus(typeIndex, periodKeyBigInt, tokenAddr, amount);
                const txResult = await call.sendTransaction(this.txParams());
                txid = txResult.transactionId;

                console.log(
                    `[PrizeDistributorService] depositBonus tx sent for ${tournamentType}/${periodKey}:`,
                    txid,
                );

                // Extract slotIndex from the emitted SponsorBonusDeposited event.
                const events: OPNetEvent<SponsorBonusDepositedEventData>[] = call.events ?? [];
                const depositEvent = events.find(e => e.type === 'SponsorBonusDeposited');
                slotIndex = depositEvent?.properties.slotIndex ?? 0;
            } catch (err) {
                console.warn(
                    `[PrizeDistributorService] On-chain depositBonus failed (recording off-chain):`,
                    (err as Error).message,
                );
                // Fall through to DB-only recording
            }
        } else {
            console.log(`[PrizeDistributorService] No contract configured — recording sponsor bonus off-chain only`);
        }

        // Assign slotIndex from existing bonus count if on-chain didn't provide one
        if (slotIndex === 0) {
            const existing = await this.sponsorBonuses.countDocuments({
                tournamentType, tournamentKey: periodKey,
            });
            slotIndex = existing;
        }

        const doc: SponsorBonus = {
            _id:            randomUUID(),
            tournamentType,
            tournamentKey:  periodKey,
            tokenAddress,
            tokenSymbol,
            amount:         amount.toString(),
            slotIndex,
            txHash:         txid || 'off-chain',
            depositedAt:    Date.now(),
        };

        try {
            await this.sponsorBonuses.insertOne(doc);
        } catch (err) {
            // Unique index violation — duplicate slot (should not happen in normal flow)
            if ((err as NodeJS.ErrnoException & { code?: number }).code !== 11000) throw err;
        }

        return doc;
    }

    /**
     * Returns all sponsor bonuses for a given tournament period, ordered by slot index.
     */
    public async getBonusesForPeriod(
        tournamentType: TournamentType,
        periodKey: string,
    ): Promise<SponsorBonus[]> {
        return this.sponsorBonuses
            .find({ tournamentType, tournamentKey: periodKey }, { sort: { slotIndex: 1 } })
            .toArray();
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
        const currentBlock = await OPNetService.getInstance().getBlockNumber();
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

        if (top3.length === 0) {
            console.log(`[PrizeDistributorService] No players for ${type}/${periodKey} — carryover will roll forward to next period`);
            await this.rollForwardBonuses(type, periodKey);
            // Roll over any purchased-but-unplayed entries to the next period
            try {
                await TournamentService.getInstance().rolloverEntries(type, periodKey);
            } catch (err) {
                console.error('[PrizeDistributorService] Entry rollover failed (empty period):', err);
            }
            return; // Don't record a distribution — carryover accumulates for the next period
        }

        // On-chain distribution (only if prize contract is configured)
        let txid = '';
        if (this.isContractReady()) {
            try {
                const zero  = Address.dead();
                // Player addresses in MongoDB are bech32 (opt1p...) — resolve to MLDSA key hashes.
                const w1: Address = top3[0] ? await this.resolveAddress(top3[0].playerAddress) : zero;
                const w2: Address = top3[1] ? await this.resolveAddress(top3[1].playerAddress) : zero;
                const w3: Address = top3[2] ? await this.resolveAddress(top3[2].playerAddress) : zero;

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
                console.error('[PrizeDistributorService] on-chain distributePrize failed (will still record locally):', err);
                // Continue — still record the distribution in MongoDB
            }
        }

        // Compute prize amounts from the on-chain pool (use backend DB as approximation)
        // Total prize = 80% from THIS period + accumulated 15% carryover from previous periods
        const ts = TournamentService.getInstance();
        const currentMainPool  = await ts.getPrizePool(type, periodKey);
        const carryoverPool    = await ts.computeCarryover(type, periodKey);
        const totalPrize       = currentMainPool + carryoverPool;

        const winners: Array<{ place: 1|2|3; address: string; amount: string; score: number }> = [];
        if (top3[0]) {
            const p1 = top3.length === 1 ? totalPrize
                     : top3.length === 2 ? (totalPrize * 80n / 100n)
                     : (totalPrize * 70n / 100n);
            winners.push({ place: 1, address: top3[0].playerAddress, amount: p1.toString(), score: top3[0].score });
        }
        if (top3[1]) {
            const p2 = top3.length === 2
                ? (totalPrize - totalPrize * 80n / 100n)
                : (totalPrize * 20n / 100n);
            winners.push({ place: 2, address: top3[1].playerAddress, amount: p2.toString(), score: top3[1].score });
        }
        if (top3[2]) {
            const p3 = totalPrize - (totalPrize * 70n / 100n) - (totalPrize * 20n / 100n);
            winners.push({ place: 3, address: top3[2].playerAddress, amount: p3.toString(), score: top3[2].score });
        }

        // ── BTC Prize Distribution ────────────────────────────────────────────
        // Send native BTC to each winner from the operator wallet.
        // Prize amounts are configured in env (BTC_PRIZE_*_SATS) or default to 0.
        const btcTxIds: string[] = [];
        if (Config.BTC_PRIZE_ENABLED && winners.length > 0) {
            try {
                const txIds = await this.sendBTCPrizes(type, winners);
                btcTxIds.push(...txIds);
            } catch (err) {
                console.error('[PrizeDistributorService] BTC prize distribution failed:', err);
            }
        }

        // ── OP-20 Token Prize Distribution ────────────────────────────────────
        // Send LFGT tokens from operator wallet to each winner.
        // Prize amounts are the DB-tracked pool shares (already in raw token units).
        const tokenTxIds: string[] = [];
        if (Config.TOKEN_PRIZE_ENABLED && winners.length > 0) {
            try {
                const txIds = await this.sendTokenPrizes(type, winners);
                tokenTxIds.push(...txIds);
            } catch (err) {
                console.error('[PrizeDistributorService] Token prize distribution failed:', err);
            }
        }

        // ── Dev cut transfer ────────────────────────────────────────────────
        // Send accumulated 5 % dev fees to the separate DEV_WALLET_ADDRESS.
        // Non-blocking — failure does not prevent distribution from being recorded.
        let devCutTxId: string | null = null;
        try {
            devCutTxId = await this.sendDevCut(type, periodKey);
        } catch (err) {
            console.error('[PrizeDistributorService] Dev cut transfer failed:', err);
        }

        const doc: PrizeDistribution = {
            _id:            randomUUID(),
            tournamentType: type,
            tournamentKey:  periodKey,
            txHash:         txid || btcTxIds[0] || tokenTxIds[0] || '',
            winners,
            totalPrize:     totalPrize.toString(),
            distributedAt:  Date.now(),
            blockNumber:    prizeBlock.toString(),
            btcTxIds,
            tokenTxIds,
            ...(devCutTxId ? { devCutTxId } : {}),
        };

        try {
            await this.distributions.insertOne(doc);
        } catch (err) {
            // Unique index violation means another process beat us to it — that's fine
            if ((err as NodeJS.ErrnoException & { code?: number }).code !== 11000) {
                throw err;
            }
        }

        // Roll over unplayed entries to the next period (non-fatal)
        try {
            await TournamentService.getInstance().rolloverEntries(type, periodKey);
        } catch (err) {
            console.error('[PrizeDistributorService] Entry rollover failed:', err);
        }
    }

    // ── BTC Prize Distribution ────────────────────────────────────────────────

    /**
     * Send native BTC to each winner from the operator wallet.
     * Uses TransactionFactory.createBTCTransfer() for each recipient.
     * Returns an array of broadcast transaction IDs.
     */
    private async sendBTCPrizes(
        type: TournamentType,
        winners: Array<{ place: 1|2|3; address: string; amount: string }>,
    ): Promise<string[]> {
        const utxoProvider = OPNetService.getInstance().getLimitedProvider();
        const factory      = new TransactionFactory();
        const fromAddress  = Config.OPERATOR_P2TR_ADDRESS || this.wallet.p2tr;
        const txIds: string[] = [];

        // Determine BTC prize for each place (in satoshis)
        const prizeMap: Record<number, bigint> = {
            1: Config.BTC_PRIZE_1ST_SATS,
            2: Config.BTC_PRIZE_2ND_SATS,
            3: Config.BTC_PRIZE_3RD_SATS,
        };

        // Track remaining UTXOs across sequential transfers
        let currentUtxos: UTXO[] | null = null;

        for (const winner of winners) {
            const prizeSats = prizeMap[winner.place] ?? 0n;
            if (prizeSats <= 0n) continue;

            try {
                // Fetch UTXOs (use change from previous tx if available)
                if (!currentUtxos) {
                    const fetched = await utxoProvider.fetchUTXO({
                        address:         fromAddress,
                        minAmount:       10_000n,
                        requestedAmount: prizeSats + 5_000n, // extra for fees
                    });
                    currentUtxos = fetched;
                }

                const result = await factory.createBTCTransfer({
                    signer:      this.wallet.keypair,
                    mldsaSigner: null,
                    network:     Config.NETWORK,
                    utxos:       currentUtxos,
                    from:        fromAddress,
                    to:          winner.address,
                    amount:      prizeSats,
                    feeRate:     10,
                    priorityFee: 0n,
                    gasSatFee:   0n,
                });

                const broadcast = await utxoProvider.broadcastTransaction(result.tx, false);
                const broadcastTxId = broadcast?.result ?? '';
                txIds.push(broadcastTxId);

                console.log(
                    `[PrizeDistributorService] BTC prize sent: ${type} #${winner.place} → ${winner.address} (${prizeSats} sats) tx: ${broadcastTxId}`,
                );

                // Use change UTXOs for the next transfer
                currentUtxos = result.nextUTXOs;
            } catch (err) {
                console.error(
                    `[PrizeDistributorService] BTC transfer failed for ${type} #${winner.place} → ${winner.address}:`,
                    err,
                );
            }
        }

        return txIds;
    }

    // ── OP-20 Token Prize Distribution ────────────────────────────────────────

    /**
     * Send OP-20 tokens (LFGT) to each winner from the operator wallet.
     * Uses the same token contract as entry fees (Config.ENTRY_TOKEN_ADDRESS).
     *
     * Each winner receives their calculated share of the totalPrize pool.
     * Transfers are sequential to avoid nonce/UTXO conflicts.
     * One failed transfer does NOT block subsequent transfers.
     *
     * Returns an array of transaction IDs (one per successful transfer).
     */
    private async sendTokenPrizes(
        type: TournamentType,
        winners: Array<{ place: 1 | 2 | 3; address: string; amount: string }>,
    ): Promise<string[]> {
        if (!Config.ENTRY_TOKEN_ADDRESS) {
            console.warn('[PrizeDistributorService] No ENTRY_TOKEN_ADDRESS — skipping token prizes');
            return [];
        }

        const txIds: string[] = [];

        // Reuse the cached OP-20 contract instance (created once, stored on the service).
        if (!this.cachedTokenContract) {
            const provider = OPNetService.getInstance().getProvider();
            this.cachedTokenContract = getContract<IOP20Contract>(
                Address.fromString(Config.ENTRY_TOKEN_ADDRESS),
                OP_20_ABI,
                provider,
                Config.NETWORK,
                this.operatorAddress,
            );
        }
        const tokenContract = this.cachedTokenContract;

        for (const winner of winners) {
            const prizeAmount = BigInt(winner.amount);
            if (prizeAmount <= 0n) continue;

            try {
                // Resolve the winner's bech32 address (opt1p...) to an Address object.
                // NEVER use Address.fromString() for bech32 — it only accepts hex.
                const recipientAddress = await this.resolveAddress(winner.address);

                // Simulate the OP-20 transfer
                const sim = await tokenContract.transfer(recipientAddress, prizeAmount);

                // Check for revert (use .revert per OPNet convention, NOT 'error' in sim)
                if (sim.revert) {
                    console.error(
                        `[PrizeDistributorService] Token transfer reverted for ${type} #${winner.place} → ${winner.address}: ${sim.revert}`,
                    );
                    continue;
                }

                // Send the transaction with real backend signing keys
                const receipt = await sim.sendTransaction(this.txParams());
                const txId = receipt.transactionId;
                txIds.push(txId);

                console.log(
                    `[PrizeDistributorService] Token prize sent: ${type} #${winner.place} → ${winner.address} (${prizeAmount} raw units) tx: ${txId}`,
                );
            } catch (err) {
                console.error(
                    `[PrizeDistributorService] Token transfer failed for ${type} #${winner.place} → ${winner.address}:`,
                    err,
                );
                // Continue to next winner — one failure should not block others
            }
        }

        return txIds;
    }

    // ── Dev wallet cut ──────────────────────────────────────────────────────

    /**
     * Send the accumulated 5 % dev cut for a tournament period to the
     * DEV_WALLET_ADDRESS configured in the environment.
     *
     * Sums all `devAmount` fields from verified entries in that period and
     * transfers the total as an OP-20 token transfer from the operator wallet.
     *
     * If DEV_WALLET_ADDRESS is empty or equals the operator address, the cut
     * stays where it is and no transfer is made.
     */
    private async sendDevCut(
        type: TournamentType,
        periodKey: string,
    ): Promise<string | null> {
        const devWallet = Config.DEV_WALLET_ADDRESS;
        if (!devWallet) {
            console.log('[PrizeDistributorService] No DEV_WALLET_ADDRESS set — dev cut stays in operator wallet');
            return null;
        }

        // Don't transfer to yourself (would waste gas)
        const operatorAddr = Config.OPERATOR_P2TR_ADDRESS || this.wallet?.p2tr || '';
        if (devWallet === operatorAddr) {
            console.log('[PrizeDistributorService] DEV_WALLET_ADDRESS matches operator — skipping self-transfer');
            return null;
        }

        if (!Config.ENTRY_TOKEN_ADDRESS) {
            console.warn('[PrizeDistributorService] No ENTRY_TOKEN_ADDRESS — cannot send dev cut');
            return null;
        }

        // Sum all devAmount from verified entries for this period
        const entryCursor = this.entries.find({
            tournamentType: type,
            tournamentKey: periodKey,
            isVerified: true,
        });

        let totalDevCut = 0n;
        for await (const entry of entryCursor) {
            totalDevCut += BigInt(entry.devAmount || '0');
        }

        if (totalDevCut <= 0n) {
            console.log(`[PrizeDistributorService] Dev cut for ${type}/${periodKey} is 0 — nothing to send`);
            return null;
        }

        console.log(
            `[PrizeDistributorService] Sending dev cut: ${totalDevCut} raw units → ${devWallet} (${type}/${periodKey})`,
        );

        try {
            // Reuse cached OP-20 contract
            if (!this.cachedTokenContract) {
                const provider = OPNetService.getInstance().getProvider();
                this.cachedTokenContract = getContract<IOP20Contract>(
                    Address.fromString(Config.ENTRY_TOKEN_ADDRESS),
                    OP_20_ABI,
                    provider,
                    Config.NETWORK,
                    this.operatorAddress,
                );
            }

            const recipientAddress = await this.resolveAddress(devWallet);
            const sim = await this.cachedTokenContract.transfer(recipientAddress, totalDevCut);

            if (sim.revert) {
                console.error(`[PrizeDistributorService] Dev cut transfer reverted: ${sim.revert}`);
                return null;
            }

            const receipt = await sim.sendTransaction(this.txParams());
            console.log(`[PrizeDistributorService] Dev cut sent: tx ${receipt.transactionId}`);
            return receipt.transactionId;
        } catch (err) {
            console.error('[PrizeDistributorService] Dev cut transfer failed:', err);
            return null;
        }
    }

    // ── Sponsor bonus rollforward ────────────────────────────────────────────

    /**
     * When a tournament period ends with zero players, roll any sponsor bonuses
     * forward to the next period so sponsors never lose their deposit.
     */
    private async rollForwardBonuses(type: TournamentType, periodKey: string): Promise<void> {
        const bonuses = await this.sponsorBonuses
            .find({ tournamentType: type, tournamentKey: periodKey })
            .toArray();

        if (bonuses.length === 0) return;

        // Compute the next period's key by adding one full cycle to the current start block
        const { cycle } = TournamentService.durationFor(type);
        const nextKey = (BigInt(periodKey) + cycle).toString();

        // Count existing bonuses in the target period so slotIndexes don't collide
        const existingCount = await this.sponsorBonuses.countDocuments({
            tournamentType: type,
            tournamentKey: nextKey,
        });

        const docs = bonuses.map((b, i) => ({
            _id:            randomUUID(),
            tournamentType: type,
            tournamentKey:  nextKey,
            tokenAddress:   b.tokenAddress,
            tokenSymbol:    b.tokenSymbol,
            amount:         b.amount,
            slotIndex:      existingCount + i,
            txHash:         'rolled-forward',
            depositedAt:    Date.now(),
        }));

        await this.sponsorBonuses.insertMany(docs);
        console.log(
            `[PrizeDistributorService] Rolled forward ${bonuses.length} sponsor bonus(es) from ${type}/${periodKey} → ${type}/${nextKey}`,
        );
    }

    // ── Helpers ────────────────────────────────────────────────────────────────

    /**
     * Resolve a bech32 address to an Address object (MLDSA public key hash).
     * Address.fromString() only accepts hex public keys, so we must look up the
     * key hash on-chain via getPublicKeyInfo().
     *
     * @param bech32Address  An opt1p... (wallet) or opt1s... (contract) address
     * @param isContract     True for P2OP contract addresses (opt1s...), false for wallets
     */
    private async resolveAddress(bech32Address: string, isContract = false): Promise<Address> {
        const provider = OPNetService.getInstance().getProvider();
        const addr = await provider.getPublicKeyInfo(bech32Address, isContract);
        if (!addr) {
            throw new Error(`Could not resolve address: ${bech32Address}`);
        }
        return addr;
    }

    private isContractReady(): boolean {
        return !!(Config.PRIZE_CONTRACT_ADDRESS && Config.OPERATOR_PRIVATE_KEY && this.wallet);
    }

    private getContract(): IPrizeDistributorContract {
        if (!this.cachedPrizeContract) {
            const provider = OPNetService.getInstance().getProvider();
            this.cachedPrizeContract = getContract<IPrizeDistributorContract>(
                Config.PRIZE_CONTRACT_ADDRESS,
                PRIZE_DISTRIBUTOR_ABI,
                provider,
                Config.NETWORK,
                this.operatorAddress,
            );
        }
        return this.cachedPrizeContract;
    }

    private txParams(): TransactionParameters {
        return {
            signer:                   this.wallet.keypair,
            mldsaSigner:              this.wallet.mldsaKeypair ?? null,
            refundTo:                 Config.OPERATOR_P2TR_ADDRESS || this.wallet.p2tr,
            maximumAllowedSatToSpend: 10_000n,
            feeRate:                  10,
            priorityFee:              0n,
            network:                  Config.NETWORK,
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
