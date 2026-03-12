import HyperExpress from '@btc-vision/hyper-express';
import type uWS from '@btc-vision/uwebsockets.js';
import { Config } from '../config/Config.js';
import { AuthService } from '../services/AuthService.js';
import { GameSessionService } from '../services/GameSessionService.js';
import { LeaderboardService } from '../services/LeaderboardService.js';
import { GameSupplyService } from '../services/GameSupplyService.js';
import { GiveawayService } from '../services/GiveawayService.js';
import { TournamentService } from '../services/TournamentService.js';
import { PaymentService } from '../services/PaymentService.js';
import { PrizeDistributorService } from '../services/PrizeDistributorService.js';
import { OPNetService } from '../services/OPNetService.js';
import { RateLimiter, RATE_LIMITS, type RateLimitConfig } from './RateLimiter.js';
import type {
    GameEvent,
    LeaderboardPeriod,
    LeaderboardType,
    SessionEndRequest,
    SessionStartRequest,
    SponsorBonusRequest,
    TournamentType,
} from '../types/index.js';

type Req = HyperExpress.Request;
type Res = HyperExpress.Response;

/**
 * REST API server using @btc-vision/hyper-express.
 *
 * Public routes:
 *  GET  /health
 *  GET  /v1/supply                        — current game supply + scarcity multiplier
 *  GET  /v1/nonce/:address                — get a sign challenge for OP_WALLET
 *  POST /v1/session/start                 — auth + create session (optional tournamentType)
 *  POST /v1/session/game                  — create game session from existing auth token
 *  POST /v1/session/end                   — submit score
 *  GET  /v1/leaderboard/:period           — score leaderboard (daily/weekly/monthly/alltime)
 *  GET  /v1/leaderboard/:period/burn      — burn leaderboard
 *  GET  /v1/player/:address               — player stats + badges
 *  GET  /v1/tournaments                   — active tournament info + prize pools
 *  GET  /v1/tournament/:type/leaderboard  — tournament-specific score leaderboard
 *
 * Player routes (require Bearer token):
 *  POST /v1/tournament/enter              — submit entry fee tx hash
 *
 * Admin routes (require X-Admin-Secret header):
 *  POST /v1/admin/giveaway/snapshot       — freeze a leaderboard for a giveaway
 *  GET  /v1/admin/giveaway                — list all snapshots
 *  GET  /v1/admin/giveaway/:label         — retrieve a snapshot (wallet + scores)
 *  PATCH /v1/admin/tournament/:type/fee   — update entry fee amount
 *  GET   /v1/admin/tournament/:type       — fee config + pool totals
 */
export class ApiServer {
    private readonly app: HyperExpress.Server;
    private readonly auth: AuthService;
    private readonly sessions: GameSessionService;
    private readonly leaderboard: LeaderboardService;
    private readonly gameSupply: GameSupplyService;
    private readonly giveaway: GiveawayService;
    private readonly tournament: TournamentService;
    private readonly payment: PaymentService;
    private readonly rateLimiter: RateLimiter;

    public constructor() {
        this.app = new HyperExpress.Server({
            max_body_length: 1024 * 1024 * 2,
            fast_abort: true,
            max_body_buffer: 1024 * 64,
            idle_timeout: 60,
            response_timeout: 120,
        });

        this.auth        = AuthService.getInstance();
        this.sessions    = GameSessionService.getInstance();
        this.leaderboard = LeaderboardService.getInstance();
        this.gameSupply  = GameSupplyService.getInstance();
        this.giveaway    = GiveawayService.getInstance();
        this.tournament  = TournamentService.getInstance();
        this.payment     = PaymentService.getInstance();
        this.rateLimiter = new RateLimiter(RATE_LIMITS.public);

        this.app.set_error_handler(this.onError.bind(this));
        this.setupMiddleware();
        this.setupRoutes();
    }

    /** Underlying uWS instance — used to attach WebSocket routes on the same port. */
    public get uwsInstance(): uWS.TemplatedApp {
        return this.app.uws_instance;
    }

    // ── Lifecycle ────────────────────────────────────────────────────────────

    public async start(): Promise<void> {
        await this.app.listen(Config.HTTP_PORT);
        console.log(`[ApiServer] Listening on port ${Config.HTTP_PORT}`);
    }

