import {
    ABIDataTypes,
    type Address,
} from '@btc-vision/transaction';
import {
    BitcoinAbiTypes,
    type BitcoinInterfaceAbi,
    type CallResult,
    type IOP_NETContract,
    type OPNetEvent,
} from 'opnet';

// ── Event payload types ───────────────────────────────────────────────────────

export type EntryRecordedEventData = {
    readonly tournamentType: number;
    readonly periodKey: bigint;
    readonly amount: bigint;
};

export type PrizeDistributedEventData = {
    readonly tournamentType: number;
    readonly periodKey: bigint;
    readonly winner1: Address;
    readonly winner2: Address;
    readonly winner3: Address;
    readonly totalPrize: bigint;
};

export type SponsorBonusDepositedEventData = {
    readonly tournamentType: number;
    readonly periodKey: bigint;
    /** Token address encoded as u256 (20-byte address left-padded to 32 bytes) */
    readonly tokenAddress: bigint;
    readonly amount: bigint;
    readonly slotIndex: number;
};

// ── Call result types (void methods return empty properties object) ───────────

export type RecordEntryResult     = CallResult<Record<string, never>, OPNetEvent<EntryRecordedEventData>[]>;
export type DistributePrizeResult = CallResult<Record<string, never>, OPNetEvent<PrizeDistributedEventData>[]>;
export type SetOperatorResult     = CallResult<Record<string, never>, OPNetEvent<never>[]>;
export type SetDevWalletResult    = CallResult<Record<string, never>, OPNetEvent<never>[]>;
export type DepositBonusResult    = CallResult<Record<string, never>, OPNetEvent<SponsorBonusDepositedEventData>[]>;

// ── Typed contract interface ──────────────────────────────────────────────────

export interface IPrizeDistributorContract extends IOP_NETContract {
    /**
     * Record a verified tournament entry (operator only).
     * Call AFTER confirming the on-chain OP-20 transfer to the contract address.
     */
    recordEntry(
        tournamentType: number,
        periodKey: bigint,
        amount: bigint,
    ): Promise<RecordEntryResult>;

    /**
     * Distribute prizes for a closed tournament period (operator only).
     * w1/w2/w3 are the top-3 winner addresses (pass Address.dead() for missing ranks).
     */
    distributePrize(
        tournamentType: number,
        periodKey: bigint,
        w1: Address,
        w2: Address,
        w3: Address,
    ): Promise<DistributePrizeResult>;

    /** Update operator address (deployer only). */
    setOperator(newOperator: Address): Promise<SetOperatorResult>;

    /** Update dev wallet address (deployer only). */
    setDevWallet(newDevWallet: Address): Promise<SetDevWalletResult>;

    /**
     * Deposit a sponsor bonus for a future tournament period (operator only).
     * The operator must verify the on-chain OP-20 transfer to the contract before calling.
     * Bonuses are locked permanently and paid to 1st place at distributePrize() time.
     *
     * @param tournamentType  0=daily, 1=weekly, 2=monthly
     * @param periodKey       Start block of the target tournament period
     * @param tokenAddress    OP-20 token contract address of the bonus
     * @param amount          Bonus amount in raw token units
     */
    depositBonus(
        tournamentType: number,
        periodKey: bigint,
        tokenAddress: Address,
        amount: bigint,
    ): Promise<DepositBonusResult>;
}

// ── ABI definition ────────────────────────────────────────────────────────────

export const PRIZE_DISTRIBUTOR_ABI: BitcoinInterfaceAbi = [
    {
        name: 'recordEntry',
        type: BitcoinAbiTypes.Function,
        inputs: [
            { name: 'tournamentType', type: ABIDataTypes.UINT8    },
            { name: 'periodKey',      type: ABIDataTypes.UINT256   },
            { name: 'amount',         type: ABIDataTypes.UINT256   },
        ],
        outputs: [],
    },
    {
        name: 'distributePrize',
        type: BitcoinAbiTypes.Function,
        inputs: [
            { name: 'tournamentType', type: ABIDataTypes.UINT8    },
            { name: 'periodKey',      type: ABIDataTypes.UINT256   },
            { name: 'winner1',        type: ABIDataTypes.ADDRESS   },
            { name: 'winner2',        type: ABIDataTypes.ADDRESS   },
            { name: 'winner3',        type: ABIDataTypes.ADDRESS   },
        ],
        outputs: [],
    },
    {
        name: 'setOperator',
        type: BitcoinAbiTypes.Function,
        inputs: [{ name: 'newOperator', type: ABIDataTypes.ADDRESS }],
        outputs: [],
    },
    {
        name: 'setDevWallet',
        type: BitcoinAbiTypes.Function,
        inputs: [{ name: 'newDevWallet', type: ABIDataTypes.ADDRESS }],
        outputs: [],
    },
    {
        name: 'depositBonus',
        type: BitcoinAbiTypes.Function,
        inputs: [
            { name: 'tournamentType', type: ABIDataTypes.UINT8   },
            { name: 'periodKey',      type: ABIDataTypes.UINT256 },
            { name: 'tokenAddress',   type: ABIDataTypes.ADDRESS },
            { name: 'amount',         type: ABIDataTypes.UINT256 },
        ],
        outputs: [],
    },
];
