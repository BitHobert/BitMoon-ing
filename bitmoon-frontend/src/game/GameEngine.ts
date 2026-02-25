import type { GameEvent, TierNumber } from '../types';
import {
  CANVAS_W, CANVAS_H,
  PLAYER_SPEED, PLAYER_LIVES, PLAYER_INVINCIBLE, PLAYER_SIZE, PLAYER_SHOOT_RATE, BULLET_SPEED,
  MOON_SPEED, MOON_Y_LANE, MOON_RADIUS,
  TIER_CONFIGS, BASE_ENEMY_SPEED,
  buildWave, isBossWave, getBossConfig, getBossIndex, randomPlanet,
  POWERUP_CONFIGS,
} from './constants';
import type { PlanetConfig } from './constants';
import type { GameState, GameCallbacks, EnemyEntity, ParticleEntity, PowerupEntity } from './types';

// ── Key state ─────────────────────────────────────────────────────────────────
const KEYS = { ArrowUp: false, ArrowDown: false, ArrowLeft: false, ArrowRight: false,
               w: false, a: false, s: false, d: false };

// ── Renderer helpers ──────────────────────────────────────────────────────────
const TIER_COLORS: Record<TierNumber, string> = {
  1: '#2ecc71', 2: '#3498db', 3: '#9b59b6', 4: '#e67e22', 5: '#e74c3c',
};

export class GameEngine {
  private readonly ctx:    CanvasRenderingContext2D;
  private readonly cbs:    GameCallbacks;
  private scarcityMultiplier: number;
  private state:    GameState;
  private events:   GameEvent[] = [];
  private rafId:    number | null = null;
  // Persistent boss HP: survives between boss waves — key = BOSS_POOL index
  private readonly bossHpPool = new Map<number, number>();
  private readonly boundKeyDown: (e: KeyboardEvent) => void;
  private readonly boundKeyUp:   (e: KeyboardEvent) => void;

  constructor(
    canvas: HTMLCanvasElement,
    scarcityMultiplier: number,
    callbacks: GameCallbacks,
  ) {
    this.scarcityMultiplier = scarcityMultiplier;
    this.cbs    = callbacks;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D context not available');
    this.ctx = ctx;

    this.state = this.buildInitialState();

    this.boundKeyDown = (e: KeyboardEvent) => {
      if (e.key in KEYS) { (KEYS as Record<string, boolean>)[e.key] = true; e.preventDefault(); }
    };
    this.boundKeyUp = (e: KeyboardEvent) => {
      if (e.key in KEYS) { (KEYS as Record<string, boolean>)[e.key] = false; }
    };
  }

  // ── Public API ───────────────────────────────────────────────────────────────

  public start(): void {
    window.addEventListener('keydown', this.boundKeyDown);
    window.addEventListener('keyup',   this.boundKeyUp);
    this.beginWave(1);
    this.loop();
  }

  public stop(): void {
    if (this.rafId !== null) { cancelAnimationFrame(this.rafId); this.rafId = null; }
    window.removeEventListener('keydown', this.boundKeyDown);
    window.removeEventListener('keyup',   this.boundKeyUp);
  }

  public updateScarcity(mult: number): void {
    this.scarcityMultiplier = mult;
  }

  public getEvents():       GameEvent[]        { return [...this.events]; }
  public getScore():        number             { return this.state.score; }
  public getBurned():       bigint             { return this.state.burned; }
  public getCurrentPlanet(): PlanetConfig | null { return this.state.currentPlanet; }

  // ── State init ───────────────────────────────────────────────────────────────

  private buildInitialState(): GameState {
    return {
      phase: 'waiting',
      score: 0, wave: 0, tick: 0, kills: 0,
      burned: 0n,
      player: {
        x: CANVAS_W * 0.75,
        y: CANVAS_H / 2,
        lives: PLAYER_LIVES,
        invincibleFrames: 0,
      },
      enemies:       [],
      moon:          null,
      boss:          null,
      currentPlanet: null,
      powerups:      [],
      bullets:       [],
      particles:     [],
      nextSpawns:    [],
      spawnTick:     0,
      shootCooldown: 0,
      nextEnemyId:    0,
      nextBulletId:   0,
      nextPowerupId:  0,
      moonSpawned:    false,
      weaponFrames:   0,
      shieldActive:   false,
    };
  }