    public async stop(): Promise<void> {
        this.rateLimiter.destroy();
        await this.app.close();
    }

    // ── Middleware ───────────────────────────────────────────────────────────

    private setupMiddleware(): void {
        const allowedOrigins = Config.CORS_ORIGINS;
        const allowAll = allowedOrigins.length === 1 && allowedOrigins[0] === '*';

        this.app.use((req, res, next) => {
            const origin = req.headers['origin'] ?? '';

            if (allowAll) {
                res.header('Access-Control-Allow-Origin', '*');
            } else if (origin && allowedOrigins.includes(origin)) {
                res.header('Access-Control-Allow-Origin', origin);
                res.header('Vary', 'Origin');
            } else if (origin) {
                // Origin not in allowed list — reject preflight, allow simple requests
                // (browser will block the response due to missing CORS header)
            }

            res.header('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS');
            res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Admin-Secret');

            if (req.method === 'OPTIONS') {
                res.status(204).send();
                return;
            }
            next();
        });
    }

    // ── Routes ───────────────────────────────────────────────────────────────

    private setupRoutes(): void {
        this.app.get('/health', (_req, res) => {
            res.json({ status: 'ok', timestamp: Date.now() });
        });

        this.app.get('/v1/supply', async (req, res) => {
            if (!this.rateLimit(req, res, RATE_LIMITS.public)) return;
            await this.handleSupply(res);
        });

        this.app.get('/v1/nonce/:address', (req, res) => {
            if (!this.rateLimit(req, res, RATE_LIMITS.nonce)) return;
            this.handleNonce(req, res);
        });

        this.app.post('/v1/session/start', async (req, res) => {
            if (!this.rateLimit(req, res, RATE_LIMITS.session)) return;
            await this.handleSessionStart(req, res);
        });

        this.app.post('/v1/session/game', async (req, res) => {
            if (!this.rateLimit(req, res, RATE_LIMITS.session)) return;
            await this.handleCreateGameSession(req, res);
        });

        this.app.post('/v1/session/end', async (req, res) => {
            if (!this.rateLimit(req, res, RATE_LIMITS.submit)) return;
            await this.handleSessionEnd(req, res);
        });

        this.app.get('/v1/leaderboard/:period', async (req, res) => {
            if (!this.rateLimit(req, res, RATE_LIMITS.public)) return;
            await this.handleLeaderboard(req, res, 'score');
        });

        this.app.get('/v1/leaderboard/:period/burn', async (req, res) => {
            if (!this.rateLimit(req, res, RATE_LIMITS.public)) return;
            await this.handleLeaderboard(req, res, 'burned');
        });

        this.app.get('/v1/player/:address', async (req, res) => {
            if (!this.rateLimit(req, res, RATE_LIMITS.public)) return;
            await this.handlePlayer(req, res);
        });

        // Tournament — public
        this.app.get('/v1/tournaments', async (req, res) => {
            if (!this.rateLimit(req, res, RATE_LIMITS.public)) return;
            await this.handleGetTournaments(res);
        });

        this.app.get('/v1/tournament/:type/leaderboard', async (req, res) => {
            if (!this.rateLimit(req, res, RATE_LIMITS.public)) return;
            await this.handleTournamentLeaderboard(req, res);
        });

        this.app.get('/v1/tournament/:type/winners', async (req, res) => {
            if (!this.rateLimit(req, res, RATE_LIMITS.public)) return;
            await this.handleGetLatestWinners(req, res);
        });

        this.app.get('/v1/tournament/:type/turns/:address', async (req, res) => {
            if (!this.rateLimit(req, res, RATE_LIMITS.public)) return;
            await this.handleGetRemainingTurns(req, res);
        });

        // Tournament — player (Bearer auth)
        this.app.post('/v1/tournament/enter', async (req, res) => {
            if (!this.rateLimit(req, res, RATE_LIMITS.entry)) return;
            await this.handleTournamentEnter(req, res);
        });

        // Admin — giveaway
        this.app.post('/v1/admin/giveaway/snapshot', async (req, res) => {
            if (!this.rateLimit(req, res, RATE_LIMITS.admin)) return;
            await this.handleAdminSnapshot(req, res);
        });

        this.app.get('/v1/admin/giveaway', async (req, res) => {
            if (!this.rateLimit(req, res, RATE_LIMITS.admin)) return;
            await this.handleAdminListSnapshots(req, res);
        });

        this.app.get('/v1/admin/giveaway/:label', async (req, res) => {
            if (!this.rateLimit(req, res, RATE_LIMITS.admin)) return;
            await this.handleAdminGetSnapshot(req, res);
        });

        // Admin — tournament fees
        this.app.patch('/v1/admin/tournament/:type/fee', async (req, res) => {
            if (!this.rateLimit(req, res, RATE_LIMITS.admin)) return;
            await this.handleAdminUpdateFee(req, res);
        });

        this.app.get('/v1/admin/tournament/:type', async (req, res) => {
            if (!this.rateLimit(req, res, RATE_LIMITS.admin)) return;
            await this.handleAdminGetTournament(req, res);
        });

        this.app.get('/v1/admin/prize-distributions', async (req, res) => {
            if (!this.rateLimit(req, res, RATE_LIMITS.admin)) return;
            await this.handleAdminListDistributions(req, res);
        });

        // Admin — sponsor bonus deposit & query
        this.app.post('/v1/admin/sponsor-bonus', async (req, res) => {
            if (!this.rateLimit(req, res, RATE_LIMITS.admin)) return;
            await this.handleAdminDepositBonus(req, res);
        });

        this.app.get('/v1/admin/sponsor-bonus', async (req, res) => {
            if (!this.rateLimit(req, res, RATE_LIMITS.admin)) return;
            await this.handleAdminGetBonuses(req, res);
        });
    }

