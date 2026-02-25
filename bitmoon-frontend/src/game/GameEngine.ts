import type { GameEvent, TierNumber } from '../types';
import {
  CANVAS_W, CANVAS_H,
  PLAYER_SPEED, PLAYER_LIVES, PLAYER_INVINCIBLE, PLAYER_SIZE, PLAYER_SHOOT_RATE, BULLET_SPEED,
  MOON_SPEED, MOON_Y_LANE, MOON_RADIUS, MOON_PENALTY,
  TIER_CONFIGS, BASE_ENEMY_SPEED,
  buildWave,
} from './constants';
import type { GameState, GameCallbacks, EnemyEntity, ParticleEntity } from './types';

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

  public getEvents(): GameEvent[] { return [...this.events]; }
  public getScore():  number      { return this.state.score; }
  public getBurned(): bigint      { return this.state.burned; }

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
      enemies:    [],
      moon:       null,
      bullets:    [],
      particles:  [],
      nextSpawns: [],
      spawnTick:  0,
      shootCooldown: 0,
      nextEnemyId:   0,
      nextBulletId:  0,
      moonSpawned:   false,
    };
  }

  private beginWave(waveNum: number): void {
    const s = this.state;
    s.wave     = waveNum;
    s.phase    = 'playing';
    s.enemies  = [];
    s.bullets  = [];
    s.moon     = null;
    s.moonSpawned = false;
    s.nextSpawns  = buildWave(waveNum);
    s.spawnTick   = s.tick;
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
    this.checkCollisions();
    this.updateParticles();
    this.checkWaveClear();

    if (s.shootCooldown > 0) s.shootCooldown--;
    if (s.player.invincibleFrames > 0) s.player.invincibleFrames--;
  }

  // ── Spawn enemies from left edge ─────────────────────────────────────────────

  private spawnEnemies(): void {
    const s = this.state;
    const elapsedTicks = s.tick - s.spawnTick;

    // Moon: spawn once when first enemy would appear + 30 frames
    if (!s.moonSpawned && s.nextSpawns.length > 0 && elapsedTicks >= s.nextSpawns[0].delayFrames + 30) {
      s.moon = {
        x: -MOON_RADIUS * 2,
        y: CANVAS_H * MOON_Y_LANE,
        alive: true,
        flashFrames: 0,
      };
      s.moonSpawned = true;
    }

    while (s.nextSpawns.length > 0 && elapsedTicks >= s.nextSpawns[0].delayFrames) {
      const spawn = s.nextSpawns.shift()!;
      const cfg   = TIER_CONFIGS[spawn.tier];
      const enemy: EnemyEntity = {
        id:          s.nextEnemyId++,
        x:           -30,
        y:           CANVAS_H * spawn.yFraction,
        baseY:       CANVAS_H * spawn.yFraction,
        phase:       Math.random() * Math.PI * 2,
        vx:          BASE_ENEMY_SPEED * cfg.speedFactor,
        tier:        spawn.tier,
        cfg,
        hp:          cfg.hp,
        maxHp:       cfg.hp,
        invulnerable: spawn.invulnerable,
        alive:       true,
        flashFrames: 0,
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

  // ── Auto-aim + shoot toward nearest killable enemy ────────────────────────────

  private autoShoot(): void {
    const s = this.state;
    if (s.shootCooldown > 0) return;

    // Find nearest killable enemy
    let nearest: EnemyEntity | null = null;
    let bestDist = Infinity;
    for (const e of s.enemies) {
      if (!e.alive || e.invulnerable) continue;
      const dx = e.x - s.player.x;
      const dy = e.y - s.player.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < bestDist) { bestDist = dist; nearest = e; }
    }

    if (!nearest) return;

    // Aim toward enemy's current position (lead slightly based on distance)
    const dx = nearest.x - s.player.x;
    const dy = nearest.y - s.player.y;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    s.bullets.push({
      id: s.nextBulletId++,
      x: s.player.x,
      y: s.player.y,
      vx: (dx / len) * BULLET_SPEED,
      vy: (dy / len) * BULLET_SPEED,
      fromPlayer: true,
    });
    s.shootCooldown = PLAYER_SHOOT_RATE;
  }

  // ── Bullet movement ───────────────────────────────────────────────────────────

  private moveBullets(): void {
    const s = this.state;
    for (let i = s.bullets.length - 1; i >= 0; i--) {
      const b = s.bullets[i];
      b.x += b.vx;
      b.y += b.vy;
      // Remove if off-screen
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
      // Sine oscillation on Y (only for tiers 2+)
      if (e.cfg.ySine > 0) {
        e.y = e.baseY + Math.sin(s.tick * 0.04 + e.phase) * e.cfg.ySine;
      }
      if (e.flashFrames > 0) e.flashFrames--;
      // Exited right edge — gone
      if (e.x > CANVAS_W + 40) s.enemies.splice(i, 1);
    }
  }

  // ── Moon movement ─────────────────────────────────────────────────────────────

  private moveMoon(): void {
    const s = this.state;
    if (!s.moon || !s.moon.alive) return;
    s.moon.x += MOON_SPEED;
    if (s.moon.flashFrames > 0) s.moon.flashFrames--;
    // Moon exits right edge safely
    if (s.moon.x > CANVAS_W + MOON_RADIUS * 2) s.moon = null;
  }

  // ── Collision detection ───────────────────────────────────────────────────────

  private checkCollisions(): void {
    const s = this.state;

    // Player bullets vs enemies
    for (let bi = s.bullets.length - 1; bi >= 0; bi--) {
      const b = s.bullets[bi];
      if (!b.fromPlayer) continue;

      for (const e of s.enemies) {
        if (!e.alive) continue;
        const dx = b.x - e.x;
        const dy = b.y - e.y;
        if (Math.sqrt(dx * dx + dy * dy) > 22) continue;

        if (e.invulnerable) {
          // Bullet bounces off (visual feedback, no damage)
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
        }
        break;
      }
    }

    // Enemy bullets vs player
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

    // Enemies vs moon
    if (s.moon?.alive) {
      for (const e of s.enemies) {
        if (!e.alive) continue;
        const dx = e.x - s.moon.x;
        const dy = e.y - s.moon.y;
        if (Math.sqrt(dx * dx + dy * dy) < MOON_RADIUS + 16) {
          // Moon destroyed
          s.moon.alive = false;
          s.score = Math.max(0, s.score - MOON_PENALTY);
          this.spawnExplosion(s.moon.x, s.moon.y, '#ffd700');
          this.spawnExplosion(s.moon.x, s.moon.y, '#ffd700');
          this.events.push({ tick: s.tick, type: 'miss', wave: s.wave });
          this.cbs.onScore(s.score);
          // Remove the enemy that hit the moon
          e.alive = false;
          break;
        }
        // Flash moon when enemies nearby
        if (Math.sqrt(dx * dx + dy * dy) < MOON_RADIUS + 60) {
          s.moon.flashFrames = 6;
        }
      }
    }

    // Enemy fires back at player
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

  private hitPlayer(): void {
    const s = this.state;
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
    // Wave is clear when: no enemies alive, no more spawns queued, and moon has passed/resolved
    const allSpawned  = s.nextSpawns.length === 0;
    const noEnemies   = s.enemies.filter(e => e.alive).length === 0;
    const moonResolved = s.moon === null || !s.moon.alive || s.moon.x > CANVAS_W;

    if (allSpawned && noEnemies && moonResolved) {
      this.events.push({ tick: s.tick, type: 'wave_clear', wave: s.wave });
      s.phase     = 'wave_clear';
      s.spawnTick = s.tick; // reuse spawnTick for wave-clear pause timing
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

    // Moon
    if (s.moon?.alive) {
      const m = s.moon;
      const alpha = m.flashFrames > 0 ? 0.5 + 0.5 * Math.sin(m.flashFrames * 1.2) : 1;
      ctx.globalAlpha = alpha;
      ctx.font = '38px serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('🌕', m.x, m.y);
      ctx.globalAlpha = 1;
      // Glow ring when in danger
      if (m.flashFrames > 0) {
        ctx.beginPath();
        ctx.arc(m.x, m.y, MOON_RADIUS + 8, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(255,215,0,0.4)';
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    }

    // Enemies
    ctx.font = '22px serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const e of s.enemies) {
      if (!e.alive) continue;
      const alpha = e.flashFrames > 0 ? 0.4 + 0.6 * Math.sin(e.flashFrames * 1.5) : 1;
      ctx.globalAlpha = alpha;
      ctx.fillText(e.cfg.glyph, e.x, e.y);

      // Invulnerable shield ring
      if (e.invulnerable) {
        ctx.beginPath();
        ctx.arc(e.x, e.y, 18, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(0,212,255,${0.4 + 0.3 * Math.sin(s.tick * 0.1)})`;
        ctx.lineWidth = 2;
        ctx.stroke();
      }
      ctx.globalAlpha = 1;

      // HP bar for multi-hp enemies
      if (e.maxHp > 1) {
        const barW = 28, barH = 3;
        const hpFrac = e.hp / e.maxHp;
        ctx.fillStyle = 'rgba(0,0,0,0.5)';
        ctx.fillRect(e.x - barW / 2, e.y + 14, barW, barH);
        ctx.fillStyle = hpFrac > 0.5 ? '#2ecc71' : hpFrac > 0.25 ? '#f7931a' : '#e74c3c';
        ctx.fillRect(e.x - barW / 2, e.y + 14, barW * hpFrac, barH);
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

    // Enemy bullets
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

    // Player ship
    const p = s.player;
    const blink = p.invincibleFrames > 0 && Math.floor(p.invincibleFrames / 6) % 2 === 0;
    if (!blink) {
      ctx.font = '28px serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('🚀', p.x, p.y);
      // Thrust glow
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
