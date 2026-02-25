/**
 * In-memory, block-aware cache service.
 *
 * Entries can be:
 *  - Block-sensitive: auto-invalidated when the OPNet block advances
 *  - Time-based: expire after a fixed TTL
 *  - Permanent: never expire (use for immutable token metadata)
 */

interface CacheEntry<T> {
    readonly data: T;
    readonly capturedBlock: number;
    readonly expiresAt: number;     // ms timestamp; Infinity = permanent
    readonly blockSensitive: boolean;
}

export interface CacheOptions {
    /** Time-to-live in milliseconds. Use Infinity for permanent entries. */
    readonly ttl: number;
    /** If true, entry is invalidated when the block number advances */
    readonly blockSensitive: boolean;
}

/**
 * Singleton cache used across all services.
 */
export class CacheService {
    private static instance: CacheService;

    private readonly store: Map<string, CacheEntry<unknown>> = new Map();
    private currentBlock: number = 0;

    private constructor() {
        // Clean expired entries every 60 seconds
        setInterval(() => { this.cleanup(); }, 60_000);
    }

    public static getInstance(): CacheService {
        if (!CacheService.instance) {
            CacheService.instance = new CacheService();
        }
        return CacheService.instance;
    }

    /**
     * Retrieve a value from cache or compute it fresh.
     *
     * @param key      - Unique cache key
     * @param fetcher  - Async function to compute fresh data
     * @param options  - TTL and block-sensitivity settings
     */
    public async get<T>(
        key: string,
        fetcher: () => Promise<T>,
        options: CacheOptions,
    ): Promise<T> {
        const entry = this.store.get(key) as CacheEntry<T> | undefined;

        if (entry) {
            const blockOk = !options.blockSensitive || entry.capturedBlock === this.currentBlock;
            const timeOk  = Date.now() < entry.expiresAt;
            if (blockOk && timeOk) return entry.data;
        }

        const data = await fetcher();
        this.set(key, data, options);
        return data;
    }

    /**
     * Manually set a cache entry.
     */
    public set<T>(key: string, data: T, options: CacheOptions): void {
        const entry: CacheEntry<T> = {
            data,
            capturedBlock: this.currentBlock,
            expiresAt: options.ttl === Infinity ? Infinity : Date.now() + options.ttl,
            blockSensitive: options.blockSensitive,
        };
        this.store.set(key, entry);
    }

    /**
     * Invalidate a specific key.
     */
    public invalidate(key: string): void {
        this.store.delete(key);
    }

    /**
     * Invalidate all keys matching a prefix.
     */
    public invalidatePrefix(prefix: string): void {
        for (const key of this.store.keys()) {
            if (key.startsWith(prefix)) this.store.delete(key);
        }
    }

    /**
     * Called by SupplyWatcher when a new block is detected.
     * Evicts all block-sensitive entries.
     */
    public onNewBlock(block: number): void {
        if (block === this.currentBlock) return;
        this.currentBlock = block;
        for (const [key, entry] of this.store) {
            if (entry.blockSensitive) this.store.delete(key);
        }
    }

    public getCurrentBlock(): number {
        return this.currentBlock;
    }

    private cleanup(): void {
        const now = Date.now();
        for (const [key, entry] of this.store) {
            if (entry.expiresAt !== Infinity && entry.expiresAt < now) {
                this.store.delete(key);
            }
        }
    }
}