    // ── Public Handlers ───────────────────────────────────────────────────────

    private async handleSupply(res: Res): Promise<void> {
        const snapshot = await this.gameSupply.getSnapshot();
        res.json({
            currentSupply: snapshot.currentSupply.toString(),
            totalBurned: snapshot.totalBurned.toString(),
            scarcityMultiplier: snapshot.scarcityMultiplier,
            sequenceNumber: snapshot.sequenceNumber,
            timestamp: snapshot.timestamp,
        });
    }

    private handleNonce(req: Req, res: Res): void {
        const { address } = req.params;
        if (!address) { res.status(400).json({ error: 'Missing address' }); return; }
        try {
            const message = this.auth.generateChallenge(address);
            res.json({ message });
        } catch (err) {
            res.status(400).json({ error: String(err) });
        }
    }

    private async handleSessionStart(req: Req, res: Res): Promise<void> {
        let body: SessionStartRequest & { tournamentType?: TournamentType; publicKey?: string };
        try { body = await req.json() as typeof body; }
        catch { res.status(400).json({ error: 'Invalid JSON body' }); return; }

        const { playerAddress, signature, message, tournamentType, publicKey } = body;
        if (!playerAddress || !signature || !message) {
            res.status(400).json({ error: 'Missing playerAddress, signature, or message' });
            return;
        }

        if (!this.auth.verifySignature(playerAddress, message, signature, publicKey)) {
            res.status(401).json({ error: 'Invalid signature' });
            return;
        }

        try {
            const session = await this.sessions.createSession(playerAddress, tournamentType);
            const token   = this.auth.issueSessionToken(playerAddress, session.sessionId);
            res.json({ sessionId: session.sessionId, token, expiresAt: session.expiresAt });
        } catch (err: unknown) {
            const statusCode = (err as { statusCode?: number }).statusCode ?? 400;
            res.status(statusCode).json({ error: (err as Error).message });
        }
    }