  private beginWave(waveNum: number): void {
    const s = this.state;
    s.wave        = waveNum;
    s.phase       = 'playing';
    s.enemies     = [];
    s.bullets     = [];
    s.powerups    = [];
    s.moon        = null;
    s.moonSpawned = false;
    s.boss        = null;

    if (isBossWave(waveNum)) {
      // Boss wave: no regular enemies, no moon to protect
      s.nextSpawns    = [];
      s.moonSpawned   = true;       // block moon spawn logic
      s.currentPlanet = null;
      this.cbs.onPlanet(null);

      const poolIndex = getBossIndex(waveNum);
      const cfg       = getBossConfig(waveNum);
      // Start with persisted HP (or full HP if first encounter / previously killed)
      const startHp   = this.bossHpPool.get(poolIndex) ?? cfg.hp;
      s.boss = {
        x:           -80,
        y:           CANVAS_H / 2,
        vx:          cfg.speed,
        hp:          startHp,
        maxHp:       cfg.hp,        // always the original max for the bar
        alive:       true,
        flashFrames: 0,
        fireTimer:   cfg.fireRate,
        phase:       0,
        poolIndex,
        cfg,
      };
    } else {
      // Regular wave: random planet to protect
      const planet    = randomPlanet();
      s.currentPlanet = planet;
      s.nextSpawns    = buildWave(waveNum);
      this.cbs.onPlanet(planet);
    }

    s.spawnTick = s.tick;
    this.cbs.onWave(waveNum);
    this.events.push({ tick: s.tick, type: 'wave_clear', wave: waveNum - 1 });
  }

  // ── Main loop ────────────────────────────────────────────────────────────────

  private loop = (): void => {
    this.update();
    this.render();
    this.rafId = requestAnimationFrame(this.loop);
  };

  // ── Update ───────────────────────────────────────────────────────────────────

  private update(): void {
    const s = this.state;
    s.tick++;

    if (s.phase === 'game_over') return;

    if (s.phase === 'wave_clear') {
      // 90-frame pause then start next wave
      if (s.tick - s.spawnTick > 90) this.beginWave(s.wave + 1);
      return;
    }

    this.spawnEnemies();
    this.movePlayer();
    this.autoShoot();
    this.moveBullets();
    this.moveEnemies();
    this.moveMoon();
    this.moveBoss();
    this.bossFire();
    this.movePowerups();
    this.checkCollisions();
    this.updateParticles();
    this.checkWaveClear();

    if (s.shootCooldown > 0) s.shootCooldown--;
    if (s.player.invincibleFrames > 0) s.player.invincibleFrames--;
    if (s.weaponFrames > 0) {
      s.weaponFrames--;
      if (s.weaponFrames === 0) this.cbs.onPowerup(null, 0, s.shieldActive);
    }
  }

  // ── Spawn enemies from left edge ─────────────────────────────────────────────

  private spawnEnemies(): void {
    const s = this.state;
    const elapsedTicks = s.tick - s.spawnTick;

    // Planet: spawn once when first enemy would appear + 30 frames
    if (!s.moonSpawned && s.nextSpawns.length > 0 && elapsedTicks >= s.nextSpawns[0].delayFrames + 30) {
      const planet = s.currentPlanet;
      s.moon = {
        x:           -MOON_RADIUS * 2,
        y:           CANVAS_H * MOON_Y_LANE,
        alive:       true,
        flashFrames: 0,
        glyph:       planet?.glyph   ?? '🌕',
        penalty:     planet?.penalty ?? 10_000,
      };
      s.moonSpawned = true;
    }

    while (s.nextSpawns.length > 0 && elapsedTicks >= s.nextSpawns[0].delayFrames) {
      const spawn = s.nextSpawns.shift()!;
      const cfg   = TIER_CONFIGS[spawn.tier];
      const enemy: EnemyEntity = {
        id:           s.nextEnemyId++,
        x:            -30,
        y:            CANVAS_H * spawn.yFraction,
        baseY:        CANVAS_H * spawn.yFraction,
        phase:        Math.random() * Math.PI * 2,
        vx:           BASE_ENEMY_SPEED * cfg.speedFactor,
        tier:         spawn.tier,
        cfg,
        hp:           cfg.hp,
        maxHp:        cfg.hp,
        invulnerable: spawn.invulnerable,
        alive:        true,
        flashFrames:  0,
      };
      s.enemies.push(enemy);
    }
  }

