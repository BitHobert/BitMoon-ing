# BitMoon — Frontend

> **Deflationary Space Invaders on Bitcoin.**
> Shoot enemies, protect planets, burn supply, climb the leaderboard, win OP-20 prizes.

---

## What is BitMoon?

BitMoon is a browser-based arcade game built on **OPNet / Bitcoin**. Every enemy you destroy burns a small amount of OP-20 token supply on-chain, making the token permanently more scarce. Players compete in daily, weekly, and monthly tournaments for prize pools funded by entry fees.

- 🚀 Classic Space Invaders-style gameplay
- 🔥 Each kill burns real on-chain token supply
- 🪐 Protect planets drifting across the screen — each has a unique penalty if destroyed
- 👹 Boss waves every 5 levels with persistent HP
- 💊 Power-ups: weapon boost & shield
- 🏆 Leaderboard with tournament prize pools

---

## Stack

| Layer | Technology |
|-------|-----------|
| UI | React 18 + TypeScript |
| Build | Vite 5 |
| Game engine | Pure Canvas 2D API (no Phaser/PixiJS) |
| Wallet | OP_WALLET (`window.opnet`) · Unisat |
| Chain | OPNet / Bitcoin |
| Font | Press Start 2P (Google Fonts) |

---

## Getting Started

```bash
# Install dependencies
npm install

# Start dev server (proxies /api → localhost:3000)
npm run dev

# Type check
npx tsc --noEmit

# Production build
npm run build
```

Requires the **bitmoon-backend** running locally for API + WebSocket features.

---

## Game Mechanics

### Enemies
| Tier | Glyph | HP | Points | Fires Back |
|------|-------|----|--------|------------|
| 1 | 👾 | 1 | 100 | No |
| 2 | 🛸 | 2 | 300 | No |
| 3 | 🤖 | 3 | 750 | Yes |
| 4 | 👻 | 5 | 1,500 | Yes |
| 5 | 💀 | 8 | 3,000 | Yes |

~20% of enemies from wave 2 onward are **invulnerable** — dodge them, don't shoot them.

### Planets
A random planet drifts right-to-left each wave. Letting an enemy destroy it costs you points:

| Planet | Label | Penalty |
|--------|-------|---------|
| 🌕 | MOON | 7,000 |
| 🌍 | NEBULA | 10,000 |
| 🌎 | INFERNO | 15,000 |
| 🌏 | EARTH | 20,000 |
| 🪐 | SATURN | 25,000 |
| 🌑 | DARK MOON | 40,000 |

Each planet spawns with a **1-hit shield** (visible cyan force-field ring). The shield absorbs the first enemy collision, then breaks.

### Bosses
Every 5th wave spawns a boss. Bosses patrol laterally, fire bullet spreads, and have persistent HP across encounters.

| Boss | Name | HP | Points |
|------|------|----|--------|
| 1 | DEVOURER 👹 | 60 | 20,000 |
| 2 | ABDUCTOR 🛸 | 80 | 40,000 |
| 3 | OVERLORD 💀 | 100 | 60,000 |
| 4 | WATCHER 👁 | 120 | 80,000 |

### Power-ups
| Glyph | Name | Effect |
|-------|------|--------|
| ⚡ | WEAPON BOOST | Triple fire rate for 8 seconds |
| 💊 | SHIELD | Absorbs next player hit |

---

## Project Structure

```
src/
├── game/
│   ├── constants.ts   — enemy tiers, planets, bosses, wave config
│   ├── types.ts       — entity + state interfaces
│   └── GameEngine.ts  — canvas render loop, physics, collisions
├── pages/
│   ├── LobbyPage.tsx
│   ├── GamePage.tsx
│   └── ResultPage.tsx
├── components/        — WalletButton, LeaderboardTable, etc.
├── hooks/             — useWallet, useAuth
├── context/           — WalletContext, AuthContext, WsContext
├── api/               — http.ts (REST), ws.ts (WebSocket)
└── styles/
    └── theme.css      — dark/neon design tokens
```

---

## Wallet Support

| Wallet | Detection | Sign method |
|--------|-----------|-------------|
| OP_WALLET | `window.opnet` | `MessageSigner.signMessageAuto()` |
| Unisat | `window.unisat` | `window.unisat.signMessage()` |

OP_WALLET is checked first. If neither is installed, an install prompt is shown.

---

## Environment

The Vite dev proxy forwards `/api` to `http://localhost:3000`. For production, point the proxy (or a reverse proxy) at your deployed backend URL.