    /**
     * Create a fresh game session from an existing auth token.
     * No wallet re-signing needed — the Bearer token proves identity.
     * Body: { tournamentType?: TournamentType }
     */
    private async handleCreateGameSession(req: Req, res: Res): Promise<void> {
        const playerAddress = this.extractTokenSubject(req);
        if (!playerAddress) {
            res.status(401).json({ error: 'Missing or invalid Authorization header' });
            return;
        }

        let body: { tournamentType?: TournamentType };
        try { body = await req.json() as typeof body; }
        catch { body = {}; }

        const { tournamentType } = body;

        try {
            const session = await this.sessions.createSession(playerAddress, tournamentType);
            const token   = this.auth.issueSessionToken(playerAddress, session.sessionId);

            if (Config.DEV_MODE) {
                console.log('[ApiServer] Game session created:', {
                    sessionId: session.sessionId,
                    playerAddress,
                    tournamentType: tournamentType ?? 'none',
                });
            }

            res.json({
                sessionId:      session.sessionId,
                token,
                expiresAt:      session.expiresAt,
                turnsRemaining: session.turnsRemaining,
            });
        } catch (err: unknown) {
            const statusCode = (err as { statusCode?: number }).statusCode ?? 400;
            res.status(statusCode).json({ error: (err as Error).message });
        }
    }

    private async handleSessionEnd(req: Req, res: Res): Promise<void> {
        const playerAddress = this.extractTokenSubject(req);
        if (!playerAddress) {
            res.status(401).json({ error: 'Missing or invalid Authorization header' });
            return;
        }

        let body: { sessionId: string; events: GameEvent[]; clientScore: number; clientBurned: string };
        try { body = await req.json() as typeof body; }
        catch { res.status(400).json({ error: 'Invalid JSON body' }); return; }

        const { sessionId, events, clientScore, clientBurned } = body;
        if (!sessionId || !events || clientScore === undefined || !clientBurned) {
            res.status(400).json({ error: 'Missing required fields' });
            return;
        }

        if (Config.DEV_MODE) {
            const activeCount = this.sessions.activeCount;
            console.log('[ApiServer] endSession request:', {
                sessionId,
                playerAddress,
                eventsCount: events.length,
                clientScore,
                activeSessions: activeCount,
            });
        }

        const endReq: SessionEndRequest = {
            sessionId,
            playerAddress,
            events,
            clientScore,
            clientBurned: BigInt(clientBurned),
        };

        const result = await this.sessions.endSession(endReq);

        if (result.isValid) {
            await this.leaderboard.saveResult(result);
        }

        // Calculate remaining turns so the frontend can show "Play Next Turn" or "Buy More"
        let turnsRemaining: number | undefined;
        if (result.tournamentType && result.tournamentKey) {
            try {
                turnsRemaining = await this.tournament.getRemainingTurns(
                    playerAddress, result.tournamentType, result.tournamentKey,
                );
            } catch { /* non-critical — default to undefined */ }
        }

        if (Config.DEV_MODE) {
            console.log('[ApiServer] Session end:', {
                sessionId, valid: result.isValid,
                score: result.validatedScore, reason: result.rejectionReason,
                turnsRemaining,
            });
        }

        res.json({
            isValid: result.isValid,
            validatedScore: result.validatedScore,
            totalBurned: result.totalBurned.toString(),
            wavesCleared: result.wavesCleared,
            kills: result.kills,
            rejectionReason: result.rejectionReason ?? null,
            tournamentType: result.tournamentType ?? null,
            turnsRemaining: turnsRemaining ?? 0,
        });
    }

    private async handleLeaderboard(req: Req, res: Res, type: LeaderboardType): Promise<void> {
        const period = req.params['period'] as LeaderboardPeriod | undefined;
        if (!period || !['daily', 'weekly', 'monthly', 'alltime'].includes(period)) {
            res.status(400).json({ error: 'period must be daily | weekly | monthly | alltime' });
            return;
        }
        const limit = Math.min(parseInt(String(req.query_parameters?.['limit'] ?? '100'), 10), 500);
        const entries = type === 'burned'
            ? await this.leaderboard.getBurnLeaderboard(period, limit)
            : await this.leaderboard.getLeaderboard(period, limit);
        res.json({ period, type, entries });
    }

    private async handlePlayer(req: Req, res: Res): Promise<void> {
        const { address } = req.params;
        if (!address) { res.status(400).json({ error: 'Missing address' }); return; }
        const stats = await this.leaderboard.getPlayerStats(address);
        if (!stats) { res.status(404).json({ error: 'Player not found' }); return; }
        res.json(stats);
    }

    // ── Tournament Handlers ───────────────────────────────────────────────────