  // ── Player movement (WASD / arrows, 4-directional) ────────────────────────────

  private movePlayer(): void {
    const p = this.state.player;
    const up    = KEYS.ArrowUp    || KEYS.w;
    const down  = KEYS.ArrowDown  || KEYS.s;
    const left  = KEYS.ArrowLeft  || KEYS.a;
    const right = KEYS.ArrowRight || KEYS.d;

    if (up)    p.y = Math.max(PLAYER_SIZE, p.y - PLAYER_SPEED);
    if (down)  p.y = Math.min(CANVAS_H - PLAYER_SIZE, p.y + PLAYER_SPEED);
    if (left)  p.x = Math.max(PLAYER_SIZE, p.x - PLAYER_SPEED);
    if (right) p.x = Math.min(CANVAS_W - PLAYER_SIZE, p.x + PLAYER_SPEED);
  }

  // ── Auto-aim + shoot toward nearest enemy (or boss) ───────────────────────────

  private autoShoot(): void {
    const s = this.state;
    if (s.shootCooldown > 0) return;

    let targetX: number | null = null;
    let targetY: number | null = null;

    // 1. Find nearest killable regular enemy
    let nearest: EnemyEntity | null = null;
    let bestDist = Infinity;
    for (const e of s.enemies) {
      if (!e.alive || e.invulnerable) continue;
      const dx = e.x - s.player.x;
      const dy = e.y - s.player.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < bestDist) { bestDist = dist; nearest = e; }
    }

    if (nearest) {
      targetX = nearest.x;
      targetY = nearest.y;
    } else if (s.boss?.alive && s.boss.x > 0) {
      // 2. Fall back to boss once it's on-screen
      targetX = s.boss.x;
      targetY = s.boss.y;
    }

    if (targetX === null || targetY === null) return;

    const dx = targetX - s.player.x;
    const dy = targetY - s.player.y;
    const baseAngle = Math.atan2(dy, dx);
    const boosted   = s.weaponFrames > 0;

