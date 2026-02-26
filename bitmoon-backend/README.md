# BitMoon — Backend

> API server, score validation, leaderboards, tournaments, and on-chain supply tracking for the BitMoon game.

---

## What it does

The backend is the authoritative layer between the browser game and the Bitcoin/OPNet chain:

- **Session management** — issues JWT tokens, validates game events client-submitted at session end
- **Score validation** — replays kill events server-side to detect cheating; rejects impossible scores
- **Supply tracking** — watches on-chain OP-20 supply in real time; broadcasts burn updates via WebSocket
- **Leaderboards** — daily / weekly / monthly / all-time rankings stored in MongoDB
- **Tournaments** — entry fee verification, prize pool tracking, winner snapshots
- **Prize distribution** — triggers on-chain prize payouts via the BitMoon prize contract

---

## Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js ≥ 20 |
| Framework | HyperExpress (uWebSockets.js) |
| WebSocket | uWebSockets.js |
| Database | MongoDB |
| Chain | OPNet / Bitcoin |
| Language | TypeScript (ESM) |

---

## Getting Started

```bash
# Install dependencies
npm install

# Build TypeScript
npm run build

# Start production server
npm start

# Development (watch mode)
npm run dev

# Type check only
npm run typecheck
```

### Environment

Create a `.env` file (or set environment variables):

```env
MONGODB_URI=mongodb://localhost:27017/bitmoon
PORT=3000
WS_PORT=3001
JWT_SECRET=your_secret_here
OPNET_RPC_URL=https://...
TOKEN_CONTRACT_ADDRESS=0x...
PRIZE_CONTRACT_ADDRESS=0x...
```

---

## API Overview

### REST — `/v1/`

| Method | Route | Description |
|--------|-------|-------------|
| GET | `/supply` | Current token supply + scarcity multiplier |
| GET | `/nonce/:address` | Auth nonce for wallet signing |
| POST | `/session/start` | Start a game session → returns `sessionId` |
| POST | `/session/end` | Submit game events → returns validated score |
| GET | `/leaderboard/:period` | Top scores (daily/weekly/monthly/alltime) |
| GET | `/player/:address` | Player stats + badge |
| GET | `/tournaments` | Active tournament list |
| POST | `/tournament/enter` | Verify entry fee tx + enrol player |

### WebSocket — port 3001

| Event | Direction | Description |
|-------|-----------|-------------|
| `supply_update` | Server → Client | Live burn amount + scarcity multiplier |
| `kill_feed` | Server → Client | Global kill events from all active sessions |
| `leaderboard_update` | Server → Client | Score changes |
| `ping` / `pong` | Both | Keep-alive |

---

## Project Structure

```
src/
├── index.ts               — entry point
├── server/
│   ├── ApiServer.ts       — REST routes
│   └── WsServer.ts        — WebSocket server
├── services/
│   ├── AuthService.ts     — nonce + JWT
│   ├── GameSessionService.ts  — session lifecycle + score validation
│   ├── GameSupplyService.ts   — supply calc + scarcity multiplier
│   ├── LeaderboardService.ts  — rankings
│   ├── TournamentService.ts   — tournament state
│   ├── PrizeDistributorService.ts  — on-chain prize payouts
│   ├── PaymentService.ts  — entry fee verification
│   ├── OPNetService.ts    — OPNet RPC client
│   ├── SupplyWatcher.ts   — polls chain for burn events
│   ├── CacheService.ts    — in-memory cache layer
│   └── GiveawayService.ts — bonus giveaway logic
├── game/                  — server-side game replay logic
├── contracts/             — ABI + contract interaction helpers
├── config/                — environment + constants
├── types/                 — shared TypeScript interfaces
└── utils/                 — helpers
```

---

## Score Validation

When a session ends the backend:
1. Receives the full `GameEvent[]` array from the client
2. Replays kill events using the same tier config as the frontend
3. Compares computed score against `clientScore`
4. Rejects if delta exceeds tolerance threshold
5. Records validated score to leaderboard + triggers burn accounting