    private async handleGetTournaments(res: Res): Promise<void> {
        const tournaments = await this.tournament.getActiveTournaments();

        // Attach sponsor bonuses for each tournament period (non-blocking — failures return empty array)
        const prizeService = PrizeDistributorService.getInstance();
        const enriched = await Promise.all(
            tournaments.map(async (t) => {
                try {
                    const bonuses = await prizeService.getBonusesForPeriod(t.tournamentType, t.tournamentKey);
                    if (bonuses.length === 0) return t;
                    return {
                        ...t,
                        sponsorBonuses: bonuses.map(b => ({
                            tokenAddress: b.tokenAddress,
                            tokenSymbol: b.tokenSymbol,
                            amount: b.amount,
                            decimals: b.decimals ?? 8,
                            links: b.links ?? [],
                        })),
                    };
                } catch {
                    return t;
                }
            }),
        );

        // Include the current OPNet block so the frontend can display countdown
        const currentBlock = await OPNetService.getInstance().getBlockNumber();
        res.json({ tournaments: enriched, currentBlock: currentBlock.toString() });
    }

    private async handleTournamentLeaderboard(req: Req, res: Res): Promise<void> {
        const type = req.params['type'] as TournamentType | undefined;
        if (!type || !['daily', 'weekly', 'monthly'].includes(type)) {
            res.status(400).json({ error: 'type must be daily | weekly | monthly' });
            return;
        }
        try {
            const key   = await this.tournament.getTournamentKey(type);
            const limit = Math.min(parseInt(String(req.query_parameters?.['limit'] ?? '100'), 10), 500);
            const entries = await this.leaderboard.getTournamentLeaderboard(type, key, limit);
            res.json({ tournamentType: type, tournamentKey: key, entries });
        } catch (err: unknown) {
            const statusCode = (err as { statusCode?: number }).statusCode ?? 500;
            res.status(statusCode).json({ error: (err as Error).message });
        }
    }

    private async handleTournamentEnter(req: Req, res: Res): Promise<void> {
        const playerAddress = this.extractTokenSubject(req);
        if (!playerAddress) {
            res.status(401).json({ error: 'Missing or invalid Authorization header' });
            return;
        }

        let body: { tournamentType: TournamentType; txHash: string; quantity?: number };
        try { body = await req.json() as typeof body; }
        catch { res.status(400).json({ error: 'Invalid JSON body' }); return; }

        const { tournamentType, txHash } = body;
        const quantity = Math.max(1, Math.min(10, Math.floor(body.quantity ?? 1)));
        if (!tournamentType || !txHash) {
            res.status(400).json({ error: 'Missing tournamentType or txHash' });
            return;
        }
        if (!['daily', 'weekly', 'monthly'].includes(tournamentType)) {
            res.status(400).json({ error: 'tournamentType must be daily | weekly | monthly' });
            return;
        }

        // Resolve current period — new purchases only allowed while active
        let key: string;
        try {
            const period = await this.tournament.getCurrentPeriod(tournamentType);
            if (!period.isActive) {
                res.status(404).json({ error: `No active ${tournamentType} tournament right now (in gap between periods)` });
                return;
            }
            key = period.tournamentKey;
        } catch (err: unknown) {
            const statusCode = (err as { statusCode?: number }).statusCode ?? 500;
            res.status(statusCode).json({ error: (err as Error).message });
            return;
        }

        // Allow re-entry — each payment purchases N turns (quantity × fee).
        // Verify on-chain payment
        const verification = await this.payment.verifyPayment(txHash, playerAddress, tournamentType, quantity);

        if (verification.amountPaid === 0n && verification.confirmations === 0) {
            res.status(400).json({ error: verification.reason ?? 'Payment verification failed' });
            return;
        }

        try {
            // Deferred split: pool amounts start at '0' — the 5/15/80 split happens
            // per-turn when the player actually plays (in consumeTurn).
            // feePerTurn = total paid ÷ turns purchased.
            const feePerTurn = quantity > 0
                ? (verification.amountPaid / BigInt(quantity)).toString()
                : '0';

            const entry = await this.tournament.recordEntry({
                tournamentType,
                tournamentKey:  key,
                playerAddress,
                paymentTxHash:  txHash,
                amountPaid:     verification.amountPaid.toString(),
                devAmount:      '0',
                nextPoolAmount: '0',
                prizeAmount:    '0',
                paidAt:         Date.now(),
                confirmations:  verification.confirmations,
                isVerified:     verification.valid,
                turnsTotal:     quantity,
                turnsRemaining: quantity,
                feePerTurn,
            });

            // Notify the on-chain contract to update pool accounting (non-blocking)
            if (verification.valid) {
                void PrizeDistributorService.getInstance()
                    .notifyEntry(tournamentType, key, verification.amountPaid)
                    .catch(err => console.error('[ApiServer] notifyEntry failed:', err));
            }

            res.json({
                success:       true,
                entry:         { id: entry._id, tournamentType, tournamentKey: key },
                confirmations: verification.confirmations,
                isVerified:    verification.valid,
                turnsTotal:    quantity,
                message:       verification.valid
                    ? `Entry confirmed — ${quantity} turn${quantity > 1 ? 's' : ''} purchased.`
                    : `Entry pending — waiting for ${Config.MIN_PAYMENT_CONFIRMATIONS} confirmation(s).`,
            });
        } catch (err: unknown) {
            // MongoDB duplicate key (code 11000) = same txHash or same player/period
            // Treat as success — the player is already entered, let them play.
            const code = (err as { code?: number }).code;
            if (code === 11000) {
                res.json({
                    success:       true,
                    entry:         { tournamentType, tournamentKey: key },
                    confirmations: verification.confirmations,
                    isVerified:    verification.valid,
                    message:       'Entry already recorded — you can start playing.',
                });
            } else {
                throw err;
            }
        }
    }