    // Weapon boost: 3-bullet spread; normal: 1 bullet
    const bulletCount = boosted ? 3 : 1;
    const spreadHalf  = boosted ? Math.PI / 10 : 0; // ±18° fan
    for (let i = 0; i < bulletCount; i++) {
      const angle = bulletCount === 1
        ? baseAngle
        : baseAngle - spreadHalf + (spreadHalf * 2 / (bulletCount - 1)) * i;
      s.bullets.push({
        id:         s.nextBulletId++,
        x:          s.player.x,
        y:          s.player.y,
        vx:         Math.cos(angle) * BULLET_SPEED,
        vy:         Math.sin(angle) * BULLET_SPEED,
        fromPlayer: true,
      });
    }
    // Weapon boost halves the cooldown (faster firing)
    s.shootCooldown = boosted ? Math.ceil(PLAYER_SHOOT_RATE / 2) : PLAYER_SHOOT_RATE;
  }

  // ── Bullet movement ───────────────────────────────────────────────────────────

  private moveBullets(): void {
    const s = this.state;
    for (let i = s.bullets.length - 1; i >= 0; i--) {
      const b = s.bullets[i];
      b.x += b.vx;
      b.y += b.vy;
      if (b.x < -20 || b.x > CANVAS_W + 20 || b.y < -20 || b.y > CANVAS_H + 20) {
        s.bullets.splice(i, 1);
      }
    }
  }

  // ── Enemy movement (left→right + sine oscillation) ────────────────────────────

  private moveEnemies(): void {
    const s = this.state;
    for (let i = s.enemies.length - 1; i >= 0; i--) {
      const e = s.enemies[i];
      if (!e.alive) { s.enemies.splice(i, 1); continue; }
      e.x += e.vx;
      if (e.cfg.ySine > 0) {
        e.y = e.baseY + Math.sin(s.tick * 0.04 + e.phase) * e.cfg.ySine;
      }
      if (e.flashFrames > 0) e.flashFrames--;
      if (e.x > CANVAS_W + 40) s.enemies.splice(i, 1);
    }
  }

  // ── Moon / planet movement ────────────────────────────────────────────────────

  private moveMoon(): void {
    const s = this.state;
    if (!s.moon || !s.moon.alive) return;
    s.moon.x += MOON_SPEED;
    if (s.moon.flashFrames > 0) s.moon.flashFrames--;
    if (s.moon.x > CANVAS_W + MOON_RADIUS * 2) s.moon = null;
  }

  // ── Boss movement (patrol + sine Y) ──────────────────────────────────────────

  private moveBoss(): void {
    const s = this.state;
    if (!s.boss || !s.boss.alive) return;
    const boss = s.boss;

    // Time-based retreat: boss leaves after cfg.duration frames
    const elapsed = s.tick - s.spawnTick;
    if (elapsed >= boss.cfg.duration) {
      // Save current HP so the next encounter continues from here
      this.bossHpPool.set(boss.poolIndex, boss.hp);
      boss.alive = false;
      this.spawnExplosion(boss.x, boss.y, '#888');
      return;
    }

    // Lateral patrol: bounce between 100 ↔ CANVAS_W - 100 (no enrage)
    boss.x += boss.vx;
    if (boss.x >= CANVAS_W - 100) { boss.x = CANVAS_W - 100; boss.vx = -boss.cfg.speed; }
    if (boss.x <= 100)            { boss.x = 100;             boss.vx =  boss.cfg.speed; }

    // Sine Y oscillation ±120 px, clamped to canvas
    boss.phase += 0.02;
    boss.y = Math.max(60, Math.min(CANVAS_H - 60,
      CANVAS_H / 2 + Math.sin(boss.phase) * 120,
    ));

    if (boss.flashFrames > 0) boss.flashFrames--;
  }

  // ── Boss firing (spread fan aimed at player) ──────────────────────────────────

  private bossFire(): void {
    const s = this.state;
    if (!s.boss || !s.boss.alive) return;
    const boss = s.boss;

    boss.fireTimer--;
    if (boss.fireTimer > 0) return;
    boss.fireTimer = boss.cfg.fireRate;

    const spread     = boss.cfg.bulletSpread;
    const dx         = s.player.x - boss.x;
    const dy         = s.player.y - boss.y;
    const baseAngle  = Math.atan2(dy, dx);
    const fanHalf    = Math.PI / 5; // ±36° total spread

    for (let i = 0; i < spread; i++) {
      const angle = spread === 1
        ? baseAngle
        : baseAngle - fanHalf + (fanHalf * 2 / (spread - 1)) * i;
      const speed = 4.5;
      s.bullets.push({
        id:         s.nextBulletId++,
        x:          boss.x,
        y:          boss.y,
        vx:         Math.cos(angle) * speed,
        vy:         Math.sin(angle) * speed,
        fromPlayer: false,
      });
    }
  }

  // ── Powerup movement ──────────────────────────────────────────────────────────

  private movePowerups(): void {
    const s = this.state;
    for (let i = s.powerups.length - 1; i >= 0; i--) {
      const pu = s.powerups[i];
      pu.x += 0.8; // drift slowly rightward
      if (pu.x > CANVAS_W + 30) s.powerups.splice(i, 1);
    }
  }

  // ── Collision detection ───────────────────────────────────────────────────────

  private checkCollisions(): void {
    const s = this.state;

    // Player bullets vs regular enemies
    for (let bi = s.bullets.length - 1; bi >= 0; bi--) {
      const b = s.bullets[bi];
      if (!b.fromPlayer) continue;

      for (const e of s.enemies) {
        if (!e.alive) continue;
        const dx = b.x - e.x;
        const dy = b.y - e.y;
        if (Math.sqrt(dx * dx + dy * dy) > 22) continue;

        if (e.invulnerable) {
          e.flashFrames = 4;
          s.bullets.splice(bi, 1);
          break;
        }

        e.hp--;
        e.flashFrames = 8;
        s.bullets.splice(bi, 1);

        if (e.hp <= 0) {
          e.alive = false;
          const pts = Math.round(e.cfg.basePoints * this.scarcityMultiplier);
          s.score += pts;
          s.kills++;
          s.burned += e.cfg.burnUnits;
          this.spawnExplosion(e.x, e.y, TIER_COLORS[e.tier]);
          this.events.push({ tick: s.tick, type: 'kill', tier: e.tier, wave: s.wave });
          this.cbs.onScore(s.score);
          this.cbs.onKill(e.tier, pts, this.scarcityMultiplier);
          // Chance to drop a powerup
          this.tryDropPowerup(e.x, e.y);
        }
        break;
      }
    }

    // Player bullets vs boss
    if (s.boss?.alive) {
      for (let bi = s.bullets.length - 1; bi >= 0; bi--) {
        const b = s.bullets[bi];
        if (!b.fromPlayer) continue;
        const dx = b.x - s.boss.x;
        const dy = b.y - s.boss.y;
        if (Math.sqrt(dx * dx + dy * dy) > 40) continue;

        s.boss.hp--;
        s.boss.flashFrames = 8;
        s.bullets.splice(bi, 1);

        if (s.boss.hp <= 0) {
          s.boss.alive = false;
          // Reset persisted HP — next encounter starts fresh
          this.bossHpPool.delete(s.boss.poolIndex);
          const pts = Math.round(s.boss.cfg.points * this.scarcityMultiplier);
          s.score += pts;
          s.kills++;
          s.burned += s.boss.cfg.burnUnits;
          // Triple explosion for dramatic effect
          this.spawnExplosion(s.boss.x,      s.boss.y,      '#ff4500');
          this.spawnExplosion(s.boss.x + 25, s.boss.y - 25, '#ffd700');
          this.spawnExplosion(s.boss.x - 25, s.boss.y + 25, '#ff4500');
          this.events.push({ tick: s.tick, type: 'kill', tier: 5, wave: s.wave });
          this.cbs.onScore(s.score);
          this.cbs.onKill(5, pts, this.scarcityMultiplier);
        }
        break;
      }
    }

    // Enemy / boss bullets vs player
    for (let bi = s.bullets.length - 1; bi >= 0; bi--) {
      const b = s.bullets[bi];
      if (b.fromPlayer) continue;
      if (s.player.invincibleFrames > 0) continue;
      const dx = b.x - s.player.x;
      const dy = b.y - s.player.y;
      if (Math.sqrt(dx * dx + dy * dy) < PLAYER_SIZE * 0.6) {
        s.bullets.splice(bi, 1);
        this.hitPlayer();
      }
    }

    // Enemies vs player (body collision)
    for (const e of s.enemies) {
      if (!e.alive) continue;
      if (s.player.invincibleFrames > 0) continue;
      const dx = e.x - s.player.x;
      const dy = e.y - s.player.y;
      if (Math.sqrt(dx * dx + dy * dy) < PLAYER_SIZE + 14) {
        this.hitPlayer();
        if (!e.invulnerable) {
          e.hp = 0;
          e.alive = false;
          this.spawnExplosion(e.x, e.y, TIER_COLORS[e.tier]);
        }
      }
    }

    // Player collects powerups
    for (let i = s.powerups.length - 1; i >= 0; i--) {
      const pu = s.powerups[i];
      const dx = pu.x - s.player.x;
      const dy = pu.y - s.player.y;
      if (Math.sqrt(dx * dx + dy * dy) < PLAYER_SIZE + 16) {
        s.powerups.splice(i, 1);
        this.applyPowerup(pu.kind);
      }
    }

    // Enemies vs planet
    if (s.moon?.alive) {
      for (const e of s.enemies) {
        if (!e.alive) continue;
        const dx = e.x - s.moon.x;
        const dy = e.y - s.moon.y;
        if (Math.sqrt(dx * dx + dy * dy) < MOON_RADIUS + 16) {
          s.moon.alive = false;
          s.score = Math.max(0, s.score - s.moon.penalty);  // use per-planet penalty
          this.spawnExplosion(s.moon.x, s.moon.y, '#ffd700');
          this.spawnExplosion(s.moon.x, s.moon.y, '#ffd700');
          this.events.push({ tick: s.tick, type: 'miss', wave: s.wave });
          this.cbs.onScore(s.score);
          e.alive = false;
          break;
        }
        // Flash planet when enemies are nearby
        if (Math.sqrt(dx * dx + dy * dy) < MOON_RADIUS + 60) {
          s.moon.flashFrames = 6;
        }
      }
    }

    // Enemy fires back at player (probability-based)
    for (const e of s.enemies) {
      if (!e.alive || !e.cfg.firesBack) continue;
      if (Math.random() < 0.003) {
        const dx = s.player.x - e.x;
        const dy = s.player.y - e.y;
        const len = Math.sqrt(dx * dx + dy * dy) || 1;
        const speed = 4;
        s.bullets.push({
          id:         s.nextBulletId++,
          x:          e.x,
          y:          e.y,
          vx:         (dx / len) * speed,
          vy:         (dy / len) * speed,
          fromPlayer: false,
        });
      }
    }
  }

  private tryDropPowerup(x: number, y: number): void {
    const s = this.state;
    const roll = Math.random();
    const { weapon, shield } = POWERUP_CONFIGS;
    let kind: PowerupEntity['kind'] | null = null;

    if (roll < weapon.dropChance)                       kind = 'weapon';
    else if (roll < weapon.dropChance + shield.dropChance) kind = 'shield';

    if (kind) {
      s.powerups.push({ id: s.nextPowerupId++, x, y, kind, alive: true });
    }
  }

  private applyPowerup(kind: PowerupEntity['kind']): void {
    const s = this.state;
    const cfg = POWERUP_CONFIGS[kind];
    if (kind === 'weapon') {
      s.weaponFrames = cfg.duration;
    } else {
      s.shieldActive = true;
    }
    this.cbs.onPowerup(kind, s.weaponFrames, s.shieldActive);
  }

  private hitPlayer(): void {
    const s = this.state;
    // Shield absorbs the first hit
    if (s.shieldActive) {
      s.shieldActive = false;
      s.player.invincibleFrames = PLAYER_INVINCIBLE;
      this.spawnExplosion(s.player.x, s.player.y, '#00d4ff'); // blue flash
      this.cbs.onPowerup(null, s.weaponFrames, false);
      return;
    }
    s.player.lives--;
    s.player.invincibleFrames = PLAYER_INVINCIBLE;
    this.spawnExplosion(s.player.x, s.player.y, '#f7931a');
    this.events.push({ tick: s.tick, type: 'player_death', wave: s.wave });
    this.cbs.onLives(s.player.lives);
    if (s.player.lives <= 0) {
      s.phase = 'game_over';
      this.cbs.onGameOver(s.score, s.burned);
    }
  }

  // ── Wave clear check ──────────────────────────────────────────────────────────

  private checkWaveClear(): void {
    const s = this.state;
    if (s.phase !== 'playing') return;

    const allSpawned   = s.nextSpawns.length === 0;
    const noEnemies    = s.enemies.filter(e => e.alive).length === 0;
    const moonResolved = s.moon === null || !s.moon.alive || s.moon.x > CANVAS_W;
    const bossResolved = !s.boss || !s.boss.alive;

    if (allSpawned && noEnemies && moonResolved && bossResolved) {
      this.events.push({ tick: s.tick, type: 'wave_clear', wave: s.wave });
      s.phase     = 'wave_clear';
      s.spawnTick = s.tick;
    }
  }

  // ── Particles ─────────────────────────────────────────────────────────────────

  private spawnExplosion(x: number, y: number, color: string): void {
    const p = this.state.particles;
    for (let i = 0; i < 8; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 1.5 + Math.random() * 3;
      p.push({ x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
                life: 1, color, size: 2 + Math.random() * 3 });
    }
  }

  private updateParticles(): void {
    const p = this.state.particles;
    for (let i = p.length - 1; i >= 0; i--) {
      const pt: ParticleEntity = p[i];
      pt.x += pt.vx; pt.y += pt.vy; pt.vy += 0.04;
      pt.life -= 0.03;
      if (pt.life <= 0) p.splice(i, 1);
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────────

  private render(): void {
    const ctx = this.ctx;
    const s   = this.state;
    const W = CANVAS_W, H = CANVAS_H;

    ctx.clearRect(0, 0, W, H);

    // Subtle grid
    ctx.strokeStyle = 'rgba(74,158,255,0.04)';
    ctx.lineWidth = 1;
    for (let x = 0; x < W; x += 48) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
    for (let y = 0; y < H; y += 48) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }

    // Planet / Moon
    if (s.moon?.alive) {
      const m = s.moon;
      const alpha = m.flashFrames > 0 ? 0.5 + 0.5 * Math.sin(m.flashFrames * 1.2) : 1;
      ctx.globalAlpha = alpha;
      ctx.font = '38px serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(m.glyph, m.x, m.y);   // ← dynamic glyph
      ctx.globalAlpha = 1;
      if (m.flashFrames > 0) {
        ctx.beginPath();
        ctx.arc(m.x, m.y, MOON_RADIUS + 8, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(255,215,0,0.4)';
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    }

    // Regular enemies
    ctx.font = '22px serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const e of s.enemies) {
      if (!e.alive) continue;
      const alpha = e.flashFrames > 0 ? 0.4 + 0.6 * Math.sin(e.flashFrames * 1.5) : 1;
      ctx.globalAlpha = alpha;
      ctx.fillText(e.cfg.glyph, e.x, e.y);

      if (e.invulnerable) {
        ctx.beginPath();
        ctx.arc(e.x, e.y, 18, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(0,212,255,${0.4 + 0.3 * Math.sin(s.tick * 0.1)})`;
        ctx.lineWidth = 2;
        ctx.stroke();
      }
      ctx.globalAlpha = 1;

      if (e.maxHp > 1) {
        const barW = 28, barH = 3;
        const hpFrac = e.hp / e.maxHp;
        ctx.fillStyle = 'rgba(0,0,0,0.5)';
        ctx.fillRect(e.x - barW / 2, e.y + 14, barW, barH);
        ctx.fillStyle = hpFrac > 0.5 ? '#2ecc71' : hpFrac > 0.25 ? '#f7931a' : '#e74c3c';
        ctx.fillRect(e.x - barW / 2, e.y + 14, barW * hpFrac, barH);
      }
    }

    // Boss
    if (s.boss?.alive) {
      const boss = s.boss;
      const alpha = boss.flashFrames > 0 ? 0.3 + 0.7 * Math.sin(boss.flashFrames * 1.5) : 1;
      ctx.globalAlpha = alpha;
      ctx.font = `${boss.cfg.fontSize}px serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(boss.cfg.glyph, boss.x, boss.y);
      ctx.globalAlpha = 1;

      // Boss HP bar — full-width, top of canvas
      const barY = 6, barH = 14;
      const hpFrac = boss.hp / boss.maxHp;
      ctx.fillStyle = 'rgba(0,0,0,0.80)';
      ctx.fillRect(0, barY, W, barH);
      const barColor = hpFrac > 0.5 ? '#f7931a' : hpFrac > 0.25 ? '#e67e22' : '#e74c3c';
      ctx.fillStyle = barColor;
      ctx.fillRect(0, barY, W * hpFrac, barH);
      // Label: name · HP · retreat countdown
      const framesLeft  = Math.max(0, boss.cfg.duration - (s.tick - s.spawnTick));
      const secsLeft    = Math.ceil(framesLeft / 60);
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.font = '6px "Press Start 2P", monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(
        `⚡ ${boss.cfg.name}   HP ${boss.hp} / ${boss.maxHp}   |   RETREATS IN ${secsLeft}s`,
        W / 2, barY + barH / 2 + 0.5,
      );

      // "⚠ BOSS WAVE" warning — first 120 frames
      const bossAge = s.tick - s.spawnTick;
      if (bossAge < 120) {
        const pulse = 0.5 + 0.5 * Math.sin(s.tick * 0.18);
        ctx.globalAlpha = pulse;
        ctx.font = 'bold 20px "Press Start 2P", monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = '#e74c3c';
        ctx.shadowColor = '#e74c3c';
        ctx.shadowBlur = 22;
        ctx.fillText('⚠  BOSS WAVE  ⚠', W / 2, H / 2);
        ctx.shadowBlur = 0;
        ctx.globalAlpha = 1;
      }
    }

    // Player bullets
    for (const b of s.bullets) {
      if (!b.fromPlayer) continue;
      const grad = ctx.createLinearGradient(b.x, b.y, b.x - b.vx * 3, b.y - b.vy * 3);
      grad.addColorStop(0, '#f7931a');
      grad.addColorStop(1, 'transparent');
      ctx.strokeStyle = grad;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(b.x, b.y);
      ctx.lineTo(b.x - b.vx * 3, b.y - b.vy * 3);
      ctx.stroke();
    }

    // Enemy / boss bullets
    for (const b of s.bullets) {
      if (b.fromPlayer) continue;
      const grad = ctx.createLinearGradient(b.x, b.y, b.x - b.vx * 3, b.y - b.vy * 3);
      grad.addColorStop(0, '#e74c3c');
      grad.addColorStop(1, 'transparent');
      ctx.strokeStyle = grad;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(b.x, b.y);
      ctx.lineTo(b.x - b.vx * 3, b.y - b.vy * 3);
      ctx.stroke();
    }

    // Particles
    for (const p of s.particles) {
      ctx.globalAlpha = p.life;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * p.life, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // Floating powerup pickups
    if (s.powerups.length > 0) {
      ctx.textAlign    = 'center';
      ctx.textBaseline = 'middle';
      for (const pu of s.powerups) {
        const pulse = 0.7 + 0.3 * Math.sin(s.tick * 0.12);
        ctx.globalAlpha = pulse;
        ctx.font = '24px serif';
        ctx.fillText(POWERUP_CONFIGS[pu.kind].glyph, pu.x, pu.y);
        // Glow ring
        ctx.beginPath();
        ctx.arc(pu.x, pu.y, 16, 0, Math.PI * 2);
        ctx.strokeStyle = pu.kind === 'weapon' ? 'rgba(247,147,26,0.5)' : 'rgba(0,212,255,0.5)';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }

    // Shield ring around player when active
    if (s.shieldActive) {
      const pulse = 0.5 + 0.5 * Math.sin(s.tick * 0.2);
      ctx.beginPath();
      ctx.arc(s.player.x, s.player.y, PLAYER_SIZE + 10, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(0,212,255,${pulse})`;
      ctx.lineWidth = 3;
      ctx.stroke();
    }

    // Player ship
    const p = s.player;
    const blink = p.invincibleFrames > 0 && Math.floor(p.invincibleFrames / 6) % 2 === 0;
    if (!blink) {
      ctx.font = '28px serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('🚀', p.x, p.y);
      const thrust = ctx.createRadialGradient(p.x, p.y + 16, 0, p.x, p.y + 16, 14);
      thrust.addColorStop(0, 'rgba(247,147,26,0.5)');
      thrust.addColorStop(1, 'transparent');
      ctx.fillStyle = thrust;
      ctx.beginPath();
      ctx.ellipse(p.x, p.y + 16, 7, 11, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    // Wave clear overlay
    if (s.phase === 'wave_clear') {
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.fillRect(0, 0, W, H);
      ctx.font = 'bold 20px "Press Start 2P", monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#2ecc71';
      ctx.shadowColor = '#2ecc71';
      ctx.shadowBlur = 20;
      ctx.fillText('WAVE CLEAR!', W / 2, H / 2);
      ctx.shadowBlur = 0;
    }

    // Game over overlay
    if (s.phase === 'game_over') {
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(0, 0, W, H);
      ctx.font = 'bold 24px "Press Start 2P", monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#e74c3c';
      ctx.shadowColor = '#e74c3c';
      ctx.shadowBlur = 24;
      ctx.fillText('GAME OVER', W / 2, H / 2 - 20);
      ctx.font = '12px "Press Start 2P", monospace';
      ctx.fillStyle = '#e8e8e8';
      ctx.shadowBlur = 0;
      ctx.fillText('SCORE: ' + s.score.toLocaleString(), W / 2, H / 2 + 20);
    }
  }
}
