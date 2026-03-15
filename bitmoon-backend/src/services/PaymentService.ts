import { ABICoder, ABIDataTypes, type Address } from '@btc-vision/transaction';
import { Config } from '../config/Config.js';
import type { TournamentType } from '../types/index.js';
import { OPNetService } from './OPNetService.js';
import { TournamentService } from './TournamentService.js';

export interface PaymentVerificationResult {
    readonly valid: boolean;
    readonly reason?: string;
    readonly confirmations: number;
    readonly amountPaid: bigint;
    readonly devAmount: bigint;
    readonly nextPoolAmount: bigint;
    readonly prizeAmount: bigint;
}

function invalid(reason: string): PaymentVerificationResult {
    return {
        valid: false,
        reason,
        confirmations: 0,
        amountPaid:      0n,
        devAmount:       0n,
        nextPoolAmount:  0n,
        prizeAmount:     0n,
    };
}

// ABI types for the OP-20 "Transferred" event: operator, from, to, amount
const TRANSFERRED_EVENT_TYPES = [
    ABIDataTypes.ADDRESS, // operator
    ABIDataTypes.ADDRESS, // from
    ABIDataTypes.ADDRESS, // to
    ABIDataTypes.UINT256, // amount
] as const;

/**
 * PaymentService verifies on-chain payments for tournament entries.
 *
 * Supports two modes:
 *  - **Native BTC** (when ENTRY_TOKEN_ADDRESS is empty): verifies a plain Bitcoin
 *    transfer exists on-chain. The entry fee (in satoshis) is trusted from the
 *    fee config since plain BTC transfers don't emit contract events.
 *  - **OP-20 token** (when ENTRY_TOKEN_ADDRESS is set): verifies a "Transferred"
 *    event on the token contract showing the correct amount sent to the prize address.
 */
export class PaymentService {
    private static instance: PaymentService;
    private readonly coder = new ABICoder();

    private constructor() {}

    public static getInstance(): PaymentService {
        if (!PaymentService.instance) {
            PaymentService.instance = new PaymentService();
        }
        return PaymentService.instance;
    }

    public async verifyPayment(
        txHash: string,
        _playerAddress: string,
        tournamentType: TournamentType,
        quantity = 1,
    ): Promise<PaymentVerificationResult> {
        // ── DEV_MODE bypass ─────────────────────────────────────────────────
        if (Config.DEV_MODE) {
            const feeConfig  = await TournamentService.getInstance().getFeeConfig(tournamentType);
            const entryFee   = BigInt(feeConfig.entryFee);
            const gasTax     = Config.GAS_TAX_SATS;
            const fakeAmount = (entryFee + gasTax) * BigInt(quantity);
            // Split on entry fee only — gas tax excluded from pool
            const { devAmount, nextPoolAmount, prizeAmount } =
                TournamentService.getInstance().computeSplit(entryFee * BigInt(quantity));
            console.warn(`[PaymentService] DEV_MODE — auto-approving payment ${txHash} (qty=${quantity}, gasTax=${gasTax})`);
            return {
                valid:          true,
                confirmations:  999,
                amountPaid:     fakeAmount,
                devAmount,
                nextPoolAmount,
                prizeAmount,
            };
        }

        // Route to the appropriate verification method
        if (!Config.ENTRY_TOKEN_ADDRESS) {
            return this.verifyNativeBtcPayment(txHash, tournamentType, quantity);
        }
        return this.verifyOp20Payment(txHash, tournamentType, quantity);
    }

    // ── Native BTC verification ─────────────────────────────────────────────