    // ── Admin Handlers ────────────────────────────────────────────────────────

    private async handleAdminSnapshot(req: Req, res: Res): Promise<void> {
        if (!this.verifyAdmin(req, res)) return;

        let body: { label: string; period: LeaderboardPeriod; type: LeaderboardType; limit?: number };
        try { body = await req.json() as typeof body; }
        catch { res.status(400).json({ error: 'Invalid JSON body' }); return; }

        const { label, period, type, limit } = body;
        if (!label || !period || !type) {
            res.status(400).json({ error: 'Missing label, period, or type' });
            return;
        }

        try {
            const snapshot = await this.giveaway.snapshotLeaderboard(label, period, type, limit);
            res.json({ success: true, snapshot });
        } catch (err) {
            res.status(409).json({ error: String(err) });
        }
    }

    private async handleAdminListSnapshots(req: Req, res: Res): Promise<void> {
        if (!this.verifyAdmin(req, res)) return;
        const snapshots = await this.giveaway.listSnapshots();
        res.json({ snapshots });
    }

    private async handleAdminGetSnapshot(req: Req, res: Res): Promise<void> {
        if (!this.verifyAdmin(req, res)) return;
        const { label } = req.params;
        if (!label) { res.status(400).json({ error: 'Missing label' }); return; }
        const snapshot = await this.giveaway.getSnapshot(label);
        if (!snapshot) { res.status(404).json({ error: 'Snapshot not found' }); return; }
        res.json(snapshot);
    }

    private async handleAdminUpdateFee(req: Req, res: Res): Promise<void> {
        if (!this.verifyAdmin(req, res)) return;

        const type = req.params['type'] as TournamentType | undefined;
        if (!type || !['daily', 'weekly', 'monthly'].includes(type)) {
            res.status(400).json({ error: 'type must be daily | weekly | monthly' });
            return;
        }

        let body: { amount: string };
        try { body = await req.json() as typeof body; }
        catch { res.status(400).json({ error: 'Invalid JSON body' }); return; }

        const { amount } = body;
        // Validate: must be a positive integer string
        if (!amount || !/^\d+$/.test(amount) || BigInt(amount) <= 0n) {
            res.status(400).json({ error: 'amount must be a positive integer string (raw token units)' });
            return;
        }

        await this.tournament.updateFeeConfig(type, amount);
        const config = await this.tournament.getFeeConfig(type);
        res.json({ success: true, config });
    }

