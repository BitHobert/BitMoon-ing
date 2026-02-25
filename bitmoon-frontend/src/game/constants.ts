import type { TierNumber } from '../types';

// ── Canvas ────────────────────────────────────────────────────────────────────
export const CANVAS_W = 900;
export const CANVAS_H = 560;

// ── Player ────────────────────────────────────────────────────────────────────
export const PLAYER_SPEED      = 4;      // px/frame
export const PLAYER_LIVES      = 3;
export const PLAYER_INVINCIBLE = 120;    // frames after being hit
export const PLAYER_SIZE       = 24;     // collision radius px
export const PLAYER_SHOOT_RATE = 12;     // frames between auto-shots
export const BULLET_SPEED      = 10;     // px/frame

// ── Planet / Moon ─────────────────────────────────────────────────────────────
export const MOON_SPEED  = 1.2;   // px/frame (slow, player must protect it)
export const MOON_Y_LANE = 0.35;  // fraction of canvas height
export const MOON_RADIUS = 22;    // collision radius px

export interface PlanetConfig {
  readonly glyph:   string;
  readonly penalty: number;  // points lost if enemy destroys it
  readonly label:   string;  // shown in HUD hint
}

export const PLANET_POOL: PlanetConfig[] = [
  { glyph: '🌕', penalty: 10_000, label: 'MOON'      },
  { glyph: '🌍', penalty: 15_000, label: 'EARTH'     },
  { glyph: '🌎', penalty: 15_000, label: 'EARTH'     },
  { glyph: '🌏', penalty: 15_000, label: 'EARTH'     },
  { glyph: '🪐', penalty: 20_000, label: 'SATURN'    },
  { glyph: '🌑', penalty:  5_000, label: 'DARK MOON' },
];

export function randomPlanet(): PlanetConfig {
  return PLANET_POOL[Math.floor(Math.random() * PLANET_POOL.length)];
}

// ── Enemy tiers ───────────────────────────────────────────────────────────────

export interface TierConfig {
  readonly tier: TierNumber;
  readonly glyph:       string;    // emoji rendered on canvas
  readonly hp:          number;
  readonly basePoints:  number;
  readonly burnUnits:   bigint;    // raw supply units consumed per kill
  readonly speedFactor: number;    // multiplier on base enemy speed
  readonly firesBack:   boolean;   // can shoot at player
  readonly ySine:       number;    // y-oscillation amplitude (0 = straight line)
}

export const TIER_CONFIGS: Record<TierNumber, TierConfig> = {
  1: { tier: 1, glyph: '👾', hp: 1, basePoints: 100,  burnUnits: 100_000_000n,   speedFactor: 1.0, firesBack: false, ySine: 0   },
  2: { tier: 2, glyph: '🛸', hp: 2, basePoints: 300,  burnUnits: 500_000_000n,   speedFactor: 1.2, firesBack: false, ySine: 30  },
  3: { tier: 3, glyph: '🤖', hp: 3, basePoints: 750,  burnUnits: 1_000_000_000n, speedFactor: 1.4, firesBack: true,  ySine: 50  },
  4: { tier: 4, glyph: '👻', hp: 5, basePoints: 1500, burnUnits: 5_000_000_000n, speedFactor: 1.6, firesBack: true,  ySine: 20  },
  5: { tier: 5, glyph: '💀', hp: 8, basePoints: 3000, burnUnits: 10_000_000_000n,speedFactor: 2.0, firesBack: true,  ySine: 0   },
};

export const BASE_ENEMY_SPEED = 1.4; // px/frame at speedFactor 1.0

// ── Boss system ───────────────────────────────────────────────────────────────

export interface BossConfig {
  readonly name:         string;
  readonly glyph:        string;
  readonly fontSize:     number;   // px — larger than regular 22px enemies
  readonly hp:           number;
  readonly points:       number;
  readonly burnUnits:    bigint;
  readonly speed:        number;   // lateral patrol speed px/frame
  readonly fireRate:     number;   // frames between shots
  readonly bulletSpread: number;   // bullets per shot (spread fan)
}

export const BOSS_POOL: BossConfig[] = [
  {
    name:         'DEVOURER',
    glyph:        '👹',
    fontSize:     64,
    hp:           60,
    points:       20_000,
    burnUnits:    100_000_000_000n,
    speed:        1.8,
    fireRate:     35,
    bulletSpread: 5,
  },
  // Add more bosses here — they cycle every 5 waves
];

export function isBossWave(waveNum: number): boolean {
  return waveNum % 5 === 0;
}

export function getBossConfig(waveNum: number): BossConfig {
  const idx = (Math.floor(waveNum / 5) - 1) % BOSS_POOL.length;
  return BOSS_POOL[idx];
}

// ── Powerups ──────────────────────────────────────────────────────────────────

export type PowerupKind = 'weapon' | 'shield';

export interface PowerupConfig {
  readonly kind:       PowerupKind;
  readonly glyph:      string;
  readonly label:      string;
  readonly dropChance: number;   // probability per enemy kill
  readonly duration:   number;   // frames (0 = one-shot)
}

export const POWERUP_CONFIGS: Record<PowerupKind, PowerupConfig> = {
  weapon: { kind: 'weapon', glyph: '⚡', label: 'WEAPON BOOST', dropChance: 0.15, duration: 480 }, // 8 s
  shield: { kind: 'shield', glyph: '🛡', label: 'SHIELD',       dropChance: 0.10, duration: 0   }, // one-shot
};

// ── Wave configuration ────────────────────────────────────────────────────────

export interface WaveSpawn {
  readonly tier: TierNumber;
  readonly yFraction: number;  // 0–1 (fraction of canvas height)
  readonly delayFrames: number; // frames after wave start to spawn
  readonly invulnerable: boolean;
}

/** Returns the spawn list for a given wave number (1-indexed). */
export function buildWave(waveNum: number): WaveSpawn[] {
  const spawns: WaveSpawn[] = [];
  let frame = 0;

  // Wave complexity increases with wave number
  const baseCount  = 6 + waveNum * 2;
  const maxTier    = Math.min(5, Math.ceil(waveNum / 2)) as TierNumber;
  // ~20% invulnerable from wave 2 onward
  const invulnRate = waveNum >= 2 ? 0.20 : 0;

  for (let i = 0; i < baseCount; i++) {
    // Pick tier: weighted toward lower tiers early, higher tiers later
    const tierRoll = Math.random();
    let tier: TierNumber = 1;
    if (waveNum >= 2 && tierRoll > 0.6)  tier = Math.min(2, maxTier) as TierNumber;
    if (waveNum >= 3 && tierRoll > 0.75) tier = Math.min(3, maxTier) as TierNumber;
    if (waveNum >= 5 && tierRoll > 0.85) tier = Math.min(4, maxTier) as TierNumber;
    if (waveNum >= 8 && tierRoll > 0.92) tier = 5;

    // Spread enemies across different y-lanes to fill the screen
    const laneCount = 5;
    const laneIndex = i % laneCount;
    const yFraction = (laneIndex + 0.5) / laneCount;

    spawns.push({
      tier,
      yFraction,
      delayFrames: frame,
      invulnerable: Math.random() < invulnRate,
    });

    frame += 28 + Math.floor(Math.random() * 20); // stagger spawns
  }

  return spawns;
}
