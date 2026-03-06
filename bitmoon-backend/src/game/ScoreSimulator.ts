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
     * @returns ScoreResult with validated figures
     */
    public static simulate(
        sessionId: string,
        playerAddress: string,
        events: GameEvent[],
        clientScore: number,
        _clientBurned: bigint,
        _initialSupply?: bigint,
    ): ScoreResult {
        if (events.length === 0) {
            return ScoreSimulator.reject(sessionId, playerAddress, 'No events submitted');
        }

        if (events.length > Config.MAX_GAME_TICKS) {
            return ScoreSimulator.reject(sessionId, playerAddress, 'Too many events — possible replay attack');
        }

        // ── Replay state ────────────────────────────────────────────────────
        // IMPORTANT: This must exactly mirror the client-side GameEngine scoring.
        // Uses event.points (sent by client) for kill values — this correctly
        // handles both regular enemies (basePoints) and bosses (boss-specific points).
        let score = 0;
        let kills = 0;
        let wavesCleared = 0;
        let totalBurned = 0n;
        let lastTick = -1;
        let gameOver = false;

        for (const event of events) {
            if (gameOver) break;

            // Enforce monotonic tick ordering (same tick is OK — multiple events per frame)
            if (event.tick < lastTick) {
                return ScoreSimulator.reject(sessionId, playerAddress, 'Non-monotonic tick sequence detected');
            }
            lastTick = event.tick;

            switch (event.type) {
                case 'kill': {
                    if (!event.tier) break;
                    const tier = event.tier as TierNumber;
                    const config = getTierConfig(tier);
                    // Use client-reported points if available (handles bosses),
                    // otherwise fall back to tier basePoints for backwards compat
                    score += event.points ?? config.basePoints;
                    kills++;
                    totalBurned += config.burnPerKill;
                    break;
                }

                case 'wave_clear': {
                    wavesCleared++;
                    break;
                }

                case 'player_death':
                    // Game over — stop processing any remaining events
                    gameOver = true;
                    break;

                case 'miss': {
                    // Planet destroyed — apply penalty if provided
                    if (event.points && event.points < 0) {
                        score = Math.max(0, score + event.points); // points is negative
                    }
                    break;
                }

                case 'hit':
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
