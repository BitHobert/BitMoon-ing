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
 * PaymentService verifies on-chain OP-20 token payments for tournament entries.
 *
 * It confirms that:
 *  1. The transaction exists and was not reverted.
 *  2. The transaction targets the configured ENTRY_TOKEN_ADDRESS.
 *  3. A "Transferred" event from that contract shows a transfer TO the PRIZE_CONTRACT_ADDRESS
 *     of at least the required entry fee (1% tolerance).
 *  4. The tx has enough on-chain confirmations.
 *
 * Returns amountPaid plus the pre-computed 5/15/80 split.
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
    ): Promise<PaymentVerificationResult> {
        // ── DEV_MODE bypass ─────────────────────────────────────────────────
        // Accept any txHash so tournament flow can be tested without a
        // deployed contract or real OP-20 tokens on chain.
        if (Config.DEV_MODE) {
            const feeConfig  = await TournamentService.getInstance().getFeeConfig(tournamentType);
            const fakeAmount = BigInt(feeConfig.entryFee);
            const { devAmount, nextPoolAmount, prizeAmount } =
                TournamentService.getInstance().computeSplit(fakeAmount);
            console.warn(`[PaymentService] DEV_MODE — auto-approving payment ${txHash}`);
            return {
                valid:          true,
                confirmations:  999,
                amountPaid:     fakeAmount,
                devAmount,
                nextPoolAmount,
                prizeAmount,
            };
        }

        if (!Config.ENTRY_TOKEN_ADDRESS || !Config.PRIZE_CONTRACT_ADDRESS) {
            return invalid('Server entry token or prize contract address is not configured');
        }

        const feeConfig     = await TournamentService.getInstance().getFeeConfig(tournamentType);
        const expectedTotal = BigInt(feeConfig.entryFee);
        const provider      = OPNetService.getInstance().getProvider();

        let tx: Awaited<ReturnType<typeof provider.getTransaction>>;
        try {
            tx = await provider.getTransaction(txHash);
        } catch (err) {
            return invalid(`RPC error: ${err instanceof Error ? err.message : String(err)}`);
        }

        // A defined `revert` field means the transaction was reverted
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

        // Parse "Transferred" events from the token contract and sum transfers to PRIZE_CONTRACT_ADDRESS
        let amountPaid = 0n;
        const entryWallet = Config.PRIZE_CONTRACT_ADDRESS.toLowerCase();
        const tokenAddr   = Config.ENTRY_TOKEN_ADDRESS.toLowerCase();

        const contractEvents = tx.events;
        if (contractEvents) {
            // contractEvents is ContractEvents = { [contractAddress: string]: NetEvent[] }
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

        // Compute the 5/15/80 split
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
