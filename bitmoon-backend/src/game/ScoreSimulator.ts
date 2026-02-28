import { Config } from '../config/Config.js';
import { getTierConfig } from './EnemyTiers.js';
import type { GameEvent, ScoreResult, TierNumber } from '../types/index.js';

/**
 * Server-side score simulator / anti-cheat engine.
 *
 * Replays the client-supplied event log and computes the authoritative score.
 * If the client score deviates from the server's by more than TOLERANCE_PCT,
 * the session is rejected.
 */
export class ScoreSimulator {
    /** Max allowed deviation between client and server score (5%) */
    private static readonly TOLERANCE_PCT = 0.05;

    /**
     * Validate and compute the final score for a session.
     *
     * @param sessionId  - The game session being scored
     * @param playerAddress - Wallet that owns the session
     * @param events     - Ordered game events from the client
     * @param clientScore - Score the client claims
     * @param clientBurned - Tokens burned the client claims
     * @param initialSupply - token supply at session start
     * @returns ScoreResult with validated figures
     */
    public static simulate(
        sessionId: string,
        playerAddress: string,
        events: GameEvent[],
        clientScore: number,
        _clientBurned: bigint,
        initialSupply: bigint,
    ): ScoreResult {
        if (events.length === 0) {
            return ScoreSimulator.reject(sessionId, playerAddress, 'No events submitted');
        }

        if (events.length > Config.MAX_GAME_TICKS) {
            return ScoreSimulator.reject(sessionId, playerAddress, 'Too many events — possible replay attack');
        }

        // ── Replay state ────────────────────────────────────────────────────
        let currentSupply = initialSupply;
        let score = 0;
        let kills = 0;
        let wavesCleared = 0;
        let totalBurned = 0n;
        let reflectionKillCounter = 0;
        let lastTick = -1;
        const activeWaveClearBonus = { active: false, expiresAtTick: 0 };

        for (const event of events) {
            // Enforce monotonic tick ordering
            if (event.tick <= lastTick) {
                return ScoreSimulator.reject(sessionId, playerAddress, 'Non-monotonic tick sequence detected');
            }
            lastTick = event.tick;

            const scarcityMult = ScoreSimulator.scarcityMultiplier(initialSupply, currentSupply);
            const waveMult = activeWaveClearBonus.active && event.tick <= activeWaveClearBonus.expiresAtTick
                ? 5.0
                : 1.0;

            switch (event.type) {
                case 'kill': {
                    if (!event.tier) break;
                    const tier = event.tier as TierNumber;
                    const config = getTierConfig(tier);
                    const points = Math.floor(config.basePoints * scarcityMult * waveMult);
                    score += points;
                    kills++;
                    reflectionKillCounter++;
                    totalBurned += config.burnPerKill;
                    currentSupply -= config.burnPerKill;
                    if (currentSupply < 0n) currentSupply = 0n;

                    // Reflection: every 25 kills grant a passive bonus
                    if (reflectionKillCounter >= 25) {
                        reflectionKillCounter = 0;
                        const reflectionBonus = Math.floor(score * scarcityMult * 0.01);
                        score += reflectionBonus;
                    }
                    break;
                }

                case 'wave_clear': {
                    wavesCleared++;
                    // Bonus: 5x scarcity mult for next 600 ticks (~10 seconds at 60 fps)
                    activeWaveClearBonus.active = true;
                    activeWaveClearBonus.expiresAtTick = event.tick + 600;
                    break;
                }

                case 'player_death':
                    // Game over — stop processing events
                    break;

                case 'hit':
                case 'miss':
                case 'powerup':
                    // No score impact from these — they inform client state only
                    break;
            }
        }

        // ── Sanity checks ────────────────────────────────────────────────────
        if (score > Config.MAX_PLAUSIBLE_SCORE) {
            return ScoreSimulator.reject(sessionId, playerAddress, 'Score exceeds plausibility ceiling');
        }

        const deviation = clientScore > 0
            ? Math.abs(score - clientScore) / clientScore
            : 1;

        if (deviation > ScoreSimulator.TOLERANCE_PCT) {
            return ScoreSimulator.reject(
                sessionId,
                playerAddress,
                `Score deviation too large: client=${clientScore} server=${score} (${(deviation * 100).toFixed(1)}%)`,
            );
        }

        return {
            sessionId,
            playerAddress,
            validatedScore: score,
            totalBurned,
            wavesCleared,
            kills,
            isValid: true,
        };
    }

    // ── Helpers ──────────────────────────────────────────────────────────────

    /**
     * Compute the scarcity multiplier.
     * At full supply = 1.0x; halved supply = 2.0x; quadratic beyond that.
     */
    private static scarcityMultiplier(initialSupply: bigint, currentSupply: bigint): number {
        if (currentSupply <= 0n) return 4.0;
        const ratio = Number(initialSupply) / Number(currentSupply);
        // Cap at 4x to prevent absurdly large scores
        return Math.min(4.0, ratio);
    }

    private static reject(sessionId: string, playerAddress: string, reason: string): ScoreResult {
        return {
            sessionId,
            playerAddress,
            validatedScore: 0,
            totalBurned: 0n,
            wavesCleared: 0,
            kills: 0,
            isValid: false,
            rejectionReason: reason,
        };
    }
}
