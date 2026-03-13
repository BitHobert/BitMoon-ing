/**
 * BitMoon'ing Backend — Entry Point
 *
 * Start order:
 *  1. Load environment variables
 *  2. Start REST API server (health endpoint live immediately)
 *  3. Start WebSocket server
 *  4. Connect to MongoDB (also initialises GameSupplyService)
 *  5. Initialise GiveawayService
 *  6. Start SupplyWatcher (polls DB for supply changes)
 *  7. Register shutdown handlers
 */

import 'node:process';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

// ── Load .env manually (no dotenv dependency needed in Node 20+) ─────────────
const envPath = resolve(process.cwd(), '.env');
if (existsSync(envPath)) {
    const lines = readFileSync(envPath, 'utf8').split('\n');
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx === -1) continue;
        const key = trimmed.slice(0, eqIdx).trim();
        const val = trimmed.slice(eqIdx + 1).trim();
        if (!process.env[key]) process.env[key] = val;
    }
    console.log('[Boot] Loaded .env');
}

// ── Import services (after env is set) ──────────────────────────────────────
import { Config } from './config/Config.js';
import { LeaderboardService } from './services/LeaderboardService.js';
import { GiveawayService } from './services/GiveawayService.js';
import { TournamentService } from './services/TournamentService.js';
import { PrizeDistributorService } from './services/PrizeDistributorService.js';
import { SupplyWatcher } from './services/SupplyWatcher.js';
import { ApiServer } from './server/ApiServer.js';
import { WsServer } from './server/WsServer.js';

async function main(): Promise<void> {
    // ── Mainnet safety checks ────────────────────────────────────────────
    if (Config.OPNET_NETWORK === 'mainnet') {
        if (Config.DEV_MODE) {
            console.error('FATAL: DEV_MODE=true is forbidden on mainnet. Aborting.');
            process.exit(1);
        }
        if (Config.JWT_SECRET.includes('change_me')) {
            console.error('FATAL: JWT_SECRET is still a placeholder. Set a real secret for mainnet. Aborting.');
            process.exit(1);
        }
        if (Config.ADMIN_SECRET.includes('change_me')) {
            console.error('FATAL: ADMIN_SECRET is still a placeholder. Set a real secret for mainnet. Aborting.');
            process.exit(1);
        }
        if (!Config.OPERATOR_PRIVATE_KEY) {
            console.error('FATAL: OPERATOR_PRIVATE_KEY is empty. Aborting.');
            process.exit(1);
        }
        if (Config.CORS_ORIGINS.includes('*')) {
            console.error('FATAL: CORS_ORIGINS=* is not allowed on mainnet. Set your frontend domain. Aborting.');
            process.exit(1);
        }
    }

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log("  BitMoon'ing Backend");
    console.log(`  Network : ${Config.OPNET_NETWORK}`);
    console.log(`  HTTP    : :${Config.HTTP_PORT}`);
    console.log(`  WS      : :${Config.WS_PORT}`);
    console.log(`  DevMode : ${Config.DEV_MODE}`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    // 1. REST API — starts immediately so /health is always reachable
    const api = new ApiServer();
    await api.start();

    // 2. WebSocket — shares the HTTP port when WS_PORT === HTTP_PORT
    //    (required for single-port hosts like Railway)
    const ws = WsServer.getInstance();
    if (Config.WS_PORT === Config.HTTP_PORT) {
        ws.start(api.uwsInstance);
    } else {
        ws.start();
    }

    // 3. MongoDB + dependent services — attempted in background so HTTP stays live
    const leaderboard = LeaderboardService.getInstance();
    const watcher     = SupplyWatcher.getInstance();

    leaderboard.connect()
        .then(async () => {
            const db          = leaderboard.getDb();
            const giveaway    = GiveawayService.getInstance();
            const tourney     = TournamentService.getInstance();
            const prizeDist   = PrizeDistributorService.getInstance();
            await Promise.all([
                giveaway.connect(db),
                tourney.connect(db),
                prizeDist.connect(db),
            ]);
            prizeDist.startWatcher();
            watcher.start();
            console.log('[Boot] All systems go');
        })
        .catch((err: unknown) => {
            console.error('[Boot] MongoDB unavailable — game routes disabled:', (err as Error).message);
        });

    // ── Graceful shutdown ────────────────────────────────────────────────────
    const shutdown = async (signal: string): Promise<void> => {
        console.log(`\n[Boot] Received ${signal} — shutting down…`);
        PrizeDistributorService.getInstance().stopWatcher();
        watcher.stop();
        await api.stop();
        await leaderboard.disconnect();
        console.log('[Boot] Goodbye.');
        process.exit(0);
    };

    process.on('SIGINT',  () => { void shutdown('SIGINT'); });
    process.on('SIGTERM', () => { void shutdown('SIGTERM'); });
}

main().catch((err) => {
    console.error('[Boot] Fatal error:', err);
    process.exit(1);
});
