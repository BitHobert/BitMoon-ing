import { describe, it, expect } from 'vitest';
import {
    ENEMY_TIERS,
    BOSS_POINTS,
    PLANET_PENALTIES,
    isBossWave,
    getTierConfig,
    getWaveEnemyCount,
    getWaveTierDistribution,
} from '../game/EnemyTiers.js';
import type { TierNumber } from '../types/index.js';

describe('EnemyTiers', () => {
    describe('tier configs', () => {
        it('has 5 tiers', () => {
            expect(Object.keys(ENEMY_TIERS)).toHaveLength(5);
        });

        it('all tiers have positive HP', () => {
            for (const tier of Object.values(ENEMY_TIERS)) {
                expect(tier.hp).toBeGreaterThan(0);
            }
        });

        it('all tiers have positive basePoints', () => {
            for (const tier of Object.values(ENEMY_TIERS)) {
                expect(tier.basePoints).toBeGreaterThan(0);
            }
        });

        it('all tiers have positive burnPerKill', () => {
            for (const tier of Object.values(ENEMY_TIERS)) {
                expect(tier.burnPerKill).toBeGreaterThan(0n);
            }
        });

        it('higher tiers have more HP', () => {
            for (let i = 2; i <= 5; i++) {
                const current = ENEMY_TIERS[i as TierNumber];
                const previous = ENEMY_TIERS[(i - 1) as TierNumber];
                expect(current.hp).toBeGreaterThanOrEqual(previous.hp);
            }
        });

        it('higher tiers award more points', () => {
            for (let i = 2; i <= 5; i++) {
                const current = ENEMY_TIERS[i as TierNumber];
                const previous = ENEMY_TIERS[(i - 1) as TierNumber];
                expect(current.basePoints).toBeGreaterThan(previous.basePoints);
            }
        });

        it('higher tiers burn more tokens', () => {
            for (let i = 2; i <= 5; i++) {
                const current = ENEMY_TIERS[i as TierNumber];
                const previous = ENEMY_TIERS[(i - 1) as TierNumber];
                expect(current.burnPerKill).toBeGreaterThan(previous.burnPerKill);
            }
        });

        it('higher tiers have higher speed', () => {
            for (let i = 2; i <= 5; i++) {
                const current = ENEMY_TIERS[i as TierNumber];
                const previous = ENEMY_TIERS[(i - 1) as TierNumber];
                expect(current.speedFactor).toBeGreaterThan(previous.speedFactor);
            }
        });
    });

    describe('getTierConfig', () => {
        it('returns correct config for each tier', () => {
            for (const tierNum of [1, 2, 3, 4, 5] as TierNumber[]) {
                expect(getTierConfig(tierNum)).toBe(ENEMY_TIERS[tierNum]);
            }
        });

        it('throws for invalid tier', () => {
            expect(() => getTierConfig(0 as TierNumber)).toThrow('Unknown enemy tier');
            expect(() => getTierConfig(6 as TierNumber)).toThrow('Unknown enemy tier');
        });
    });

    describe('BOSS_POINTS', () => {
        it('has at least 1 boss value', () => {
            expect(BOSS_POINTS.size).toBeGreaterThan(0);
        });

        it('all boss values are positive', () => {
            for (const pts of BOSS_POINTS) {
                expect(pts).toBeGreaterThan(0);
            }
        });

        it('all boss values are > tier 5 basePoints', () => {
            const t5base = ENEMY_TIERS[5].basePoints;
            for (const pts of BOSS_POINTS) {
                expect(pts).toBeGreaterThan(t5base);
            }
        });
    });

    describe('PLANET_PENALTIES', () => {
        it('has at least 1 penalty value', () => {
            expect(PLANET_PENALTIES.size).toBeGreaterThan(0);
        });

        it('all penalty values are positive', () => {
            for (const pen of PLANET_PENALTIES) {
                expect(pen).toBeGreaterThan(0);
            }
        });
    });

    describe('isBossWave', () => {
        it('returns true for multiples of 5', () => {
            expect(isBossWave(5)).toBe(true);
            expect(isBossWave(10)).toBe(true);
            expect(isBossWave(15)).toBe(true);
            expect(isBossWave(20)).toBe(true);
        });

        it('returns false for non-multiples of 5', () => {
            expect(isBossWave(1)).toBe(false);
            expect(isBossWave(2)).toBe(false);
            expect(isBossWave(3)).toBe(false);
            expect(isBossWave(7)).toBe(false);
        });

        it('returns false for wave 0', () => {
            expect(isBossWave(0)).toBe(false);
        });
    });

    describe('getWaveEnemyCount', () => {
        it('wave 1 has 55 enemies', () => {
            expect(getWaveEnemyCount(1)).toBe(55);
        });

        it('enemy count decreases by 5 per wave', () => {
            expect(getWaveEnemyCount(2)).toBe(50);
            expect(getWaveEnemyCount(3)).toBe(45);
        });

        it('never goes below 1', () => {
            expect(getWaveEnemyCount(100)).toBe(1);
            expect(getWaveEnemyCount(1000)).toBe(1);
        });
    });

    describe('getWaveTierDistribution', () => {
        it('wave 1 is all tier 1', () => {
            const dist = getWaveTierDistribution(1);
            expect(dist[1]).toBe(55);
            expect(dist[2]).toBe(0);
            expect(dist[3]).toBe(0);
            expect(dist[4]).toBe(0);
            expect(dist[5]).toBe(0);
        });

        it('distribution sums to wave enemy count for early waves', () => {
            // At low waves, distribution matches count exactly
            for (const wave of [1, 2, 3, 4]) {
                const dist = getWaveTierDistribution(wave);
                const total = dist[1] + dist[2] + dist[3] + dist[4] + dist[5];
                expect(total).toBe(getWaveEnemyCount(wave));
            }
        });

        it('t1 count is never negative (clamped at 0)', () => {
            // At high waves, higher tier counts can exceed total — t1 clamps to 0
            for (const wave of [15, 20, 30]) {
                const dist = getWaveTierDistribution(wave);
                expect(dist[1]).toBeGreaterThanOrEqual(0);
            }
        });

        it('tier 5 enemies appear at wave 15+', () => {
            expect(getWaveTierDistribution(14)[5]).toBe(0);
            expect(getWaveTierDistribution(15)[5]).toBeGreaterThan(0);
        });

        it('tier 4 enemies appear at wave 10+', () => {
            expect(getWaveTierDistribution(9)[4]).toBe(0);
            expect(getWaveTierDistribution(10)[4]).toBeGreaterThan(0);
        });
    });
});
