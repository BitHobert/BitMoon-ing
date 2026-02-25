import type { TierNumber } from '../types';
import type { TierConfig, BossConfig, PlanetConfig, WaveSpawn, PowerupKind } from './constants';

// ── Entities ──────────────────────────────────────────────────────────────────

export interface PlayerEntity {
  x: number;
  y: number;
  lives: number;
  invincibleFrames: number;  // counts down to 0
}

export interface EnemyEntity {
  id: number;
  x: number;
  y: number;
  baseY: number;             // y-lane center (for sine oscillation)
  phase: number;             // sine phase offset (random per enemy)
  vx: number;                // rightward speed
  tier: TierNumber;
  cfg: TierConfig;
  hp: number;
  maxHp: number;
  invulnerable: boolean;     // bullets pass through; player must dodge
  alive: boolean;
  flashFrames: number;       // hit flash countdown
}

export interface MoonEntity {
  x: number;
  y: number;
  alive: boolean;
  flashFrames: number;       // flashing when near an enemy
  glyph: string;             // which planet emoji (🌕 🌍 🌎 🌏 🪐 🌑)
  penalty: number;           // points lost if destroyed
}

export interface BossEntity {
  x: number;
  y: number;
  vx: number;                // lateral velocity (bounces at screen edges)
  hp: number;
  maxHp: number;
  alive: boolean;
  flashFrames: number;       // hit flash countdown
  fireTimer: number;         // frames until next shot
  phase: number;             // sine phase for Y oscillation
  cfg: BossConfig;
}

export interface PowerupEntity {
  id:    number;
  x:     number;
  y:     number;
  kind:  PowerupKind;
  alive: boolean;
}

export interface BulletEntity {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  fromPlayer: boolean;
}

export interface ParticleEntity {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;    // 0–1, decreases each frame
  color: string;
  size: number;
}

// ── Game state ────────────────────────────────────────────────────────────────

export type GamePhase =
  | 'waiting'      // between waves
  | 'playing'
  | 'wave_clear'   // short celebration pause
  | 'game_over';

export interface GameState {
  phase:      GamePhase;
  score:      number;
  wave:       number;
  tick:       number;
  kills:      number;
  burned:     bigint;        // raw supply units consumed
  player:     PlayerEntity;
  enemies:    EnemyEntity[];
  moon:       MoonEntity | null;
  boss:       BossEntity | null;        // active boss (boss waves only)
  currentPlanet: PlanetConfig | null;  // planet being protected this wave
  powerups:   PowerupEntity[];
  bullets:    BulletEntity[];
  particles:  ParticleEntity[];
  weaponFrames:  number;   // frames remaining on weapon boost (0 = inactive)
  shieldActive:  boolean;  // absorbs next hit
  nextSpawns: WaveSpawn[];             // queued spawns for current wave
  spawnTick:  number;        // tick when wave started (for spawn timing)
  shootCooldown: number;
  nextEnemyId:    number;
  nextBulletId:   number;
  nextPowerupId:  number;
  moonSpawned:    boolean;    // has the moon been spawned this wave
}

// ── Engine callbacks ──────────────────────────────────────────────────────────

export interface GameCallbacks {
  onScore:    (score: number) => void;
  onWave:     (wave: number) => void;
  onLives:    (lives: number) => void;
  onGameOver: (finalScore: number, burned: bigint) => void;
  onKill:     (tier: TierNumber, points: number, scarcityMultiplier: number) => void;
  onPlanet:   (planet: PlanetConfig | null) => void;
  onPowerup:  (kind: PowerupKind | null, weaponFrames: number, shieldActive: boolean) => void;
}
