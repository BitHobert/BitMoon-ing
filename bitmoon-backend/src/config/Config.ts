import { networks, type Network } from '@btc-vision/bitcoin';

/**
 * Resolve the @btc-vision/bitcoin `Network` object from the OPNET_NETWORK env var.
 *
 * CRITICAL: OPNet testnet is a Signet fork — you MUST use `networks.opnetTestnet`.
 * Using `networks.testnet` (Testnet4) will cause address validation and
 * contract interactions to silently fail.
 */
function resolveNetwork(name: string): Network {
    switch (name) {
        case 'mainnet':  return networks.bitcoin;
        case 'testnet':  return networks.opnetTestnet;
        case 'regtest':  return networks.regtest;
        default:         return networks.opnetTestnet;
    }
}

/**
 * Centralised configuration loaded from environment variables.
 * All values are read once at startup — no runtime re-reads.
 */
export const Config = {
    /** OPNet JSON-RPC endpoint (used for address validation only) */
    OPNET_RPC_URL: process.env['OPNET_RPC_URL'] ?? 'https://testnet.opnet.org',

    /** Network identifier string (mainnet | testnet | regtest) */
    OPNET_NETWORK: process.env['OPNET_NETWORK'] ?? 'testnet',

    /**
     * Resolved @btc-vision/bitcoin Network object.
     * ALWAYS use this instead of manually selecting `networks.testnet` etc.
     */
    NETWORK: resolveNetwork(process.env['OPNET_NETWORK'] ?? 'testnet'),

    /** MongoDB connection URI */
    MONGO_URI: process.env['MONGO_URI'] ?? 'mongodb://localhost:27017',

    /** MongoDB database name */
    MONGO_DB_NAME: process.env['MONGO_DB_NAME'] ?? 'bitmoon',

    /** REST API port (Railway sets PORT automatically) */
    HTTP_PORT: parseInt(process.env['PORT'] ?? process.env['HTTP_PORT'] ?? '3000', 10),

    /** WebSocket server port — defaults to HTTP_PORT for single-port hosts (Railway) */
    WS_PORT: parseInt(process.env['WS_PORT'] ?? process.env['PORT'] ?? '3001', 10),

    /** JWT signing secret — change in production */
    JWT_SECRET: process.env['JWT_SECRET'] ?? 'change_me_in_production',

    /**
     * Secret header value required for admin giveaway endpoints.
     * Set a strong random string in production.
     */
    ADMIN_SECRET: process.env['ADMIN_SECRET'] ?? 'change_me_admin_secret',

    /**
     * Total initial game supply (tBTC on testnet, wBTC on mainnet).
     * Stored in raw units (8 decimal places): 1 token = 100_000_000 units.
     * Default: 1,000,000,000 tokens → 100_000_000_000_000_000 raw units.
     */
    INITIAL_SUPPLY: BigInt(process.env['INITIAL_SUPPLY'] ?? '1000000000') * 100_000_000n,

    /** Enable verbose error logging */
    DEV_MODE: process.env['DEV_MODE'] === 'true',

    /**
     * Allowed CORS origins (comma-separated).
     * In production: set to your frontend domain(s).
     * Default '*' allows all origins (dev mode only).
     */
    CORS_ORIGINS: (process.env['CORS_ORIGINS'] ?? '*').split(',').map(s => s.trim()),

    // ── Tournament fee system ─────────────────────────────────────────────────

    /**
     * OPNet contract address of the OP-20 token used for tournament entry fees.
     * Must be a hex address (e.g. 0xabc...). Set by the developer.
     */
    ENTRY_TOKEN_ADDRESS: process.env['ENTRY_TOKEN_ADDRESS'] ?? '',

    /**
     * OPNet contract address of the deployed PrizeDistributor smart contract.
     * Players transfer entry tokens directly to this address. The contract holds
     * all prize pools and distributes them on-chain to winners at prizeBlock.
     */
    PRIZE_CONTRACT_ADDRESS: process.env['PRIZE_CONTRACT_ADDRESS'] ?? '',

    /**
     * WIF-encoded private key of the server's operator wallet.
     * Signs recordEntry() and distributePrize() transactions on the PrizeDistributor.
     * The operator wallet must hold BTC for gas fees.
     */
    OPERATOR_PRIVATE_KEY: process.env['OPERATOR_PRIVATE_KEY'] ?? '',

    /**
     * MLDSA (quantum-resistant) private key for the operator wallet, hex or Base58.
     * Required by the btc-vision SDK Wallet constructor alongside the classical WIF key.
     */
    OPERATOR_MLDSA_KEY: process.env['OPERATOR_MLDSA_KEY'] ?? '',

    /**
     * P2TR (Taproot) address of the operator wallet — used as the gas refund address
     * when building OPNet interaction transactions.
     */
    OPERATOR_P2TR_ADDRESS: process.env['OPERATOR_P2TR_ADDRESS'] ?? '',

    /**
     * How often (ms) the prize watcher polls OPNet for prizeBlock arrival.
     * Default: 30 seconds.
     */
    PRIZE_WATCHER_INTERVAL_MS: parseInt(process.env['PRIZE_WATCHER_INTERVAL_MS'] ?? '30000', 10),

    /** Daily tournament entry fee in raw token units */
    DAILY_ENTRY_FEE: BigInt(process.env['DAILY_ENTRY_FEE'] ?? '1000000000'),

    /** Weekly tournament entry fee in raw token units */
    WEEKLY_ENTRY_FEE: BigInt(process.env['WEEKLY_ENTRY_FEE'] ?? '5000000000'),

    /** Monthly tournament entry fee in raw token units */
    MONTHLY_ENTRY_FEE: BigInt(process.env['MONTHLY_ENTRY_FEE'] ?? '10000000000'),

    /** Minimum on-chain confirmations before a payment is considered verified */
    MIN_PAYMENT_CONFIRMATIONS: parseInt(process.env['MIN_PAYMENT_CONFIRMATIONS'] ?? '1', 10),

    // ── Prize Distribution ────────────────────────────────────────────────────

    /** Enable OP-20 token prize payouts from the operator wallet to tournament winners */
    TOKEN_PRIZE_ENABLED: process.env['TOKEN_PRIZE_ENABLED'] === 'true',

    /** Enable native BTC prize payouts from the operator wallet to tournament winners */
    BTC_PRIZE_ENABLED: process.env['BTC_PRIZE_ENABLED'] === 'true',

    /** BTC prize for 1st place (in satoshis). Default: 50,000 sats (0.0005 BTC) */
    BTC_PRIZE_1ST_SATS: BigInt(process.env['BTC_PRIZE_1ST_SATS'] ?? '50000'),

    /** BTC prize for 2nd place (in satoshis). Default: 25,000 sats */
    BTC_PRIZE_2ND_SATS: BigInt(process.env['BTC_PRIZE_2ND_SATS'] ?? '25000'),

    /** BTC prize for 3rd place (in satoshis). Default: 10,000 sats */
    BTC_PRIZE_3RD_SATS: BigInt(process.env['BTC_PRIZE_3RD_SATS'] ?? '10000'),

    // ── Block-based tournament timing ─────────────────────────────────────────

    /**
     * The Bitcoin/OPNet block number from which tournament period counting begins.
     * Must be set at launch and never changed. Default 0 (useful for regtest/dev).
     */
    TOURNAMENT_GENESIS_BLOCK: BigInt(process.env['TOURNAMENT_GENESIS_BLOCK'] ?? '0'),

    /** Active blocks per daily tournament (TEST MODE: 6 blocks ≈ 1 hr). */
    DAILY_ACTIVE_BLOCKS:   6n,
    /** Active blocks per weekly tournament (TEST MODE: 15 blocks ≈ 2.5 hr). */
    WEEKLY_ACTIVE_BLOCKS:  15n,
    /** Active blocks per monthly tournament (TEST MODE: 30 blocks ≈ 5 hr). */
    MONTHLY_ACTIVE_BLOCKS: 30n,

    /**
     * Gap between end of one tournament and start of the next (in blocks).
     * Prize is sent at endBlock+1; next tournament begins at endBlock+GAP+1.
     * TEST MODE: 2 blocks (~20 min) — enough for watcher to poll & distribute.
     */
    TOURNAMENT_GAP_BLOCKS: 2n,

    // ── Fee split ratios (basis points, total = 10 000) ───────────────────────
    /** 5 % → developer wallet */
    ENTRY_FEE_DEV_BPS:       500,
    /** 15 % → next tournament period's prize pool */
    ENTRY_FEE_NEXT_POOL_BPS: 1500,
    /** 80 % → current tournament period's prize pool */
    ENTRY_FEE_PRIZE_BPS:     8000,

    // ── Internal constants ────────────────────────────────────────────────────

    /** How often to poll the DB for supply updates to broadcast (ms) */
    SUPPLY_POLL_INTERVAL_MS: 10_000,

    /** Session TTL before it expires (ms) — 30 minutes */
    SESSION_TTL_MS: 30 * 60 * 1000,

    /** Max game ticks we accept in a session event log (anti-cheat ceiling) */
    MAX_GAME_TICKS: 200_000,

    /** Maximum score the server will accept from a single session */
    MAX_PLAUSIBLE_SCORE: 100_000_000,
} as const;
