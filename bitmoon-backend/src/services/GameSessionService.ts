import { createHash } from 'node:crypto';
import { Config } from '../config/Config.js';
import { ScoreSimulator } from '../game/ScoreSimulator.js';
import { GameSupplyService } from './GameSupplyService.js';
import { TournamentService } from './TournamentService.js';
import type { GameSession, ScoreResult, SessionEndRequest, TournamentType } from '../types/index.js';

/**
 * Manages game sessions: creation, expiry, and score submission.
 *
 * Sessions are stored in-memory for fast access during gameplay.
 * The global in-game supply is read from GameSupplyService at session start
 * (so the server can accurately replay scoring) and decremented after a
 * validated session ends.
 */
export class GameSessionService {
    private static instance: GameSessionService;

    /** Active sessions: sessionId → GameSession */
    private readonly sessions: Map<string, GameSession> = new Map();

    /** Supply snapshot per session for anti-cheat replay */
    private readonly sessionSupply: Map<string, bigint> = new Map();

    private readonly gameSupply: GameSupplyService;

    private constructor() {
        this.gameSupply = GameSupplyService.getInstance();
        setInterval(() => { this.pruneExpired(); }, 5 * 60 * 1000);
    }

    public static getInstance(): GameSessionService {
        if (!GameSessionService.instance) {
            GameSessionService.instance = new GameSessionService();
        }
        return GameSessionService.instance;
    }

    // ── Session Lifecycle ───────────────────────────────────────────────────

    /**
     * Create a new game session for an authenticated player.
     * If tournamentType is provided, one turn is atomically consumed from
     * the player's entry. Throws 403 if no turns remain.
     * Snapshots the current game supply for accurate server-side scoring.
     *
     * Returns the session plus turnsRemaining (for tournament sessions).
     */
    public async createSession(
        playerAddress: string,
        tournamentType?: TournamentType,
    ): Promise<GameSession & { turnsRemaining?: number }> {
        // Tournament entry gate — consume one turn atomically
        let tournamentKey: string | undefined;
        let turnsRemaining: number | undefined;
        if (tournamentType !== undefined) {
            const ts = TournamentService.getInstance();
            // getTournamentKey() throws 404 if currently in the inter-period gap
            tournamentKey = await ts.getTournamentKey(tournamentType);
            const turns = await ts.consumeTurn(playerAddress, tournamentType, tournamentKey);
            turnsRemaining = turns.turnsRemaining;
        }

        this.invalidatePlayerSessions(playerAddress);

        const sessionId = this.generateSessionId(playerAddress);
        const now = Date.now();

        const session: GameSession = {
            sessionId,
            playerAddress,
            startedAt: now,
            expiresAt: now + Config.SESSION_TTL_MS,
            isActive: true,
            ...(tournamentType !== undefined ? { tournamentType }              : {}),
            ...(tournamentKey  !== undefined ? { tournamentKey: tournamentKey } : {}),
        };

        const supplyAtStart = await this.gameSupply.getSupplyAtSessionStart();
        this.sessions.set(sessionId, session);
        this.sessionSupply.set(sessionId, supplyAtStart);

        return {
            ...session,
            ...(turnsRemaining !== undefined ? { turnsRemaining } : {}),
        };
    }

    public getSession(sessionId: string): GameSession | null {
        const session = this.sessions.get(sessionId);
        if (!session) return null;
        if (!session.isActive || Date.now() > session.expiresAt) {
            this.sessions.delete(sessionId);
            this.sessionSupply.delete(sessionId);
            return null;
        }
        return session;
    }

    public isSessionOwner(sessionId: string, playerAddress: string): boolean {
        const session = this.getSession(sessionId);
        return session !== null && session.playerAddress === playerAddress;
    }

    // ── Score Submission ────────────────────────────────────────────────────

    /**
     * Finalise a session: run server-side simulation, then burn the validated
     * supply amount from the global game supply counter.
     */
    public async endSession(req: SessionEndRequest): Promise<ScoreResult> {
        const session = this.getSession(req.sessionId);

        if (!session) {
            return this.invalidResult(req.sessionId, req.playerAddress, 'Session not found or expired');
        }

        if (session.playerAddress !== req.playerAddress) {
            return this.invalidResult(req.sessionId, req.playerAddress, 'Session does not belong to this player');
        }

        // Mark inactive immediately to prevent double-submission
        session.isActive = false;

        const initialSupply = this.sessionSupply.get(req.sessionId) ?? Config.INITIAL_SUPPLY;
        this.sessionSupply.delete(req.sessionId);

        const simResult = ScoreSimulator.simulate(
            req.sessionId,
            req.playerAddress,
            req.events,
            req.clientScore,
            req.clientBurned,
            initialSupply,
        );

        // Attach tournament context from the session
        const result: ScoreResult = {
            ...simResult,
            ...(session.tournamentType !== undefined ? { tournamentType: session.tournamentType } : {}),
            ...(session.tournamentKey  !== undefined ? { tournamentKey:  session.tournamentKey  } : {}),
        };

        this.sessions.delete(req.sessionId);

        // Atomically reduce the global game supply for validated kills
        if (result.isValid && result.totalBurned > 0n) {
            await this.gameSupply.burnSupply(result.totalBurned);
        }

        return result;
    }

    // ── Helpers ─────────────────────────────────────────────────────────────

    private invalidResult(sessionId: string, playerAddress: string, reason: string): ScoreResult {
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

    private generateSessionId(playerAddress: string): string {
        return createHash('sha256')
            .update(`${playerAddress}:${Date.now()}:${Math.random()}`)
            .digest('hex');
    }

    private invalidatePlayerSessions(playerAddress: string): void {
        for (const [id, session] of this.sessions) {
            if (session.playerAddress === playerAddress) {
                this.sessions.delete(id);
                this.sessionSupply.delete(id);
            }
        }
    }

    private pruneExpired(): void {
        const now = Date.now();
        for (const [id, session] of this.sessions) {
            if (!session.isActive || now > session.expiresAt) {
                this.sessions.delete(id);
                this.sessionSupply.delete(id);
            }
        }
    }
}