    private async handleAdminGetTournament(req: Req, res: Res): Promise<void> {
        if (!this.verifyAdmin(req, res)) return;

        const type = req.params['type'] as TournamentType | undefined;
        if (!type || !['daily', 'weekly', 'monthly'].includes(type)) {
            res.status(400).json({ error: 'type must be daily | weekly | monthly' });
            return;
        }

        // Use computePeriod with current block; fall back gracefully if RPC unavailable
        let period;
        try {
            period = await this.tournament.getCurrentPeriod(type);
        } catch {
            res.status(503).json({ error: 'Unable to fetch current block from OPNet RPC' });
            return;
        }

        const key = period.tournamentKey;
        const [config, prizePool, nextPool, pendingPool, entrantCount] = await Promise.all([
            this.tournament.getFeeConfig(type),
            this.tournament.getPrizePool(type, key),
            this.tournament.getNextPool(type, key),
            this.tournament.getPendingPool(type, key),
            this.tournament.getEntryCount(type, key),
        ]);

        res.json({
            type,
            tournamentKey:   key,
            tokenAddress:    Config.ENTRY_TOKEN_ADDRESS,
            entryFee:        config.entryFee,
            updatedAt:       config.updatedAt,
            prizePool:       prizePool.toString(),
            nextPool:        nextPool.toString(),
            pendingPool:     pendingPool.toString(),
            entrantCount,
            startsAtBlock:   period.startsAtBlock.toString(),
            endsAtBlock:     period.endsAtBlock.toString(),
            prizeBlock:      period.prizeBlock.toString(),
            nextStartBlock:  period.nextStartBlock.toString(),
            isActive:        period.isActive,
        });
    }

    /** GET /v1/tournament/:type/winners — recent prize distributions for this tournament type */
    private async handleGetLatestWinners(req: Req, res: Res): Promise<void> {
        const type = req.params['type'] as string;
        if (!['daily', 'weekly', 'monthly'].includes(type)) {
            res.status(400).json({ error: `Invalid tournament type: ${type}` });
            return;
        }
        const limit = Math.min(parseInt(String(req.query['limit'] ?? '10'), 10), 50);
        const distributions = await PrizeDistributorService.getInstance()
            .getRecentDistributions(type as TournamentType, limit);
        // Keep backward compat: also include `distribution` (latest single) for older clients
        res.json({
            tournamentType: type,
            distribution: distributions[0] ?? null,
            distributions,
        });
    }

    /** GET /v1/tournament/:type/turns/:address — remaining turns for a player */
    private async handleGetRemainingTurns(req: Req, res: Res): Promise<void> {
        const type = req.params['type'] as string;
        if (!['daily', 'weekly', 'monthly'].includes(type)) {
            res.status(400).json({ error: `Invalid tournament type: ${type}` });
            return;
        }
        const address = req.params['address'] as string;
        if (!address) {
            res.status(400).json({ error: 'Missing address parameter' });
            return;
        }
        let key: string;
        try {
            key = await this.tournament.getTournamentKey(type as TournamentType);
        } catch {
            res.json({ turnsRemaining: 0 });
            return;
        }
        // Catch up any stranded entries from past periods before counting
        await this.tournament.catchUpRollovers(address, type as TournamentType, key);
        const turnsRemaining = await this.tournament.getRemainingTurns(address, type as TournamentType, key);
        res.json({ turnsRemaining });
    }

    /** GET /v1/admin/prize-distributions — paginated list of all distributions */
    private async handleAdminListDistributions(req: Req, res: Res): Promise<void> {
        if (!this.verifyAdmin(req, res)) return;
        const limit  = Math.min(parseInt(String(req.query['limit']  ?? '20'), 10), 100);
        const offset = Math.max(parseInt(String(req.query['offset'] ?? '0'), 10), 0);
        const distributions = await PrizeDistributorService.getInstance()
            .getDistributions(limit, offset);
        res.json({ distributions, limit, offset });
    }

