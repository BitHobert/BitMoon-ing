// Retro chiptune sound engine using Web Audio API (no files, fully synthesized)

export class AudioEngine {
  private ctx:         AudioContext | null = null;
  private _masterGain: GainNode    | null = null;
  private muted = false;

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  /** Call on first user gesture to unlock AudioContext (browser autoplay policy). */
  public resume(): void {
    if (!this.ctx) {
      this.ctx         = new AudioContext();
      this._masterGain = this.ctx.createGain();
      this._masterGain.gain.value = 0.35;
      this._masterGain.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  public setMuted(muted: boolean): void {
    this.muted = muted;
    if (this._masterGain && this.ctx)
      this._masterGain.gain.setTargetAtTime(muted ? 0 : 0.35, this.ctx.currentTime, 0.02);
  }

  public isMuted(): boolean { return this.muted; }

  // ── Sound methods ──────────────────────────────────────────────────────────

  /** Crisp square-wave laser zap — fires every ~12 frames so kept short & quiet. */
  public playShoot(): void {
    const ctx = this.ctx; if (!ctx) return;
    this.osc('square', 880, ctx.currentTime, 0.08, 0.25, 220);
  }

  /** Soft triangle blip — enemy hit but still alive. */
  public playEnemyHit(): void {
    const ctx = this.ctx; if (!ctx) return;
    this.osc('triangle', 440, ctx.currentTime, 0.06, 0.18, 220);
  }

  /** Noise pop + low sine thud — enemy destroyed. */
  public playEnemyKill(): void {
    const ctx = this.ctx; if (!ctx) return;
    const t = ctx.currentTime;
    this.noise(t, 0.15, 0.3, 800);
    this.osc('sine', 180, t, 0.15, 0.25, 60);
  }

  /** Rising arpeggio + low rumble — boss wave begins. */
  public playBossSpawn(): void {
    const ctx = this.ctx; if (!ctx) return;
    const t = ctx.currentTime;
    [65.4, 82.4, 98.0].forEach((f, i) => this.osc('square', f, t + i * 0.12, 0.10, 0.4));
    this.osc('sawtooth', 55, t + 0.38, 0.9, 0.35, 110);
    this.noise(t + 0.38, 0.5, 0.2, 400);
  }

  /** Metallic square-wave clang + hi noise — boss hit but alive. */
  public playBossHit(): void {
    const ctx = this.ctx; if (!ctx) return;
    const t = ctx.currentTime;
    this.osc('square', 220, t, 0.12, 0.35, 110);
    this.noise(t, 0.08, 0.2, 1200);
  }

  /** Triple staggered noise explosion + low sawtooth roar + victory ping — boss killed. */
  public playBossKill(): void {
    const ctx = this.ctx; if (!ctx) return;
    const t = ctx.currentTime;
    this.noise(t,       0.4, 0.5, 600);
    this.noise(t + 0.1, 0.4, 0.4, 400);
    this.noise(t + 0.2, 0.5, 0.6, 800);
    this.osc('sawtooth', 200, t,       1.2, 0.45, 30);
    this.osc('sine',    1760, t + 0.3, 0.4, 0.2,  880);
  }

  /** Rising sine sweep + noise swoosh — player shield absorbs a hit. */
  public playShieldBlock(): void {
    const ctx = this.ctx; if (!ctx) return;
    const t = ctx.currentTime;
    this.osc('sine', 660, t, 0.25, 0.4, 1320);
    this.noise(t, 0.1, 0.15, 2000);
  }

  /** Harsh sawtooth descend + noise burst — player loses a life. */
  public playPlayerHit(): void {
    const ctx = this.ctx; if (!ctx) return;
    const t = ctx.currentTime;
    this.osc('sawtooth', 440, t, 0.3, 0.5, 110);
    this.noise(t, 0.2, 0.3, 600);
  }

  /** Classic descending chromatic jingle — game over. */
  public playGameOver(): void {
    const ctx = this.ctx; if (!ctx) return;
    const t = ctx.currentTime;
    const notes = [
      { f: 523.25, d: 0.12 },
      { f: 466.16, d: 0.12 },
      { f: 415.30, d: 0.12 },
      { f: 369.99, d: 0.12 },
      { f: 329.63, d: 0.18 },
      { f: 261.63, d: 0.40 },
    ];
    let off = 0;
    for (const n of notes) {
      this.osc('square', n.f, t + off, n.d * 0.9, 0.4);
      off += n.d;
    }
    this.osc('sine', 80, t + off - 0.4, 0.6, 0.3, 40);
  }

  /** Ascending major-triad arpeggio — powerup collected. */
  public playPowerupPickup(): void {
    const ctx = this.ctx; if (!ctx) return;
    const t = ctx.currentTime;
    [523.25, 659.25, 783.99, 1046.50].forEach((f, i) =>
      this.osc('square', f, t + i * 0.07, 0.07, 0.3));
  }

  /** Low bass thud + high resonant ring — planet shield absorbs enemy impact. */
  public playPlanetShieldHit(): void {
    const ctx = this.ctx; if (!ctx) return;
    const t = ctx.currentTime;
    this.osc('sine',  120, t, 0.3, 0.5, 50);
    this.osc('sine', 1200, t, 0.6, 0.2, 600);
    this.noise(t, 0.15, 0.35, 500);
  }

  /** Heavy explosion + descending sawtooth + alarm beeps — planet destroyed. */
  public playPlanetDestroyed(): void {
    const ctx = this.ctx; if (!ctx) return;
    const t = ctx.currentTime;
    this.noise(t,       0.6, 0.7, 300);
    this.noise(t + 0.1, 0.5, 0.6, 600);
    this.osc('sawtooth', 150, t,        1.0, 0.5,  20);
    this.osc('square',   880, t + 0.5,  0.15, 0.3);
    this.osc('square',   880, t + 0.72, 0.15, 0.3);
  }

  /** Ascending G-major fanfare + shimmer — wave cleared. */
  public playWaveClear(): void {
    const ctx = this.ctx; if (!ctx) return;
    const t = ctx.currentTime;
    [392.0, 493.88, 587.33, 783.99].forEach((f, i) =>
      this.osc('square', f, t + i * 0.10, 0.18, 0.35));
    this.osc('sine', 783.99, t + 0.38, 0.45, 0.2);
  }

  // ── Private synthesis helpers ──────────────────────────────────────────────

  private osc(
    type: OscillatorType,
    freq: number,
    startTime: number,
    duration: number,
    gainPeak: number,
    freqEnd?: number,
  ): void {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    const g   = ctx.createGain();

    osc.type = type;
    osc.frequency.setValueAtTime(freq, startTime);
    if (freqEnd !== undefined)
      osc.frequency.exponentialRampToValueAtTime(Math.max(freqEnd, 1), startTime + duration);

    g.gain.setValueAtTime(0, startTime);
    g.gain.linearRampToValueAtTime(gainPeak, startTime + 0.003);
    g.gain.exponentialRampToValueAtTime(0.001, startTime + duration);

    osc.connect(g);
    g.connect(this._masterGain!);
    osc.start(startTime);
    osc.stop(startTime + duration + 0.01);
  }

  private noise(
    startTime: number,
    duration: number,
    gainPeak: number,
    filterFreq = 2000,
  ): void {
    const ctx = this.ctx!;
    const buf = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * duration), ctx.sampleRate);
    const d   = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;

    const src = ctx.createBufferSource();
    src.buffer = buf;

    const flt       = ctx.createBiquadFilter();
    flt.type            = 'bandpass';
    flt.frequency.value = filterFreq;
    flt.Q.value         = 0.8;

    const g = ctx.createGain();
    g.gain.setValueAtTime(gainPeak, startTime);
    g.gain.exponentialRampToValueAtTime(0.001, startTime + duration);

    src.connect(flt);
    flt.connect(g);
    g.connect(this._masterGain!);
    src.start(startTime);
    src.stop(startTime + duration + 0.01);
  }
}
