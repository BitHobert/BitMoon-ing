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
        trail:       [],
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
        glyph:       planet?.glyph    ?? '🌕',
        penalty:     planet?.penalty  ?? 10_000,
        spriteId:    planet?.spriteId,
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

    // Standard lateral patrol + gentle sine Y oscillation for all bosses
    boss.x += boss.vx;
    if (boss.x >= CANVAS_W - 100) { boss.x = CANVAS_W - 100; boss.vx = -boss.cfg.speed; }
    if (boss.x <= 100)            { boss.x = 100;             boss.vx =  boss.cfg.speed; }

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
      if (m.spriteId === 'purple') {
        this.drawPurplePlanet(ctx, m.x, m.y);
      } else if (m.spriteId === 'inferno') {
        this.drawInfernoPlanet(ctx, m.x, m.y);
      } else if (m.spriteId === 'saturn') {
        this.drawSaturnPlanet(ctx, m.x, m.y);
      } else {
        ctx.font = '38px serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(m.glyph, m.x, m.y);
      }
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
      if (e.cfg.tier === 3) {
        this.drawAlienSprite(ctx, e.x, e.y, 28);
      } else if (e.cfg.tier === 4) {
        this.drawBugSprite(ctx, e.x, e.y, 28);
      } else if (e.cfg.tier === 5) {
        this.drawJellyfishSprite(ctx, e.x, e.y, 30);
      } else {
        ctx.fillText(e.cfg.glyph, e.x, e.y);
      }

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
        const barY = e.y + (e.cfg.tier === 3 || e.cfg.tier === 4 ? 24 : e.cfg.tier === 5 ? 28 : 14);
        ctx.fillStyle = 'rgba(0,0,0,0.5)';
        ctx.fillRect(e.x - barW / 2, barY, barW, barH);
        ctx.fillStyle = hpFrac > 0.5 ? '#2ecc71' : hpFrac > 0.25 ? '#f7931a' : '#e74c3c';
        ctx.fillRect(e.x - barW / 2, barY, barW * hpFrac, barH);
      }
    }

    // Boss
    if (s.boss?.alive) {
      const boss = s.boss;
      const alpha = boss.flashFrames > 0 ? 0.3 + 0.7 * Math.sin(boss.flashFrames * 1.5) : 1;
      ctx.globalAlpha = alpha;
      if (boss.poolIndex === 1) {
        this.drawUFOBoss(ctx, boss.x, boss.y);
      } else if (boss.poolIndex === 2) {
        this.drawRobotSkullBoss(ctx, boss.x, boss.y);
      } else if (boss.poolIndex === 3) {
        this.drawWatcherBoss(ctx, boss.x, boss.y);
      } else {
        ctx.font = `${boss.cfg.fontSize}px serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(boss.cfg.glyph, boss.x, boss.y);
      }
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

  // ── Tier 3 alien sprite (drawn procedurally — no image file needed) ──────────
  private drawAlienSprite(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number): void {
    const s = size / 32;
    ctx.save();
    ctx.translate(cx, cy);

    // Horns (drawn first, behind body)
    ctx.fillStyle = '#8c1bac';
    ctx.beginPath();
    ctx.moveTo(-6 * s, -10 * s);
    ctx.lineTo(-11 * s, -22 * s);
    ctx.lineTo(-2 * s, -13 * s);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(6 * s, -10 * s);
    ctx.lineTo(11 * s, -22 * s);
    ctx.lineTo(2 * s, -13 * s);
    ctx.closePath();
    ctx.fill();

    // Body (radial gradient, pink-purple)
    const bodyGrad = ctx.createRadialGradient(-2 * s, -4 * s, 1, 0, 1 * s, 12 * s);
    bodyGrad.addColorStop(0, '#ee66ff');
    bodyGrad.addColorStop(1, '#881db0');
    ctx.fillStyle = bodyGrad;
    ctx.beginPath();
    ctx.ellipse(0, 0, 11 * s, 13 * s, 0, 0, Math.PI * 2);
    ctx.fill();

    // Eyes — green with glow
    ctx.save();
    ctx.shadowColor = '#00ff55';
    ctx.shadowBlur = 8;
    ctx.fillStyle = '#22ff66';
    ctx.beginPath();
    ctx.ellipse(-4 * s, -3 * s, 3.5 * s, 3.5 * s, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(4 * s, -3 * s, 3.5 * s, 3.5 * s, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Pupils
    ctx.fillStyle = '#003311';
    ctx.beginPath();
    ctx.ellipse(-4 * s, -3 * s, 1.8 * s, 1.8 * s, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(4 * s, -3 * s, 1.8 * s, 1.8 * s, 0, 0, Math.PI * 2);
    ctx.fill();

    // Open mouth
    ctx.fillStyle = '#220033';
    ctx.beginPath();
    ctx.arc(0, 6 * s, 5 * s, 0, Math.PI);
    ctx.fill();

    // Fangs
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(-3.5 * s, 6 * s);
    ctx.lineTo(-2.5 * s, 11 * s);
    ctx.lineTo(-1 * s, 6 * s);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(1 * s, 6 * s);
    ctx.lineTo(2.5 * s, 11 * s);
    ctx.lineTo(3.5 * s, 6 * s);
    ctx.closePath();
    ctx.fill();

    // Legs / claws
    ctx.fillStyle = '#7a1a9e';
    ctx.beginPath();
    ctx.moveTo(-5 * s, 12 * s);
    ctx.lineTo(-9 * s, 18 * s);
    ctx.lineTo(-6.5 * s, 17 * s);
    ctx.lineTo(-8 * s, 22 * s);
    ctx.lineTo(-3 * s, 14 * s);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(5 * s, 12 * s);
    ctx.lineTo(9 * s, 18 * s);
    ctx.lineTo(6.5 * s, 17 * s);
    ctx.lineTo(8 * s, 22 * s);
    ctx.lineTo(3 * s, 14 * s);
    ctx.closePath();
    ctx.fill();

    ctx.restore();
  }

  // ── Tier 4 bug sprite — green glowing body, blue eyes, orange spikes & legs ──
  private drawBugSprite(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number): void {
    const s = size / 32;
    ctx.save();
    ctx.translate(cx, cy);

    // Orange spiky antennae radiating outward (drawn behind body)
    const spikeAngles = [-80, -55, -30, 30, 55, 80, -110, 110];
    for (const deg of spikeAngles) {
      const rad = (deg * Math.PI) / 180;
      const x1 = Math.cos(rad) * 9 * s,  y1 = Math.sin(rad) * 9 * s;
      const x2 = Math.cos(rad) * 19 * s, y2 = Math.sin(rad) * 19 * s;
      ctx.strokeStyle = '#ff8c00';
      ctx.lineWidth = 2 * s;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
      // Tip dot
      ctx.fillStyle = '#ffcc00';
      ctx.beginPath();
      ctx.arc(x2, y2, 2.5 * s, 0, Math.PI * 2);
      ctx.fill();
    }

    // Body — glowing green circle
    ctx.save();
    ctx.shadowColor = '#00ff88';
    ctx.shadowBlur = 14;
    const bodyGrad = ctx.createRadialGradient(-2 * s, -2 * s, 1, 0, 0, 11 * s);
    bodyGrad.addColorStop(0, '#ccffdd');
    bodyGrad.addColorStop(0.45, '#22dd66');
    bodyGrad.addColorStop(1, '#0a4422');
    ctx.fillStyle = bodyGrad;
    ctx.beginPath();
    ctx.arc(0, 0, 11 * s, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Eyes — blue squares
    ctx.fillStyle = '#3399ff';
    ctx.fillRect(-7 * s, -5 * s, 5 * s, 5 * s);
    ctx.fillRect(2 * s,  -5 * s, 5 * s, 5 * s);
    // Pupils
    ctx.fillStyle = '#001166';
    ctx.fillRect(-6 * s, -4 * s, 3 * s, 3 * s);
    ctx.fillRect(3 * s,  -4 * s, 3 * s, 3 * s);

    // Mouth — orange arc smile
    ctx.strokeStyle = '#ff8c00';
    ctx.lineWidth = 1.8 * s;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(0, 4 * s, 4 * s, 0.25, Math.PI - 0.25);
    ctx.stroke();

    // Spider legs (4 jointed legs at bottom)
    ctx.strokeStyle = '#ff8c00';
    ctx.lineWidth = 1.8 * s;
    ctx.lineCap = 'round';
    // Front-left
    ctx.beginPath(); ctx.moveTo(-5 * s, 8 * s); ctx.lineTo(-11 * s, 15 * s); ctx.lineTo(-9 * s, 22 * s); ctx.stroke();
    // Front-right
    ctx.beginPath(); ctx.moveTo(5 * s,  8 * s); ctx.lineTo(11 * s,  15 * s); ctx.lineTo(9 * s,  22 * s); ctx.stroke();
    // Back-left
    ctx.beginPath(); ctx.moveTo(-8 * s, 5 * s); ctx.lineTo(-16 * s, 10 * s); ctx.lineTo(-14 * s, 17 * s); ctx.stroke();
    // Back-right
    ctx.beginPath(); ctx.moveTo(8 * s,  5 * s); ctx.lineTo(16 * s,  10 * s); ctx.lineTo(14 * s,  17 * s); ctx.stroke();

    ctx.restore();
  }

  // ── Tier 5 jellyfish sprite — cyan glow, angry red eyes, toothed grin, tentacles ─
  private drawJellyfishSprite(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number): void {
    const s = size / 32;
    ctx.save();
    ctx.translate(cx, cy);

    // Outer drooping side appendages (behind body)
    ctx.save();
    ctx.shadowColor = '#44eeff';
    ctx.shadowBlur = 8;
    ctx.strokeStyle = '#66ddee';
    ctx.lineWidth = 3.5 * s;
    ctx.lineCap = 'round';
    // Left droop
    ctx.beginPath();
    ctx.moveTo(-9 * s, 6 * s);
    ctx.bezierCurveTo(-14 * s, 12 * s, -16 * s, 18 * s, -12 * s, 26 * s);
    ctx.stroke();
    // Right droop
    ctx.beginPath();
    ctx.moveTo(9 * s, 6 * s);
    ctx.bezierCurveTo(14 * s, 12 * s, 16 * s, 18 * s, 12 * s, 26 * s);
    ctx.stroke();
    ctx.restore();

    // Inner tentacles (3 thin curling ones)
    ctx.save();
    ctx.shadowColor = '#88ffff';
    ctx.shadowBlur = 5;
    ctx.strokeStyle = '#aaeeff';
    ctx.lineWidth = 1.5 * s;
    ctx.lineCap = 'round';
    const tentacleDefs = [
      { x: -4 * s, curl:  3 * s },
      { x:  0,     curl: -3 * s },
      { x:  4 * s, curl:  3 * s },
    ];
    for (const t of tentacleDefs) {
      ctx.beginPath();
      ctx.moveTo(t.x, 9 * s);
      ctx.bezierCurveTo(t.x + t.curl, 15 * s, t.x - t.curl, 20 * s, t.x + t.curl * 0.5, 28 * s);
      ctx.stroke();
    }
    ctx.restore();

    // Body dome — cyan glow
    ctx.save();
    ctx.shadowColor = '#44ddff';
    ctx.shadowBlur = 18;
    const bodyGrad = ctx.createRadialGradient(-2 * s, -5 * s, 1, 0, -3 * s, 14 * s);
    bodyGrad.addColorStop(0, '#eefffe');
    bodyGrad.addColorStop(0.4, '#77ddee');
    bodyGrad.addColorStop(1, '#1a6677');
    ctx.fillStyle = bodyGrad;
    ctx.beginPath();
    ctx.arc(0, -2 * s, 13 * s, Math.PI, 0);        // top dome arc
    ctx.lineTo(13 * s, 7 * s);
    ctx.quadraticCurveTo(0, 12 * s, -13 * s, 7 * s); // flat-ish bell bottom
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // Eyes — dark angular slanted shape with red glow
    ctx.fillStyle = '#0d1a22';
    // Left eye triangle (slants inward ↘)
    ctx.beginPath();
    ctx.moveTo(-11 * s, -5 * s);
    ctx.lineTo(-4 * s,  -2 * s);
    ctx.lineTo(-4 * s,  -7 * s);
    ctx.closePath();
    ctx.fill();
    // Right eye triangle (slants inward ↙)
    ctx.beginPath();
    ctx.moveTo(11 * s, -5 * s);
    ctx.lineTo(4 * s,  -2 * s);
    ctx.lineTo(4 * s,  -7 * s);
    ctx.closePath();
    ctx.fill();
    // Red glow pupils
    ctx.save();
    ctx.shadowColor = '#ff3333';
    ctx.shadowBlur = 8;
    ctx.fillStyle = '#ff5566';
    ctx.beginPath();
    ctx.ellipse(-7 * s, -5 * s, 2.2 * s, 2.2 * s, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(7 * s, -5 * s, 2.2 * s, 2.2 * s, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Mouth — wide grin (dark interior)
    ctx.fillStyle = '#881133';
    ctx.beginPath();
    ctx.arc(0, 4 * s, 6 * s, 0.15, Math.PI - 0.15);
    ctx.fill();
    // Teeth (5 white rectangles)
    ctx.fillStyle = '#ffffff';
    for (let i = -2; i <= 2; i++) {
      ctx.fillRect(i * 2.4 * s - 1.0 * s, 4 * s, 2.0 * s, 2.8 * s);
    }

    ctx.restore();
  }

  // ── Boss #2 — ABDUCTOR (UFO) ─────────────────────────────────────────────────
  // Dark dome, red glowing eyes, cyan saucer disc, yellow port lights, red tentacles
  private drawUFOBoss(ctx: CanvasRenderingContext2D, cx: number, cy: number): void {
    const s = 2.2; // boss-scale multiplier
    ctx.save();
    ctx.translate(cx, cy);

    // Red tentacles — 4 jointed legs below saucer (drawn first, behind body)
    ctx.strokeStyle = '#dd3311';
    ctx.lineWidth = 5;
    ctx.lineCap = 'square';
    // Outer-left
    ctx.beginPath(); ctx.moveTo(-18 * s, 10 * s); ctx.lineTo(-18 * s, 19 * s); ctx.lineTo(-12 * s, 24 * s); ctx.stroke();
    // Inner-left
    ctx.beginPath(); ctx.moveTo(-7 * s,  10 * s); ctx.lineTo(-7 * s,  21 * s); ctx.lineTo(-11 * s, 26 * s); ctx.stroke();
    // Inner-right
    ctx.beginPath(); ctx.moveTo(7 * s,   10 * s); ctx.lineTo(7 * s,   21 * s); ctx.lineTo(11 * s,  26 * s); ctx.stroke();
    // Outer-right
    ctx.beginPath(); ctx.moveTo(18 * s,  10 * s); ctx.lineTo(18 * s,  19 * s); ctx.lineTo(12 * s,  24 * s); ctx.stroke();

    // Saucer disc — cyan-to-purple gradient, wide ellipse
    ctx.save();
    ctx.shadowColor = '#00ccff';
    ctx.shadowBlur = 22;
    const discGrad = ctx.createLinearGradient(0, -3 * s, 0, 13 * s);
    discGrad.addColorStop(0,    '#22eeff');
    discGrad.addColorStop(0.35, '#1155aa');
    discGrad.addColorStop(0.70, '#550088');
    discGrad.addColorStop(1,    '#cc2200');
    ctx.fillStyle = discGrad;
    ctx.beginPath();
    ctx.ellipse(0, 5 * s, 27 * s, 8.5 * s, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Yellow port lights along saucer mid-band
    ctx.fillStyle = '#ffcc00';
    for (const px of [-17, -9, 0, 9, 17]) {
      ctx.fillRect(px * s - 2.5, 4 * s, 5, 5);
    }

    // Dome — dark interior, cyan outline
    ctx.save();
    ctx.shadowColor = '#00ddff';
    ctx.shadowBlur = 12;
    const domeGrad = ctx.createRadialGradient(-3 * s, -8 * s, 1, 0, -5 * s, 12 * s);
    domeGrad.addColorStop(0, '#1e2f55');
    domeGrad.addColorStop(1, '#040912');
    ctx.fillStyle = domeGrad;
    ctx.beginPath();
    ctx.ellipse(0, -3 * s, 13 * s, 10 * s, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#00eeff';
    ctx.lineWidth = 2.5;
    ctx.stroke();
    ctx.restore();

    // Red glowing eyes inside dome
    ctx.save();
    ctx.shadowColor = '#ff0000';
    ctx.shadowBlur = 20;
    ctx.fillStyle = '#ff1111';
    ctx.beginPath();
    ctx.ellipse(-6 * s, -4 * s, 4.5 * s, 3 * s, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(6 * s, -4 * s, 4.5 * s, 3 * s, 0, 0, Math.PI * 2);
    ctx.fill();
    // Bright pupils
    ctx.fillStyle = '#ff8888';
    ctx.beginPath();
    ctx.ellipse(-6 * s, -4 * s, 2 * s, 1.5 * s, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(6 * s, -4 * s, 2 * s, 1.5 * s, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.restore();
  }

  // ── Boss #3 — OVERLORD (Robot Skull King) ────────────────────────────────────
  // Metallic skull, gold crown w/ red gem, glowing red eyes, ear speakers,
  // left antenna w/ red ball, teeth+jaw, red chin plate, rocket nozzle + flame
  private drawRobotSkullBoss(ctx: CanvasRenderingContext2D, cx: number, cy: number): void {
    const s = 2.0; // scale multiplier
    ctx.save();
    ctx.translate(cx, cy);

    // ── Rocket flame (drawn first — behind skull) ─────────────────────────────
    // Outer yellow flame
    ctx.save();
    ctx.shadowColor = '#ffaa00';
    ctx.shadowBlur  = 20;
    ctx.fillStyle   = '#ffcc00';
    ctx.beginPath();
    ctx.moveTo(-6 * s,  18 * s);
    ctx.lineTo( 6 * s,  18 * s);
    ctx.lineTo( 5 * s,  30 * s);
    ctx.lineTo( 0,      35 * s);
    ctx.lineTo(-5 * s,  30 * s);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    // Inner orange core
    ctx.save();
    ctx.fillStyle = '#ff5500';
    ctx.beginPath();
    ctx.moveTo(-3 * s,  18 * s);
    ctx.lineTo( 3 * s,  18 * s);
    ctx.lineTo( 1.5 * s, 27 * s);
    ctx.lineTo( 0,       30 * s);
    ctx.lineTo(-1.5 * s, 27 * s);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // ── Rocket nozzle ─────────────────────────────────────────────────────────
    ctx.fillStyle   = '#445566';
    ctx.strokeStyle = '#778899';
    ctx.lineWidth   = 1.5;
    ctx.beginPath();
    ctx.moveTo(-7 * s,  13 * s);
    ctx.lineTo( 7 * s,  13 * s);
    ctx.lineTo( 5.5 * s, 19 * s);
    ctx.lineTo(-5.5 * s, 19 * s);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    // Nozzle band detail
    ctx.strokeStyle = '#aabbcc';
    ctx.lineWidth   = 1;
    ctx.beginPath();
    ctx.moveTo(-6.5 * s, 15.5 * s);
    ctx.lineTo( 6.5 * s, 15.5 * s);
    ctx.stroke();

    // ── Main skull head ────────────────────────────────────────────────────────
    const skullGrad = ctx.createLinearGradient(-12 * s, -14 * s, 8 * s, 14 * s);
    skullGrad.addColorStop(0,   '#d0d0e8');
    skullGrad.addColorStop(0.4, '#8888aa');
    skullGrad.addColorStop(1,   '#3a4a5a');
    ctx.save();
    ctx.shadowColor = '#8888bb';
    ctx.shadowBlur  = 14;
    ctx.fillStyle   = skullGrad;
    ctx.beginPath();
    ctx.moveTo(-12 * s, -14 * s);  // top-left
    ctx.lineTo( 12 * s, -14 * s);  // top-right
    ctx.lineTo( 14 * s,  -2 * s);  // right bulge
    ctx.lineTo( 12 * s,  13 * s);  // jaw-right
    ctx.lineTo(-12 * s,  13 * s);  // jaw-left
    ctx.lineTo(-14 * s,  -2 * s);  // left bulge
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    // Skull outline
    ctx.strokeStyle = '#223344';
    ctx.lineWidth   = 1.5;
    ctx.beginPath();
    ctx.moveTo(-12 * s, -14 * s);
    ctx.lineTo( 12 * s, -14 * s);
    ctx.lineTo( 14 * s,  -2 * s);
    ctx.lineTo( 12 * s,  13 * s);
    ctx.lineTo(-12 * s,  13 * s);
    ctx.lineTo(-14 * s,  -2 * s);
    ctx.closePath();
    ctx.stroke();

    // ── Crown base band ────────────────────────────────────────────────────────
    ctx.save();
    ctx.shadowColor = '#ffcc00';
    ctx.shadowBlur  = 10;
    ctx.fillStyle   = '#ffd700';
    ctx.fillRect(-12 * s, -20 * s, 24 * s, 7 * s);
    ctx.restore();
    // Crown band outline
    ctx.strokeStyle = '#aa8800';
    ctx.lineWidth   = 1;
    ctx.strokeRect(-12 * s, -20 * s, 24 * s, 7 * s);

    // ── 5 crown spikes ─────────────────────────────────────────────────────────
    const spikesX = [-10, -5, 0, 5, 10];
    const spikesH = [  8,  6, 11, 6,  8];
    ctx.save();
    ctx.shadowColor = '#ffdd00';
    ctx.shadowBlur  = 8;
    ctx.fillStyle   = '#ffd700';
    for (let i = 0; i < 5; i++) {
      const px = spikesX[i] * s;
      ctx.beginPath();
      ctx.moveTo(px - 3 * s, -20 * s);
      ctx.lineTo(px,          (-20 - spikesH[i]) * s);
      ctx.lineTo(px + 3 * s, -20 * s);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
    // Spike outlines
    ctx.strokeStyle = '#aa8800';
    ctx.lineWidth   = 1;
    for (let i = 0; i < 5; i++) {
      const px = spikesX[i] * s;
      ctx.beginPath();
      ctx.moveTo(px - 3 * s, -20 * s);
      ctx.lineTo(px,          (-20 - spikesH[i]) * s);
      ctx.lineTo(px + 3 * s, -20 * s);
      ctx.stroke();
    }

    // ── Crown gem (red, on tallest center spike) ───────────────────────────────
    ctx.save();
    ctx.shadowColor = '#ff0000';
    ctx.shadowBlur  = 18;
    ctx.fillStyle   = '#dd0000';
    ctx.beginPath();
    ctx.arc(0, (-20 - 11) * s, 3.5 * s, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    // Gem highlight
    ctx.fillStyle = '#ff9999';
    ctx.beginPath();
    ctx.arc(-1 * s, (-20 - 12.5) * s, 1.2 * s, 0, Math.PI * 2);
    ctx.fill();

    // ── Eye sockets (dark recesses) ────────────────────────────────────────────
    ctx.fillStyle = '#0d0d22';
    ctx.beginPath();
    ctx.ellipse(-6 * s, -5 * s, 5.5 * s, 5 * s, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse( 6 * s, -5 * s, 5.5 * s, 5 * s, 0, 0, Math.PI * 2);
    ctx.fill();

    // ── Glowing red eyes ───────────────────────────────────────────────────────
    ctx.save();
    ctx.shadowColor = '#ff0000';
    ctx.shadowBlur  = 24;
    ctx.fillStyle   = '#ff1a00';
    ctx.beginPath();
    ctx.ellipse(-6 * s, -5 * s, 3.8 * s, 3.2 * s, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse( 6 * s, -5 * s, 3.8 * s, 3.2 * s, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    // Eye highlights
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(-8 * s, -7 * s, 1.2 * s, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc( 4 * s, -7 * s, 1.2 * s, 0, Math.PI * 2);
    ctx.fill();

    // ── Ear speakers (left + right) ────────────────────────────────────────────
    for (const side of [-1, 1]) {
      const ex = side * 18 * s;
      const ey = -3 * s;
      const er = 5.5 * s;
      // Speaker body
      ctx.save();
      ctx.shadowColor = '#cc0000';
      ctx.shadowBlur  = 10;
      ctx.fillStyle   = '#aa0000';
      ctx.beginPath();
      ctx.arc(ex, ey, er, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      // Grille lines (horizontal, clipped to circle)
      ctx.strokeStyle = '#440000';
      ctx.lineWidth   = 1;
      for (let gy = -3; gy <= 3; gy += 2) {
        const hw = Math.sqrt(Math.max(0, er * er - (gy * s) * (gy * s)));
        ctx.beginPath();
        ctx.moveTo(ex - hw, ey + gy * s);
        ctx.lineTo(ex + hw, ey + gy * s);
        ctx.stroke();
      }
      // Speaker rim
      ctx.strokeStyle = '#ff4444';
      ctx.lineWidth   = 1.5;
      ctx.beginPath();
      ctx.arc(ex, ey, er, 0, Math.PI * 2);
      ctx.stroke();
    }

    // ── Antenna (top-left) ─────────────────────────────────────────────────────
    ctx.strokeStyle = '#aabbcc';
    ctx.lineWidth   = 2.5;
    ctx.lineCap     = 'round';
    ctx.beginPath();
    ctx.moveTo(-10 * s, -14 * s);
    ctx.lineTo(-17 * s, -30 * s);
    ctx.stroke();
    // Antenna ball
    ctx.save();
    ctx.shadowColor = '#ff2200';
    ctx.shadowBlur  = 16;
    ctx.fillStyle   = '#ff3300';
    ctx.beginPath();
    ctx.arc(-17 * s, -30 * s, 3.5 * s, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // ── Jaw panel (darker metal) ───────────────────────────────────────────────
    ctx.fillStyle = '#556677';
    ctx.beginPath();
    ctx.moveTo(-11 * s,  5 * s);
    ctx.lineTo( 11 * s,  5 * s);
    ctx.lineTo( 12 * s,  13 * s);
    ctx.lineTo(-12 * s,  13 * s);
    ctx.closePath();
    ctx.fill();

    // ── Teeth (6 white rectangles) ─────────────────────────────────────────────
    ctx.fillStyle = '#dde0ee';
    const tw = 3 * s;    // tooth width
    const th = 4.5 * s;  // tooth height
    const tx = -9 * s;   // leftmost tooth x
    const tg = 0.6 * s;  // gap between teeth
    for (let t = 0; t < 6; t++) {
      ctx.fillRect(tx + t * (tw + tg), 5 * s, tw, th);
    }

    // ── Red chin plate ─────────────────────────────────────────────────────────
    ctx.save();
    ctx.shadowColor = '#cc0000';
    ctx.shadowBlur  = 8;
    ctx.fillStyle   = '#bb1111';
    ctx.beginPath();
    ctx.moveTo(-11.5 * s, 9.5 * s);
    ctx.lineTo( 11.5 * s, 9.5 * s);
    ctx.lineTo( 12 * s,   13 * s);
    ctx.lineTo(-12 * s,   13 * s);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    ctx.restore();
  }

  // ── Boss #4 — WATCHER (Pixel-art invader eye beast) ──────────────────────────
  // Classic space-invader silhouette: cyan blocky body, top prongs, wing extensions,
  // bottom legs, large salmon eye with cross pupil, side pink spots, red wing tips
  private drawWatcherBoss(ctx: CanvasRenderingContext2D, cx: number, cy: number): void {
    const s = 2.0; // scale multiplier
    ctx.save();
    ctx.translate(cx, cy);

    // ── Cyan body — all blocks drawn with unified teal glow ───────────────────
    ctx.save();
    ctx.shadowColor = '#00ccee';
    ctx.shadowBlur  = 24;
    ctx.fillStyle   = '#33bbcc';

    // Top prongs (two narrow rects with gap, tilted slightly outward via extra x offset)
    ctx.fillRect(-5.5 * s, -21 * s, 3.5 * s, 9 * s);  // left prong
    ctx.fillRect( 2.0 * s, -21 * s, 3.5 * s, 9 * s);  // right prong

    // Upper shoulder connector
    ctx.fillRect(-8 * s, -12 * s, 16 * s, 5 * s);

    // Central body block
    ctx.fillRect(-8 * s,  -7 * s, 16 * s, 14 * s);

    // Wing extensions (horizontal arms)
    ctx.fillRect(-18 * s, -4.5 * s, 10 * s, 9 * s);  // left wing
    ctx.fillRect(  8 * s, -4.5 * s, 10 * s, 9 * s);  // right wing

    // Lower connector
    ctx.fillRect(-8 * s,   7 * s, 16 * s, 5 * s);

    // Bottom legs (two, mirroring the top prongs)
    ctx.fillRect(-6 * s,  12 * s, 4 * s, 9 * s);   // left leg
    ctx.fillRect( 2 * s,  12 * s, 4 * s, 9 * s);   // right leg

    ctx.restore();

    // ── Wing tips (hot pink / red accent) ────────────────────────────────────
    ctx.save();
    ctx.shadowColor = '#ff4422';
    ctx.shadowBlur  = 14;
    ctx.fillStyle   = '#ff5533';
    ctx.fillRect(-22.5 * s, -3.5 * s, 4.5 * s, 7 * s);  // left tip
    ctx.fillRect( 18.0 * s, -3.5 * s, 4.5 * s, 7 * s);  // right tip
    ctx.restore();

    // ── Central eye — outer salmon ring ───────────────────────────────────────
    ctx.save();
    ctx.shadowColor = '#ff8866';
    ctx.shadowBlur  = 20;
    ctx.fillStyle   = '#ff9977';
    ctx.beginPath();
    ctx.arc(0, 0, 7.5 * s, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Eye inner dark sclera
    ctx.fillStyle = '#0e0018';
    ctx.beginPath();
    ctx.arc(0, 0, 5.5 * s, 0, Math.PI * 2);
    ctx.fill();

    // Cross / + pupil
    ctx.fillStyle = '#1a0033';
    ctx.fillRect(-5 * s, -1.5 * s, 10 * s, 3 * s);  // horizontal bar
    ctx.fillRect(-1.5 * s, -5 * s,  3 * s, 10 * s); // vertical bar

    // Tiny eye highlight (upper-left gleam)
    ctx.fillStyle = 'rgba(255, 210, 190, 0.50)';
    ctx.beginPath();
    ctx.arc(-2.5 * s, -2.5 * s, 2 * s, 0, Math.PI * 2);
    ctx.fill();

    // ── Side spots (smaller salmon/pink dots) ─────────────────────────────────
    ctx.save();
    ctx.shadowColor = '#ff7755';
    ctx.shadowBlur  = 10;
    ctx.fillStyle   = '#ff9977';
    ctx.beginPath();
    ctx.arc(-11 * s, 0, 2.5 * s, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc( 11 * s, 0, 2.5 * s, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.restore();
  }

  // ── Planet sprite — NEBULA (purple planet with cyan continent patches) ────────
  private drawPurplePlanet(ctx: CanvasRenderingContext2D, cx: number, cy: number): void {
    const r = MOON_RADIUS; // 22px

    ctx.save();

    // ── Atmosphere outer glow ────────────────────────────────────────────────────
    ctx.save();
    ctx.shadowColor = '#cc44ff';
    ctx.shadowBlur  = 20;

    // ── Planet base — purple radial gradient ──────────────────────────────────────
    const grad = ctx.createRadialGradient(
      cx - r * 0.3, cy - r * 0.3, r * 0.05,   // inner highlight offset
      cx, cy, r,
    );
    grad.addColorStop(0,    '#d080ff');   // bright center highlight
    grad.addColorStop(0.45, '#8833bb');   // mid purple
    grad.addColorStop(1,    '#2a0855');   // dark edge
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // ── Cyan continent patches (clipped to planet circle) ─────────────────────────
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.clip();

    ctx.fillStyle = '#33ccaa';
    // Patch 1 — upper right
    ctx.beginPath();
    ctx.ellipse(cx + r * 0.28, cy - r * 0.28, r * 0.24, r * 0.18, 0.5, 0, Math.PI * 2);
    ctx.fill();
    // Patch 2 — lower left (larger)
    ctx.beginPath();
    ctx.ellipse(cx - r * 0.28, cy + r * 0.22, r * 0.30, r * 0.22, -0.4, 0, Math.PI * 2);
    ctx.fill();
    // Patch 3 — small upper left
    ctx.beginPath();
    ctx.ellipse(cx - r * 0.18, cy - r * 0.44, r * 0.13, r * 0.10, 0.2, 0, Math.PI * 2);
    ctx.fill();
    // Patch 4 — small lower right
    ctx.beginPath();
    ctx.ellipse(cx + r * 0.42, cy + r * 0.32, r * 0.12, r * 0.10, -0.6, 0, Math.PI * 2);
    ctx.fill();

    // Darker cyan shading on patches (depth)
    ctx.fillStyle = '#229988';
    ctx.beginPath();
    ctx.ellipse(cx + r * 0.30, cy - r * 0.24, r * 0.12, r * 0.09, 0.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(cx - r * 0.24, cy + r * 0.28, r * 0.16, r * 0.11, -0.4, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();

    // ── Atmosphere rim ────────────────────────────────────────────────────────────
    ctx.save();
    ctx.shadowColor = '#ee99ff';
    ctx.shadowBlur  = 8;
    ctx.strokeStyle = 'rgba(204, 102, 255, 0.45)';
    ctx.lineWidth   = 3;
    ctx.beginPath();
    ctx.arc(cx, cy, r + 1.5, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();

    // ── Surface highlight (top-left crescent gleam) ───────────────────────────────
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.clip();
    const hlGrad = ctx.createRadialGradient(cx - r * 0.4, cy - r * 0.4, 0, cx - r * 0.35, cy - r * 0.35, r * 0.55);
    hlGrad.addColorStop(0,   'rgba(255,220,255,0.30)');
    hlGrad.addColorStop(1,   'rgba(255,220,255,0)');
    ctx.fillStyle = hlGrad;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.restore();
  }

  // ── Planet sprite — INFERNO (gas giant: purple base, diagonal orange/amber bands) ──
  private drawInfernoPlanet(ctx: CanvasRenderingContext2D, cx: number, cy: number): void {
    const r = MOON_RADIUS; // 22px

    ctx.save();

    // ── Outer atmosphere glow (fiery orange) ──────────────────────────────────────
    ctx.save();
    ctx.shadowColor = '#ff5500';
    ctx.shadowBlur  = 18;

    // Planet base — deep purple
    ctx.fillStyle = '#2a0045';
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // ── Diagonal banded atmosphere (clipped to circle) ────────────────────────────
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.clip();

    // Rotate to create diagonal bands (≈ -28°)
    ctx.translate(cx, cy);
    ctx.rotate(-0.50);
    ctx.translate(-cx, -cy);

    // Band palette — alternating deep purple gaps and orange/amber stripes
    const bandColors = [
      '#cc4400',   // dark orange
      '#ff7700',   // vivid orange
      '#ffaa00',   // amber
      '#ff5500',   // orange-red
      '#ffcc22',   // golden yellow
      '#dd3300',   // deep red-orange
    ];

    const bH = r * 0.26;           // band height
    const startY = cy - r * 1.8;   // start well above (covers rotation overshoot)

    for (let i = 0; i < 14; i++) {
      const y = startY + i * bH;
      if (i % 2 === 0) {
        // Orange band
        ctx.fillStyle = bandColors[(i / 2) % bandColors.length];
        ctx.fillRect(cx - r * 2.5, y, r * 5, bH);
      } else {
        // Dark purple gap
        ctx.fillStyle = '#4a0070';
        ctx.fillRect(cx - r * 2.5, y, r * 5, bH);
      }
    }

    // Bright highlight streak across middle
    ctx.fillStyle = 'rgba(255, 200, 80, 0.30)';
    ctx.fillRect(cx - r * 2.5, cy - r * 0.35, r * 5, bH * 0.5);

    ctx.restore();

    // ── Magenta / pink edge atmosphere ────────────────────────────────────────────
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.clip();
    const edgeGrad = ctx.createRadialGradient(cx, cy, r * 0.55, cx, cy, r);
    edgeGrad.addColorStop(0,   'rgba(180, 0, 120, 0)');
    edgeGrad.addColorStop(0.7, 'rgba(180, 0, 120, 0)');
    edgeGrad.addColorStop(1,   'rgba(220, 40, 160, 0.65)');
    ctx.fillStyle = edgeGrad;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // ── Surface crescent highlight ─────────────────────────────────────────────────
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.clip();
    const hlGrad = ctx.createRadialGradient(cx - r * 0.38, cy - r * 0.38, 0, cx - r * 0.32, cy - r * 0.32, r * 0.60);
    hlGrad.addColorStop(0,  'rgba(255, 220, 120, 0.28)');
    hlGrad.addColorStop(1,  'rgba(255, 220, 120, 0)');
    ctx.fillStyle = hlGrad;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // ── Atmosphere rim ────────────────────────────────────────────────────────────
    ctx.save();
    ctx.shadowColor = '#ff4400';
    ctx.shadowBlur  = 10;
    ctx.strokeStyle = 'rgba(255, 90, 0, 0.55)';
    ctx.lineWidth   = 2.5;
    ctx.beginPath();
    ctx.arc(cx, cy, r + 1.5, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();

    ctx.restore();
  }

  // ── Planet sprite — SATURN (cyan gas giant with neon magenta ring) ─────────────
  // Ring is split: back arc drawn first, planet body on top, front arc drawn last
  private drawSaturnPlanet(ctx: CanvasRenderingContext2D, cx: number, cy: number): void {
    const r      = MOON_RADIUS; // 22px
    const tilt   = -0.55;       // ring tilt ≈ -31°
    const ringRx = r * 1.82;    // ring x-radius in tilted frame
    const ringRy = r * 0.40;    // ring y-radius (flat perspective)
    const ringW  = 8;           // ring stroke thickness

    ctx.save();

    // ── Back ring arc (upper half in tilted frame → goes behind planet top) ──────
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(tilt);
    ctx.save();
    ctx.shadowColor = '#bb00ee';
    ctx.shadowBlur  = 12;
    ctx.strokeStyle = '#aa00cc';
    ctx.lineWidth   = ringW;
    ctx.lineCap     = 'butt';
    ctx.beginPath();
    ctx.ellipse(0, 0, ringRx, ringRy, 0, Math.PI, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
    ctx.restore();

    // ── Planet body ───────────────────────────────────────────────────────────────
    ctx.save();
    ctx.shadowColor = '#00ccff';
    ctx.shadowBlur  = 18;

    // Radial gradient base (bright cyan highlight → deep blue edge)
    const grad = ctx.createRadialGradient(cx - r * 0.28, cy - r * 0.28, r * 0.04, cx, cy, r);
    grad.addColorStop(0,    '#88eeff');  // bright highlight
    grad.addColorStop(0.40, '#00bbdd');  // mid cyan
    grad.addColorStop(1,    '#002255');  // dark edge
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Horizontal atmosphere bands (clipped to circle)
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.clip();
    const bands: { yOff: number; h: number; col: string }[] = [
      { yOff: -0.90, h: 0.26, col: '#66ddee' },
      { yOff: -0.64, h: 0.22, col: '#007799' },
      { yOff: -0.42, h: 0.28, col: '#44ccdd' },
      { yOff: -0.14, h: 0.26, col: '#005f88' },
      { yOff:  0.12, h: 0.28, col: '#55ddee' },
      { yOff:  0.40, h: 0.28, col: '#004466' },
      { yOff:  0.68, h: 0.32, col: '#33bbcc' },
    ];
    for (const b of bands) {
      ctx.fillStyle = b.col;
      ctx.fillRect(cx - r * 1.5, cy + b.yOff * r, r * 3, b.h * r);
    }
    // Top-left crescent gleam
    const hl = ctx.createRadialGradient(cx - r * 0.32, cy - r * 0.32, 0, cx - r * 0.28, cy - r * 0.28, r * 0.58);
    hl.addColorStop(0,  'rgba(200, 255, 255, 0.32)');
    hl.addColorStop(1,  'rgba(200, 255, 255, 0)');
    ctx.fillStyle = hl;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // ── Front ring arc (lower half in tilted frame → in front of planet bottom) ──
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(tilt);
    ctx.save();
    ctx.shadowColor = '#ee44ff';
    ctx.shadowBlur  = 14;
    // Outer bright magenta
    ctx.strokeStyle = '#cc22ff';
    ctx.lineWidth   = ringW;
    ctx.lineCap     = 'butt';
    ctx.beginPath();
    ctx.ellipse(0, 0, ringRx, ringRy, 0, 0, Math.PI);
    ctx.stroke();
    // Inner darker purple edge (depth)
    ctx.strokeStyle = '#770099';
    ctx.lineWidth   = 2.5;
    ctx.beginPath();
    ctx.ellipse(0, 0, ringRx - ringW * 0.45, ringRy - 2, 0, 0, Math.PI);
    ctx.stroke();
    ctx.restore();
    ctx.restore();

    ctx.restore();
  }
}
