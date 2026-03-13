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
            const fakeAmount = BigInt(feeConfig.entryFee) * BigInt(quantity);
            const { devAmount, nextPoolAmount, prizeAmount } =
                TournamentService.getInstance().computeSplit(fakeAmount);
            console.warn(`[PaymentService] DEV_MODE — auto-approving payment ${txHash} (qty=${quantity})`);
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
        const expectedTotal = BigInt(feeConfig.entryFee) * BigInt(quantity);
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
            if (Config.OPNET_NETWORK === 'mainnet') {
                return invalid(`Could not verify tx ${txHash} on-chain — rejecting (mainnet)`);
            }
            // Testnet/regtest: RPC may not index plain BTC transactions.
            console.warn(`[PaymentService] Could not fetch tx ${txHash} via OPNet RPC — accepting on trust (${Config.OPNET_NETWORK})`);
            confirmations = 1;
        }

        // For native BTC mode, trust the entry fee amount from config
        const amountPaid = expectedTotal;
        const { devAmount, nextPoolAmount, prizeAmount } =
            TournamentService.getInstance().computeSplit(amountPaid);

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
        const expectedTotal = BigInt(feeConfig.entryFee) * BigInt(quantity);
        const provider      = OPNetService.getInstance().getProvider();

        // The transaction may not be indexed yet (just broadcast, still in mempool).
        // Retry a few times with short delays before falling back to trust mode.
        const MAX_RETRIES  = 3;
        const RETRY_DELAY  = 2500; // ms

        let tx: Awaited<ReturnType<typeof provider.getTransaction>> | null = null;
        for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
            try {
                tx = await provider.getTransaction(txHash);
                break;
            } catch (err) {
                if (attempt < MAX_RETRIES) {
                    console.log(
                        `[PaymentService] Tx ${txHash.slice(0, 12)}… not indexed yet ` +
                        `(attempt ${attempt}/${MAX_RETRIES}), retrying in ${RETRY_DELAY}ms…`,
                    );
                    await new Promise((r) => setTimeout(r, RETRY_DELAY));
                } else {
                    if (Config.OPNET_NETWORK === 'mainnet') {
                        return invalid(
                            `Could not verify OP-20 tx ${txHash} after ${MAX_RETRIES} retries — rejecting (mainnet)`,
                        );
                    }
                    // Testnet/regtest: accept on trust — RPC may be slow to index.
                    console.warn(
                        `[PaymentService] Could not fetch OP-20 tx ${txHash} after ` +
                        `${MAX_RETRIES} retries — accepting on trust (${Config.OPNET_NETWORK})`,
                    );
                    const amountPaid = expectedTotal;
                    const { devAmount, nextPoolAmount, prizeAmount } =
                        TournamentService.getInstance().computeSplit(amountPaid);
                    return {
                        valid:         true,
                        confirmations: 1,
                        amountPaid,
                        devAmount,
                        nextPoolAmount,
                        prizeAmount,
                    };
                }
            }
        }

        if (!tx) {
            return invalid('Transaction lookup returned empty result');
        }

        if (tx.revert !== undefined) {
            return invalid('Transaction reverted');
        }

        // Compute on-chain confirmations
        let confirmations = 0;
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

        // Parse "Transferred" events from the token contract
        let amountPaid = 0n;
        const entryWallet = Config.PRIZE_CONTRACT_ADDRESS.toLowerCase();
        const tokenAddr   = Config.ENTRY_TOKEN_ADDRESS.toLowerCase();

        const contractEvents = tx.events;
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

                        const [, , to, amount] = decoded;
                        if (to.toString().toLowerCase() === entryWallet) {
                            amountPaid += amount;
                        }
                    } catch {
                        // Malformed event — skip
                    }
                }
            }
        }

        // Validate total payment — allow 1% tolerance
        if (amountPaid < (expectedTotal * 99n) / 100n) {
            return {
                valid: false,
                reason: `Insufficient payment: expected ~${expectedTotal} units, received ${amountPaid} units`,
                confirmations,
                amountPaid,
                devAmount:      0n,
                nextPoolAmount: 0n,
                prizeAmount:    0n,
            };
        }

        const { devAmount, nextPoolAmount, prizeAmount } =
            TournamentService.getInstance().computeSplit(amountPaid);

        return {
            valid: confirmations >= Config.MIN_PAYMENT_CONFIRMATIONS,
            confirmations,
            amountPaid,
            devAmount,
            nextPoolAmount,
            prizeAmount,
        };
    }
}
