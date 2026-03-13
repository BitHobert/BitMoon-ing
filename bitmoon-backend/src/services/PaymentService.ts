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
            return invalid(`Could not verify tx ${txHash} on-chain — rejecting`);
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

        // Use getTransactionReceipt — more reliable than getTransaction for OP-20
        // interactions on testnet. The receipt contains the parsed events we need.
        const MAX_RETRIES  = 15;
        const RETRY_DELAY  = 3000; // ms — testnet indexing can take 30-45s

        let receipt: Awaited<ReturnType<typeof provider.getTransactionReceipt>> | null = null;
        for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
            try {
                receipt = await provider.getTransactionReceipt(txHash);
                break;
            } catch (err) {
                if (attempt < MAX_RETRIES) {
                    console.log(
                        `[PaymentService] Tx ${txHash.slice(0, 12)}… receipt not indexed yet ` +
                        `(attempt ${attempt}/${MAX_RETRIES}), retrying in ${RETRY_DELAY}ms…`,
                    );
                    await new Promise((r) => setTimeout(r, RETRY_DELAY));
                } else {
                    // Testnet RPC indexing can take 60+ seconds — trust the tx on non-mainnet
                    if (Config.OPNET_NETWORK !== 'mainnet') {
                        console.warn(
                            `[PaymentService] Could not verify tx ${txHash} after ${MAX_RETRIES} retries — ` +
                            `TRUSTING on ${Config.OPNET_NETWORK} (would reject on mainnet)`,
                        );
                        return {
                            valid: true,
                            confirmations: 0,
                            amountPaid: expectedTotal,
                            ...TournamentService.getInstance().computeSplit(expectedTotal),
                        };
                    }
                    return invalid(
                        `Could not verify OP-20 tx ${txHash} after ${MAX_RETRIES} retries — rejecting`,
                    );
                }
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

        // Debug: log receipt structure to diagnose event matching
        console.log('[PaymentService] Receipt found. revert:', receipt.revert, 'failed:', receipt.failed);
        console.log('[PaymentService] events keys:', Object.keys(receipt.events ?? {}));
        console.log('[PaymentService] rawEvents keys:', Object.keys(receipt.rawEvents ?? {}));
        console.log('[PaymentService] Looking for tokenAddr:', tokenAddr);
        console.log('[PaymentService] Looking for entryWallet:', entryWallet);

        // Try rawEvents first (keyed by original hex address), fall back to events
        const contractEvents = receipt.rawEvents ?? receipt.events;
        console.log('[PaymentService] Using contractEvents keys:', Object.keys(contractEvents ?? {}));

        if (contractEvents) {
            for (const [contractAddr, events] of Object.entries(contractEvents)) {
                console.log('[PaymentService] Checking contractAddr:', contractAddr, 'vs tokenAddr:', tokenAddr, 'match:', contractAddr.toLowerCase() === tokenAddr);
                if (contractAddr.toLowerCase() !== tokenAddr) continue;

                for (const event of events) {
                    console.log('[PaymentService] Event type:', event.type, 'data length:', event.data?.length);
                    if (event.type !== 'Transferred') continue;

                    try {
                        const decoded = this.coder.decodeData(
                            event.data,
                            TRANSFERRED_EVENT_TYPES as unknown as ABIDataTypes[],
                        ) as [Address, Address, Address, bigint];

                        const [_operator, _from, to, amount] = decoded;
                        console.log('[PaymentService] Decoded: to=', to.toString(), 'amount=', amount.toString(), 'entryWallet=', entryWallet, 'match:', to.toString().toLowerCase() === entryWallet);
                        if (to.toString().toLowerCase() === entryWallet) {
                            amountPaid += amount;
                        }
                    } catch (decodeErr) {
                        console.error('[PaymentService] Decode error:', decodeErr);
                    }
                }
            }
        }

        // Validate total payment — allow 1% tolerance
        if (amountPaid < (expectedTotal * 99n) / 100n) {
            // On non-mainnet, trust if receipt was found but event parsing failed
            if (Config.OPNET_NETWORK !== 'mainnet' && receipt) {
                console.warn(
                    `[PaymentService] Event parsing returned ${amountPaid} units (expected ${expectedTotal}) — ` +
                    `TRUSTING on ${Config.OPNET_NETWORK} (would reject on mainnet)`,
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

        const { devAmount, nextPoolAmount, prizeAmount } =
            TournamentService.getInstance().computeSplit(amountPaid);

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
