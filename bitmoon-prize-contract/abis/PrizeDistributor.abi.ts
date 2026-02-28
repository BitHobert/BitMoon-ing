import { ABIDataTypes, BitcoinAbiTypes, OP_NET_ABI } from 'opnet';

export const PrizeDistributorEvents = [];

export const PrizeDistributorAbi = [
    {
        name: 'getPoolInfo',
        inputs: [{ name: 'tournamentType', type: ABIDataTypes.UINT8 }],
        outputs: [
            { name: 'mainPool', type: ABIDataTypes.UINT256 },
            { name: 'stagingCarry', type: ABIDataTypes.UINT256 },
            { name: 'activeCarry', type: ABIDataTypes.UINT256 },
            { name: 'lastDistKey', type: ABIDataTypes.UINT256 },
        ],
        type: BitcoinAbiTypes.Function,
    },
    {
        name: 'getOperator',
        inputs: [],
        outputs: [{ name: 'operator', type: ABIDataTypes.ADDRESS }],
        type: BitcoinAbiTypes.Function,
    },
    {
        name: 'getTokenAddress',
        inputs: [],
        outputs: [{ name: 'token', type: ABIDataTypes.ADDRESS }],
        type: BitcoinAbiTypes.Function,
    },
    {
        name: 'getSponsorCount',
        inputs: [
            { name: 'tournamentType', type: ABIDataTypes.UINT8 },
            { name: 'periodKey', type: ABIDataTypes.UINT256 },
        ],
        outputs: [{ name: 'count', type: ABIDataTypes.UINT256 }],
        type: BitcoinAbiTypes.Function,
    },
    {
        name: 'recordEntry',
        inputs: [
            { name: 'tournamentType', type: ABIDataTypes.UINT8 },
            { name: 'periodKey', type: ABIDataTypes.UINT256 },
            { name: 'amount', type: ABIDataTypes.UINT256 },
        ],
        outputs: [{ name: 'success', type: ABIDataTypes.BOOL }],
        type: BitcoinAbiTypes.Function,
    },
    {
        name: 'distributePrize',
        inputs: [
            { name: 'tournamentType', type: ABIDataTypes.UINT8 },
            { name: 'periodKey', type: ABIDataTypes.UINT256 },
            { name: 'w1', type: ABIDataTypes.ADDRESS },
            { name: 'w2', type: ABIDataTypes.ADDRESS },
            { name: 'w3', type: ABIDataTypes.ADDRESS },
        ],
        outputs: [{ name: 'success', type: ABIDataTypes.BOOL }],
        type: BitcoinAbiTypes.Function,
    },
    {
        name: 'setOperator',
        inputs: [{ name: 'newOperator', type: ABIDataTypes.ADDRESS }],
        outputs: [{ name: 'success', type: ABIDataTypes.BOOL }],
        type: BitcoinAbiTypes.Function,
    },
    {
        name: 'setDevWallet',
        inputs: [{ name: 'newDevWallet', type: ABIDataTypes.ADDRESS }],
        outputs: [{ name: 'success', type: ABIDataTypes.BOOL }],
        type: BitcoinAbiTypes.Function,
    },
    {
        name: 'depositBonus',
        inputs: [
            { name: 'tournamentType', type: ABIDataTypes.UINT8 },
            { name: 'periodKey', type: ABIDataTypes.UINT256 },
            { name: 'tokenAddress', type: ABIDataTypes.ADDRESS },
            { name: 'amount', type: ABIDataTypes.UINT256 },
        ],
        outputs: [{ name: 'success', type: ABIDataTypes.BOOL }],
        type: BitcoinAbiTypes.Function,
    },
    ...PrizeDistributorEvents,
    ...OP_NET_ABI,
];

export default PrizeDistributorAbi;