    /**
     * POST /v1/admin/sponsor-bonus
     * Body: { tournamentType, periodKey, tokenAddress, amount }
     *
     * The operator must verify the sponsor's OP-20 token transfer to the PrizeDistributor
     * contract address BEFORE calling this endpoint. This records the bonus on-chain.
     */
    private async handleAdminDepositBonus(req: Req, res: Res): Promise<void> {
        if (!this.verifyAdmin(req, res)) return;

        let body: SponsorBonusRequest;
        try { body = await req.json() as SponsorBonusRequest; }
        catch { res.status(400).json({ error: 'Invalid JSON body' }); return; }

        const { tournamentType, periodKey, tokenAddress, tokenSymbol, amount, decimals, links } = body;

        if (!tournamentType || !['daily', 'weekly', 'monthly'].includes(tournamentType)) {
            res.status(400).json({ error: 'tournamentType must be daily | weekly | monthly' });
            return;
        }
        if (!periodKey || !/^\d+$/.test(periodKey)) {
            res.status(400).json({ error: 'periodKey must be a non-negative integer string' });
            return;
        }
        if (!tokenAddress || typeof tokenAddress !== 'string' || tokenAddress.trim() === '') {
            res.status(400).json({ error: 'tokenAddress must be a non-empty string' });
            return;
        }
        if (!tokenSymbol || typeof tokenSymbol !== 'string' || tokenSymbol.trim() === '') {
            res.status(400).json({ error: 'tokenSymbol must be a non-empty string (e.g. "MOTO")' });
            return;
        }
        if (!amount || !/^\d+$/.test(amount) || BigInt(amount) <= 0n) {
            res.status(400).json({ error: 'amount must be a positive integer string (raw token units)' });
            return;
        }

        try {
            const bonus = await PrizeDistributorService.getInstance()
                .depositBonus(tournamentType, periodKey, tokenAddress.trim(), tokenSymbol.trim().toUpperCase(), BigInt(amount), decimals ?? 8, links ?? []);
            res.status(201).json({ success: true, bonus });
        } catch (err: unknown) {
            const message = (err as Error).message ?? 'depositBonus failed';
            res.status(500).json({ error: message });
        }
    }

    /**
     * GET /v1/admin/sponsor-bonus?tournamentType=daily&periodKey=100
     * Returns all sponsor bonuses recorded for the specified tournament period.
     */
    private async handleAdminGetBonuses(req: Req, res: Res): Promise<void> {
        if (!this.verifyAdmin(req, res)) return;

        const tournamentType = String(req.query['tournamentType'] ?? '') as TournamentType;
        const periodKey      = String(req.query['periodKey']      ?? '');

        if (!['daily', 'weekly', 'monthly'].includes(tournamentType)) {
            res.status(400).json({ error: 'tournamentType query param must be daily | weekly | monthly' });
            return;
        }
        if (!/^\d+$/.test(periodKey)) {
            res.status(400).json({ error: 'periodKey query param must be a non-negative integer string' });
            return;
        }

        const bonuses = await PrizeDistributorService.getInstance()
            .getBonusesForPeriod(tournamentType, periodKey);
        res.json({ tournamentType, periodKey, bonuses });
    }

    // ── Helpers ──────────────────────────────────────────────────────────────

    /**
     * Enforce rate limit for a request. Returns true if the request is allowed.
     * Sends a 429 response and returns false if rate-limited.
     */
    private rateLimit(req: Req, res: Res, config: RateLimitConfig): boolean {
        const ip = req.ip;
        const key = `${ip}:${req.path}`;
        if (!this.rateLimiter.allow(key, config)) {
            const remaining = this.rateLimiter.remaining(key, config);
            res.header('Retry-After', String(Math.ceil(config.windowMs / 1000)));
            res.header('X-RateLimit-Limit', String(config.maxRequests));
            res.header('X-RateLimit-Remaining', String(remaining));
            res.status(429).json({ error: 'Too many requests — slow down' });
            return false;
        }
        return true;
    }

    private extractTokenSubject(req: Req): string | null {
        const header = req.headers['authorization'] ?? '';
        if (!header.startsWith('Bearer ')) return null;
        const payload = this.auth.verifySessionToken(header.slice(7));
        return payload?.sub ?? null;
    }

    private verifyAdmin(req: Req, res: Res): boolean {
        const secret = req.headers['x-admin-secret'] ?? '';
        if (secret !== Config.ADMIN_SECRET) {
            res.status(401).json({ error: 'Unauthorized' });
            return false;
        }
        return true;
    }

    private onError(_req: Req, res: Res, err: Error): void {
        if (Config.DEV_MODE) console.error('[ApiServer] Unhandled error:', err);
        if (res.closed) return;
        res.atomic(() => {
            res.status(500).json({ error: 'Internal server error' });
        });
    }
}