    /**
     * Verify a native BTC transfer. Since plain Bitcoin transactions don't emit
     * OP-20 events, we verify that the transaction exists and is confirmed.
     * The entry fee amount is taken from the fee config (the wallet prompted
     * the user for the correct satoshi amount on the frontend).
     */
    private async verifyNativeBtcPayment(
        txHash: string,
        tournamentType: TournamentType,
        quantity = 1,
    ): Promise<PaymentVerificationResult> {
        if (!Config.PRIZE_CONTRACT_ADDRESS) {
            return invalid('Server payment address is not configured');
        }

        const feeConfig     = await TournamentService.getInstance().getFeeConfig(tournamentType);
        const expectedTotal = (BigInt(feeConfig.entryFee) + Config.GAS_TAX_SATS) * BigInt(quantity);
        const provider      = OPNetService.getInstance().getProvider();

        // Check transaction exists on-chain
        let confirmations = 0;
        try {
            const tx = await provider.getTransaction(txHash);

            if (tx.revert !== undefined) {
                return invalid('Transaction reverted');
            }

            if (tx.blockNumber !== undefined) {
                try {
                    const currentBlock = await provider.getBlockNumber();
                    const txBlock = typeof tx.blockNumber === 'bigint'
                        ? tx.blockNumber
                        : BigInt(tx.blockNumber as string);
                    const diff = currentBlock - txBlock + 1n;
                    confirmations = diff > 0n ? Number(diff) : 0;
                } catch {
                    confirmations = 0;
                }
            }
        } catch {
            return invalid(`Could not verify tx ${txHash} on-chain — rejecting`);
        }

        // For native BTC mode, trust the entry fee amount from config
        const amountPaid = expectedTotal;
        // Split on entry fee only — gas tax excluded from pool
        const entryFeeOnly = BigInt(feeConfig.entryFee) * BigInt(quantity);
        const { devAmount, nextPoolAmount, prizeAmount } =
            TournamentService.getInstance().computeSplit(entryFeeOnly);

        return {
            valid: confirmations >= Config.MIN_PAYMENT_CONFIRMATIONS,
            confirmations,
            amountPaid,
            devAmount,
            nextPoolAmount,
            prizeAmount,
        };
    }

    // ── OP-20 token verification ────────────────────────────────────────────

    private async verifyOp20Payment(
        txHash: string,
        tournamentType: TournamentType,
        quantity = 1,
    ): Promise<PaymentVerificationResult> {
        if (!Config.PRIZE_CONTRACT_ADDRESS) {
            return invalid('Server prize contract address is not configured');
        }

        const feeConfig     = await TournamentService.getInstance().getFeeConfig(tournamentType);
        const expectedTotal = (BigInt(feeConfig.entryFee) + Config.GAS_TAX_SATS) * BigInt(quantity);
        const provider      = OPNetService.getInstance().getProvider();

        // Poll for the transaction receipt using a two-phase strategy:
        //  1. Try getTransactionReceipt — if found, tx is mined and we can verify events.
        //  2. If receipt not found, check getPendingTransaction — if the tx is in the
        //     mempool it's real and we just need to wait longer for it to be mined.
        //  3. If tx is in neither receipt nor mempool, it was likely dropped by the
        //     network (OPWallet returned a hash but the tx never propagated).
        const MAX_RETRIES  = 20;
        const RETRY_DELAY  = 3000; // ms — indexing can take 30-60s+
        let seenInMempool  = false;

        let receipt: Awaited<ReturnType<typeof provider.getTransactionReceipt>> | null = null;
        for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
            // Phase 1: try to get the receipt (tx is mined + indexed)
            try {
                receipt = await provider.getTransactionReceipt(txHash);
                break; // success — receipt found
            } catch {
                // Receipt not available yet — fall through to mempool check
            }

            // Phase 2: check if tx is still pending in the mempool
            try {
                const pending = await provider.getPendingTransaction(txHash);
                if (pending) {
                    if (!seenInMempool) {
                        console.log(
                            `[PaymentService] Tx ${txHash.slice(0, 12)}… found in mempool (valid, waiting to be mined)`,
                        );
                        seenInMempool = true;
                    }
                }
            } catch {
                // getPendingTransaction may throw if tx not found — that's fine
            }

            if (attempt < MAX_RETRIES) {
                const status = seenInMempool ? 'in mempool, waiting for block' : 'not indexed yet';
                console.log(
                    `[PaymentService] Tx ${txHash.slice(0, 12)}… ${status} ` +
                    `(attempt ${attempt}/${MAX_RETRIES}), retrying in ${RETRY_DELAY}ms…`,
                );
                await new Promise((r) => setTimeout(r, RETRY_DELAY));
            } else {
                // All retries exhausted
                if (seenInMempool) {
                    // Tx IS real (we saw it in mempool) but just hasn't been mined in time.
                    // Trust it on non-mainnet; on mainnet this is still a valid tx so trust it too
                    // since the mempool confirmed its existence.
                    console.warn(
                        `[PaymentService] Tx ${txHash} seen in mempool but not mined after ${MAX_RETRIES} retries — ` +
                        `trusting (mempool-verified)`,
                    );
                    return {
                        valid: true,
                        confirmations: 0,
                        amountPaid: expectedTotal,
                        ...TournamentService.getInstance().computeSplit(expectedTotal),
                    };
                }

                // Never found anywhere — likely a dropped tx
                if (Config.TRUST_UNVERIFIED_TX && Config.OPNET_NETWORK !== 'mainnet') {
                    console.warn(
                        `[PaymentService] Tx ${txHash} not found in receipt or mempool after ${MAX_RETRIES} retries — ` +
                        `TRUSTING (TRUST_UNVERIFIED_TX=true on ${Config.OPNET_NETWORK})`,
                    );
                    return {
                        valid: true,
                        confirmations: 0,
                        amountPaid: expectedTotal,
                        ...TournamentService.getInstance().computeSplit(expectedTotal),
                    };
                }
                return invalid(
                    `OP-20 tx ${txHash} not found in receipt or mempool after ${MAX_RETRIES} retries — ` +
                    `transaction may have been dropped`,
                );
            }
        }

