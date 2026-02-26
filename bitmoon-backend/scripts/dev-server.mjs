#!/usr/bin/env node
/**
 * dev-server.mjs — Starts an in-memory MongoDB via mongodb-memory-server,
 * then boots the BitMoon backend.  No system MongoDB install needed.
 *
 * Usage:
 *   node scripts/dev-server.mjs          (after `npm run build`)
 *   npm run dev:mem                       (shortcut)
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { MongoMemoryServer } from 'mongodb-memory-server';

// ── Load .env FIRST so all env vars are available when Config.ts evaluates ──
// (ES module static imports are hoisted, so Config.ts reads process.env before
//  index.ts's inline .env parser runs.  We must beat it here.)
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
}

console.log('[DevServer] Starting in-memory MongoDB...');
const mongod = await MongoMemoryServer.create();
const uri = mongod.getUri();
console.log(`[DevServer] MongoDB ready at ${uri}`);

// Override MONGO_URI so the backend connects to the in-memory instance
process.env.MONGO_URI = uri;

// Import the backend entry point
await import('../dist/index.js');

// Graceful shutdown — stop MongoDB after the backend exits
const cleanup = async () => {
    console.log('[DevServer] Stopping in-memory MongoDB...');
    await mongod.stop();
    process.exit(0);
};
process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);
