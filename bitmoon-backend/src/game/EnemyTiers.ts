import type { EnemyTierConfig, TierNumber } from '../types/index.js';

/**
 * Enemy tier configuration for BitMoon'ing.
 *
 * All moon-shaped invaders descend in left-right oscillating formations.
 * Higher tiers are rarer, tougher, and worth far more — matching the
 * deflationary supply mechanic: fewer tokens = higher scarcity multiplier.
 *
 * burnPerKill is in raw token units (8 decimal places):
 *   1 $BITMOON = 100_000_000n raw units
 *
 * Tune these values once the final game design chart is confirmed.
 */
export const ENEMY_TIERS: Readonly<Record<TierNumber, EnemyTierConfig>> = {
    1: {
        tier: 1,
        hp: 1,
        basePoints: 100,
        burnPerKill: 100_000_000n,          // 1 $BITMOON
        firesBack: false,
        speedFactor: 1.0,
    },
    2: {
        tier: 2,
        hp: 2,
        basePoints: 300,
        burnPerKill: 500_000_000n,          // 5 $BITMOON
        firesBack: false,
        speedFactor: 1.3,
    },
    3: {
        tier: 3,
        hp: 3,
        basePoints: 750,
        burnPerKill: 1_000_000_000n,        // 10 $BITMOON
        firesBack: false,
        speedFactor: 1.6,
    },
    4: {
        tier: 4,
        hp: 5,
        basePoints: 1_500,
        burnPerKill: 5_000_000_000n,        // 50 $BITMOON
        firesBack: true,
        speedFactor: 2.0,
    },
    5: {
        tier: 5,
        hp: 8,
        basePoints: 3_000,
        burnPerKill: 10_000_000_000n,       // 100 $BITMOON
        firesBack: true,
        speedFactor: 2.5,
    },
} as const;

/**
 * Look up a tier config by tier number.
 * Throws if an invalid tier is provided.
 */
export function getTierConfig(tier: TierNumber): EnemyTierConfig {
    const config = ENEMY_TIERS[tier];
    if (!config) throw new Error(`Unknown enemy tier: ${tier}`);
    return config;
}

/**
 * Enemies that spawn in a given wave.
 * Wave 1 = full grid; each subsequent wave has fewer enemies (deflationary).
 *
 * Formula: Math.max(1, 55 - (wave - 1) * 5) enemies per wave.
 * At wave 11+ you start getting T2/T3/T4/T5 enemies.
 */
export function getWaveEnemyCount(wave: number): number {
    return Math.max(1, 55 - (wave - 1) * 5);
}

/**
 * Distribution of enemy tiers for a given wave.
 * Early waves are mostly T1; later waves shift to higher tiers.
 */
export function getWaveTierDistribution(wave: number): Readonly<Record<TierNumber, number>> {
    const t5 = wave >= 15 ? Math.min(wave - 14, 5) : 0;
    const t4 = wave >= 10 ? Math.min(wave - 9, 5) : 0;
    const t3 = wave >= 5  ? Math.min(wave - 4, 8) : 0;
    const t2 = wave >= 2  ? Math.min(wave * 2, 12) : 0;
    const total = getWaveEnemyCount(wave);
    const t1 = Math.max(0, total - t2 - t3 - t4 - t5);

    return { 1: t1, 2: t2, 3: t3, 4: t4, 5: t5 };
}