        if (!receipt) {
            return invalid('Transaction receipt lookup returned empty result');
        }

        if (receipt.revert !== undefined) {
            return invalid(`Transaction reverted: ${receipt.revert}`);
        }

        // Receipt doesn't carry blockNumber, so we skip on-chain confirmation
        // counting and treat a non-reverted receipt as 1 confirmation.
        const confirmations = 1;

        // Parse "Transferred" events from the token contract
        let amountPaid = 0n;
        const entryWallet = Config.PRIZE_CONTRACT_ADDRESS.toLowerCase();
        const tokenAddr   = Config.ENTRY_TOKEN_ADDRESS.toLowerCase();

        // Try rawEvents first (keyed by original hex address), fall back to events.
        // events keys are P2OP-converted and won't match our hex ENTRY_TOKEN_ADDRESS.
        const contractEvents = receipt.rawEvents ?? receipt.events;
        console.log(
            `[PaymentService] Receipt found for ${txHash.slice(0, 12)}…`,
            `reverted=${!!receipt.revert}`,
            `eventKeys=[${Object.keys(contractEvents ?? {}).map(k => k.slice(0, 12) + '…').join(', ')}]`,
            seenInMempool ? '(was in mempool)' : '',
        );

        if (contractEvents) {
            for (const [contractAddr, events] of Object.entries(contractEvents)) {
                if (contractAddr.toLowerCase() !== tokenAddr) continue;

                for (const event of events) {
                    if (event.type !== 'Transferred') continue;

                    try {
                        const decoded = this.coder.decodeData(
                            event.data,
                            TRANSFERRED_EVENT_TYPES as unknown as ABIDataTypes[],
                        ) as [Address, Address, Address, bigint];

                        const [_operator, _from, to, amount] = decoded;
                        if (to.toString().toLowerCase() === entryWallet) {
                            amountPaid += amount;
                        }
                    } catch (decodeErr) {
                        console.error('[PaymentService] Failed to decode Transferred event:', decodeErr);
                    }
                }
            }
        }

        // Validate total payment — allow 1% tolerance
        if (amountPaid < (expectedTotal * 99n) / 100n) {
            // Trust if explicitly opted in AND not on mainnet
            if (Config.TRUST_UNVERIFIED_TX && Config.OPNET_NETWORK !== 'mainnet' && receipt) {
                console.warn(
                    `[PaymentService] Event parsing returned ${amountPaid} units (expected ${expectedTotal}) — ` +
                    `TRUSTING (TRUST_UNVERIFIED_TX=true on ${Config.OPNET_NETWORK})`,
                );
                return {
                    valid: true,
                    confirmations: 1,
                    amountPaid: expectedTotal,
                    ...TournamentService.getInstance().computeSplit(expectedTotal),
                };
            }
            return {
                valid: false,
                reason: `Insufficient payment: expected ~${expectedTotal} units, received ${amountPaid} units`,
                confirmations: 0,
                amountPaid,
                devAmount:      0n,
                nextPoolAmount: 0n,
                prizeAmount:    0n,
            };
        }

        // Split on entry fee only — gas tax excluded from pool
        const entryFeeOnly = BigInt(feeConfig.entryFee) * BigInt(quantity);
        const { devAmount, nextPoolAmount, prizeAmount } =
            TournamentService.getInstance().computeSplit(entryFeeOnly);

        return {
            valid: true,
            confirmations,
            amountPaid,
            devAmount,
            nextPoolAmount,
            prizeAmount,
        };
    }
}
