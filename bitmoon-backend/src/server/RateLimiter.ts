/**
 * In-memory sliding-window rate limiter for HyperExpress.
 *
 * Each key (IP or IP+path) tracks a list of request timestamps.
 * When the count exceeds the limit within the window, requests are rejected with 429.
 *
 * Cleanup runs automatically every 60s to evict stale entries.
 */

interface BucketEntry {
    timestamps: number[];
}

export interface RateLimitConfig {
    /** Maximum requests allowed within the window */
    maxRequests: number;
    /** Time window in milliseconds */
    windowMs: number;
}

export class RateLimiter {
    private readonly buckets = new Map<string, BucketEntry>();
    private readonly cleanupTimer: ReturnType<typeof setInterval>;

    constructor(private readonly defaultConfig: RateLimitConfig) {
        // Periodic cleanup of stale entries
        this.cleanupTimer = setInterval(() => this.cleanup(), 60_000);
    }

    /**
     * Check if a request should be allowed.
     * Returns `true` if allowed, `false` if rate-limited.
     */
    public allow(key: string, config?: RateLimitConfig): boolean {
        const { maxRequests, windowMs } = config ?? this.defaultConfig;
        const now = Date.now();
        const cutoff = now - windowMs;

        let entry = this.buckets.get(key);
        if (!entry) {
            entry = { timestamps: [] };
            this.buckets.set(key, entry);
        }

        // Remove expired timestamps
        entry.timestamps = entry.timestamps.filter(t => t > cutoff);

        if (entry.timestamps.length >= maxRequests) {
            return false;
        }

        entry.timestamps.push(now);
        return true;
    }

    /** How many requests remain for this key */
    public remaining(key: string, config?: RateLimitConfig): number {
        const { maxRequests, windowMs } = config ?? this.defaultConfig;
        const cutoff = Date.now() - windowMs;
        const entry = this.buckets.get(key);
        if (!entry) return maxRequests;
        const active = entry.timestamps.filter(t => t > cutoff).length;
        return Math.max(0, maxRequests - active);
    }

    /** Clean up entries with no recent timestamps */
    private cleanup(): void {
        const now = Date.now();
        const maxWindow = this.defaultConfig.windowMs;
        for (const [key, entry] of this.buckets) {
            entry.timestamps = entry.timestamps.filter(t => t > now - maxWindow);
            if (entry.timestamps.length === 0) {
                this.buckets.delete(key);
            }
        }
    }

    public destroy(): void {
        clearInterval(this.cleanupTimer);
        this.buckets.clear();
    }
}

/**
 * Pre-configured rate limit profiles for different endpoint categories.
 */
export const RATE_LIMITS = {
    /** Public read-only endpoints (leaderboards, tournaments, supply) */
    public: { maxRequests: 60, windowMs: 60_000 } satisfies RateLimitConfig,

    /** Auth + session endpoints (start, game, end) */
    session: { maxRequests: 20, windowMs: 60_000 } satisfies RateLimitConfig,

    /** Score submission (end session) — tighter to prevent spam */
    submit: { maxRequests: 10, windowMs: 60_000 } satisfies RateLimitConfig,

    /** Tournament entry (payment verification) — tight */
    entry: { maxRequests: 10, windowMs: 60_000 } satisfies RateLimitConfig,

    /** Nonce generation — prevent enumeration */
    nonce: { maxRequests: 30, windowMs: 60_000 } satisfies RateLimitConfig,

    /** Admin endpoints — generous but capped */
    admin: { maxRequests: 30, windowMs: 60_000 } satisfies RateLimitConfig,
} as const;
