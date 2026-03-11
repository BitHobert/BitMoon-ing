import { JSONRpcProvider } from 'opnet';
import { OPNetLimitedProvider } from '@btc-vision/transaction';
import { Config } from '../config/Config.js';

/**
 * Centralised OPNet provider singleton.
 *
 * Caches both the full JSONRpcProvider (used for contract calls, block queries)
 * and the lightweight OPNetLimitedProvider (used for UTXO fetching & broadcast).
 * All services should obtain providers from here — never instantiate directly.
 */
/** How long a cached block number stays valid (ms). */
const BLOCK_CACHE_TTL_MS = 15_000;

export class OPNetService {
    private static instance: OPNetService;

    private readonly provider: JSONRpcProvider;
    private readonly limitedProvider: OPNetLimitedProvider;

    /** Cached block number to avoid hammering the RPC on every request. */
    private cachedBlockNumber: bigint = 0n;
    private blockCacheExpiry: number = 0;
    private blockFetchPromise: Promise<bigint> | null = null;

    private constructor() {
        this.provider = new JSONRpcProvider({
            url: Config.OPNET_RPC_URL,
            network: Config.NETWORK,
        });

        this.limitedProvider = new OPNetLimitedProvider(Config.OPNET_RPC_URL);
    }

    public static getInstance(): OPNetService {
        if (!OPNetService.instance) {
            OPNetService.instance = new OPNetService();
        }
        return OPNetService.instance;
    }

    /** Full JSON-RPC provider for contract calls, block queries, address resolution. */
    public getProvider(): JSONRpcProvider {
        return this.provider;
    }

    /** Lightweight provider for UTXO fetching and transaction broadcasting. */
    public getLimitedProvider(): OPNetLimitedProvider {
        return this.limitedProvider;
    }

    /**
     * Get the current block number with a 15-second cache.
     * Deduplicates concurrent requests — if two callers ask at the same time,
     * only one RPC call is made and both get the same result.
     */
    public async getBlockNumber(): Promise<bigint> {
        const now = Date.now();

        // Return cached value if still fresh
        if (this.cachedBlockNumber > 0n && now < this.blockCacheExpiry) {
            return this.cachedBlockNumber;
        }

        // If a fetch is already in-flight, wait for it instead of making a second call
        if (this.blockFetchPromise) {
            return this.blockFetchPromise;
        }

        // Start a fresh fetch
        this.blockFetchPromise = this.provider.getBlockNumber()
            .then((block) => {
                this.cachedBlockNumber = block;
                this.blockCacheExpiry = Date.now() + BLOCK_CACHE_TTL_MS;
                this.blockFetchPromise = null;
                return block;
            })
            .catch((err) => {
                this.blockFetchPromise = null;
                throw err;
            });

        return this.blockFetchPromise;
    }
}
