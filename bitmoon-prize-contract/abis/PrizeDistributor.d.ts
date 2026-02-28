import { Address, AddressMap, ExtendedAddressMap, SchnorrSignature } from '@btc-vision/transaction';
import { CallResult, OPNetEvent, IOP_NETContract } from 'opnet';

// ------------------------------------------------------------------
// Event Definitions
// ------------------------------------------------------------------

// ------------------------------------------------------------------
// Call Results
// ------------------------------------------------------------------

/**
 * @description Represents the result of the getPoolInfo function call.
 */
export type GetPoolInfo = CallResult<
    {
        mainPool: bigint;
        stagingCarry: bigint;
        activeCarry: bigint;
        lastDistKey: bigint;
    },
    OPNetEvent<never>[]
>;

/**
 * @description Represents the result of the getOperator function call.
 */
export type GetOperator = CallResult<
    {
        operator: Address;
    },
    OPNetEvent<never>[]
>;

/**
 * @description Represents the result of the getTokenAddress function call.
 */
export type GetTokenAddress = CallResult<
    {
        token: Address;
    },
    OPNetEvent<never>[]
>;

/**
 * @description Represents the result of the getSponsorCount function call.
 */
export type GetSponsorCount = CallResult<
    {
        count: bigint;
    },
    OPNetEvent<never>[]
>;

/**
 * @description Represents the result of the recordEntry function call.
 */
export type RecordEntry = CallResult<
    {
        success: boolean;
    },
    OPNetEvent<never>[]
>;

/**
 * @description Represents the result of the distributePrize function call.
 */
export type DistributePrize = CallResult<
    {
        success: boolean;
    },
    OPNetEvent<never>[]
>;

/**
 * @description Represents the result of the setOperator function call.
 */
export type SetOperator = CallResult<
    {
        success: boolean;
    },
    OPNetEvent<never>[]
>;

/**
 * @description Represents the result of the setDevWallet function call.
 */
export type SetDevWallet = CallResult<
    {
        success: boolean;
    },
    OPNetEvent<never>[]
>;

/**
 * @description Represents the result of the depositBonus function call.
 */
export type DepositBonus = CallResult<
    {
        success: boolean;
    },
    OPNetEvent<never>[]
>;

// ------------------------------------------------------------------
// IPrizeDistributor
// ------------------------------------------------------------------
export interface IPrizeDistributor extends IOP_NETContract {
    getPoolInfo(tournamentType: number): Promise<GetPoolInfo>;
    getOperator(): Promise<GetOperator>;
    getTokenAddress(): Promise<GetTokenAddress>;
    getSponsorCount(tournamentType: number, periodKey: bigint): Promise<GetSponsorCount>;
    recordEntry(tournamentType: number, periodKey: bigint, amount: bigint): Promise<RecordEntry>;
    distributePrize(
        tournamentType: number,
        periodKey: bigint,
        w1: Address,
        w2: Address,
        w3: Address,
    ): Promise<DistributePrize>;
    setOperator(newOperator: Address): Promise<SetOperator>;
    setDevWallet(newDevWallet: Address): Promise<SetDevWallet>;
    depositBonus(
        tournamentType: number,
        periodKey: bigint,
        tokenAddress: Address,
        amount: bigint,
    ): Promise<DepositBonus>;
}
