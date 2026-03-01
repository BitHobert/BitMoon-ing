import type { NavigateFn } from '../App';
import type { TierNumber } from '../types';
import {
  TIER_CONFIGS,
  PLANETS,
  BOSS_POOL,
  POWERUP_CONFIGS,
} from '../game/constants';

// ── Helpers ──────────────────────────────────────────────────────────────────

function framesTo(s: number): string {
  return `${(s / 60).toFixed(0)}s`;
}

// ── Styles ───────────────────────────────────────────────────────────────────

const sectionTitle: React.CSSProperties = {
  fontSize: 10,
  marginBottom: 12,
};

const tableStyle: React.CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  fontFamily: 'var(--font-mono)',
  fontSize: 10,
};

const thStyle: React.CSSProperties = {
  padding: '8px 6px',
  textAlign: 'left',
  fontFamily: 'var(--font-pixel)',
  fontSize: 7,
  color: 'var(--color-text-dim)',
  borderBottom: '1px solid var(--color-border)',
};

const tdStyle: React.CSSProperties = {
  padding: '6px',
  borderBottom: '1px solid var(--color-border)',
};

const noteStyle: React.CSSProperties = {
  fontSize: 9,
  fontFamily: 'var(--font-mono)',
  color: 'var(--color-text-dim)',
  marginTop: 8,
  fontStyle: 'italic',
};

const infoBlock: React.CSSProperties = {
  background: 'var(--color-bg)',
  borderRadius: 4,
  padding: '8px 12px',
  marginBottom: 8,
  fontSize: 10,
  fontFamily: 'var(--font-mono)',
  color: 'var(--color-text)',
};

const tierColors: Record<TierNumber, string> = {
  1: 'var(--color-text)',
  2: 'var(--color-blue)',
  3: 'var(--color-orange)',
  4: '#ff6b6b',
  5: '#ff3b3b',
};

// ── Power-up effect descriptions ──────────────────────────────────────────────

const POWERUP_EFFECTS: Record<string, string> = {
  weapon: 'Triple shot + faster fire rate (±18° spread)',
  laser:  'Piercing beam — 10 hits/sec through enemies',
  shield: 'Absorbs 1 hit per stack (max 2 stacks)',
};

// ── Component ─────────────────────────────────────────────────────────────────

interface Props { navigate: NavigateFn; }

export function GameGuidePage({ navigate }: Props) {
  const tiers    = Object.values(TIER_CONFIGS);
  const planets  = Object.entries(PLANETS);
  const bosses   = BOSS_POOL;
  const powerups = Object.values(POWERUP_CONFIGS);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', background: 'var(--color-bg)' }}>

      {/* Header */}
      <header style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '14px 24px', borderBottom: '1px solid var(--color-border)',
        background: 'var(--color-bg-card)', gap: 16, flexWrap: 'wrap',
      }}>
        <div className="pixel glow-orange" style={{ fontSize: 14, letterSpacing: 2 }}>GAME GUIDE</div>
        <button className="btn btn-blue" style={{ fontSize: 8 }} onClick={() => navigate('lobby')}>
          ← LOBBY
        </button>
      </header>

      <main style={{ flex: 1, padding: 24, display: 'flex', flexDirection: 'column', gap: 24, maxWidth: 900, margin: '0 auto', width: '100%' }}>

        {/* ── ENEMIES ────────────────────────────────────────────────────── */}
        <section className="card" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <h2 className="pixel" style={{ ...sectionTitle, color: 'var(--color-orange)' }}>
            👾 ENEMIES
          </h2>
          <div style={{ overflowX: 'auto' }}>
            <table style={tableStyle}>
              <thead>
                <tr>
                  {['TIER', '', 'HP', 'POINTS', 'SPEED', 'SHOOTS'].map(h => (
                    <th key={h} style={thStyle}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {tiers.map((t, i) => (
                  <tr key={t.tier} style={{ background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.02)' }}>
                    <td style={{ ...tdStyle, color: tierColors[t.tier], fontFamily: 'var(--font-pixel)', fontSize: 8 }}>
                      T{t.tier}
                    </td>
                    <td style={tdStyle}>
                      {t.sprite
                        ? <img src={`/${t.sprite}`} alt={`T${t.tier}`} style={{ width: 32, height: 32, objectFit: 'contain', imageRendering: 'pixelated' }} />
                        : <span style={{ fontSize: 18 }}>{t.glyph}</span>}
                    </td>
                    <td style={{ ...tdStyle, color: 'var(--color-text)' }}>{t.hp}</td>
                    <td style={{ ...tdStyle, color: 'var(--color-green)' }}>{t.basePoints.toLocaleString()}</td>
                    <td style={{ ...tdStyle, color: 'var(--color-text)' }}>{t.speedFactor}x</td>
                    <td style={{ ...tdStyle, color: t.firesBack ? '#ff3b3b' : 'var(--color-text-dim)' }}>
                      {t.firesBack ? 'YES ⚠' : 'NO'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p style={noteStyle}>
            Higher tiers appear in later waves. ~20% of enemies are invulnerable (dodge them!).
          </p>
        </section>

        {/* ── PLANETS ────────────────────────────────────────────────────── */}
        <section className="card" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <h2 className="pixel" style={{ ...sectionTitle, color: '#b975ff' }}>
            🌕 PLANETS
          </h2>
          <div style={{ overflowX: 'auto' }}>
            <table style={tableStyle}>
              <thead>
                <tr>
                  {['', 'NAME', 'HP', 'PENALTY IF DESTROYED'].map(h => (
                    <th key={h} style={thStyle}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {planets.map(([key, p], i) => (
                  <tr key={key} style={{ background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.02)' }}>
                    <td style={tdStyle}>
                      {p.spriteId
                        ? <img src={`/${p.spriteId}`} alt={p.label} style={{ width: 36, height: 36, objectFit: 'contain', imageRendering: 'pixelated' }} />
                        : <span style={{ fontSize: 18 }}>{p.glyph}</span>}
                    </td>
                    <td style={{ ...tdStyle, fontFamily: 'var(--font-pixel)', fontSize: 8, color: 'var(--color-text)' }}>
                      {p.label}
                    </td>
                    <td style={{ ...tdStyle, color: 'var(--color-text)' }}>{p.hp}</td>
                    <td style={{ ...tdStyle, color: '#ff3b3b' }}>-{p.penalty.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p style={noteStyle}>
            Protect them! Enemies will destroy planets and you lose points. They drift across the screen — don't hit them with your bullets either.
          </p>
        </section>

        {/* ── BOSSES ─────────────────────────────────────────────────────── */}
        <section className="card" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <h2 className="pixel" style={{ ...sectionTitle, color: '#ff3b3b' }}>
            👹 BOSSES
          </h2>
          <div style={{ overflowX: 'auto' }}>
            <table style={tableStyle}>
              <thead>
                <tr>
                  {['', 'NAME', 'HP', 'POINTS', 'FIRE RATE', 'BULLETS'].map(h => (
                    <th key={h} style={thStyle}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {bosses.map((b, i) => (
                  <tr key={b.name} style={{ background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.02)' }}>
                    <td style={tdStyle}>
                      {b.sprite
                        ? <img src={`/${b.sprite}`} alt={b.name} style={{ width: 40, height: 40, objectFit: 'contain', imageRendering: 'pixelated' }} />
                        : <span style={{ fontSize: 18 }}>{b.glyph}</span>}
                    </td>
                    <td style={{ ...tdStyle, fontFamily: 'var(--font-pixel)', fontSize: 8, color: 'var(--color-orange)' }}>
                      {b.name}
                    </td>
                    <td style={{ ...tdStyle, color: 'var(--color-text)' }}>{b.hp}</td>
                    <td style={{ ...tdStyle, color: 'var(--color-green)' }}>{b.points.toLocaleString()}</td>
                    <td style={{ ...tdStyle, color: 'var(--color-text)' }}>
                      every {b.fireRate}f
                    </td>
                    <td style={{ ...tdStyle, color: b.bulletSpread > 1 ? '#ff3b3b' : 'var(--color-text)' }}>
                      {b.bulletSpread}{b.bulletSpread > 1 ? ' (spread)' : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p style={noteStyle}>
            Bosses appear every 5 waves (wave 5, 10, 15, 20…). They cycle through the roster. Each boss patrols for {framesTo(bosses[0]?.duration ?? 1200)} before retreating.
          </p>
        </section>

        {/* ── POWER-UPS ──────────────────────────────────────────────────── */}
        <section className="card" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <h2 className="pixel" style={{ ...sectionTitle, color: 'var(--color-green)' }}>
            ⚡ POWER-UPS
          </h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {powerups.map(p => (
              <div key={p.kind} style={{
                ...infoBlock,
                display: 'flex', alignItems: 'center', gap: 12,
                border: '1px solid var(--color-border)',
              }}>
                <span style={{ fontSize: 24 }}>{p.glyph}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontFamily: 'var(--font-pixel)', fontSize: 8, color: 'var(--color-green)', marginBottom: 4 }}>
                    {p.label}
                  </div>
                  <div style={{ fontSize: 9, color: 'var(--color-text-dim)' }}>
                    {POWERUP_EFFECTS[p.kind]}
                  </div>
                </div>
                <div style={{ textAlign: 'right', fontFamily: 'var(--font-pixel)', fontSize: 7, color: 'var(--color-text-dim)' }}>
                  <div>{Math.round(p.dropChance * 100)}% DROP</div>
                  <div style={{ marginTop: 2 }}>
                    {p.duration > 0 ? framesTo(p.duration) : `${p.maxStacks ?? 1} stack`}
                  </div>
                </div>
              </div>
            ))}
          </div>
          <p style={noteStyle}>
            Power-ups drop randomly when you kill enemies. Collect them by flying over the icon.
          </p>
        </section>

        {/* ── TOURNAMENTS & PRIZES ───────────────────────────────────────── */}
        <section className="card" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <h2 className="pixel" style={{ ...sectionTitle, color: 'var(--color-orange)' }}>
            🏆 TOURNAMENTS & PRIZES
          </h2>

          <div style={infoBlock}>
            <div style={{ fontFamily: 'var(--font-pixel)', fontSize: 8, color: 'var(--color-orange)', marginBottom: 4 }}>
              FEE ALLOCATION
            </div>
            <div style={{ fontSize: 9, color: 'var(--color-text-dim)' }}>
              Every tournament entry fee is split three ways:
            </div>
            <div style={{ display: 'flex', gap: 12, marginTop: 8, flexWrap: 'wrap' }}>
              {[
                { pct: '80%', label: 'PRIZE POOL', color: 'var(--color-green)' },
                { pct: '15%', label: 'NEXT PERIOD', color: 'var(--color-blue)' },
                { pct: '5%',  label: 'DEV FEE',    color: 'var(--color-text-dim)' },
              ].map(s => (
                <div key={s.label} style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  padding: '4px 10px', borderRadius: 3,
                  background: 'var(--color-bg)', border: '1px solid var(--color-border)',
                }}>
                  <span style={{ fontFamily: 'var(--font-pixel)', fontSize: 9, color: s.color }}>{s.pct}</span>
                  <span style={{ fontSize: 8, fontFamily: 'var(--font-pixel)', color: 'var(--color-text-dim)' }}>{s.label}</span>
                </div>
              ))}
            </div>
          </div>

          <div style={infoBlock}>
            <div style={{ fontFamily: 'var(--font-pixel)', fontSize: 8, color: 'var(--color-orange)', marginBottom: 4 }}>
              PRIZE DISTRIBUTION
            </div>
            <div style={{ fontSize: 9, color: 'var(--color-text-dim)', marginBottom: 8 }}>
              At the end of each tournament period, the prize pool is distributed to the top players on-chain:
            </div>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              {[
                { medal: '🥇', pct: '70%', label: '1ST PLACE' },
                { medal: '🥈', pct: '20%', label: '2ND PLACE' },
                { medal: '🥉', pct: '10%', label: '3RD PLACE' },
              ].map(p => (
                <div key={p.label} style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  padding: '4px 10px', borderRadius: 3,
                  background: 'var(--color-bg)', border: '1px solid var(--color-border)',
                }}>
                  <span style={{ fontSize: 12 }}>{p.medal}</span>
                  <span style={{ fontFamily: 'var(--font-pixel)', fontSize: 9, color: 'var(--color-green)' }}>{p.pct}</span>
                  <span style={{ fontSize: 8, fontFamily: 'var(--font-pixel)', color: 'var(--color-text-dim)' }}>{p.label}</span>
                </div>
              ))}
            </div>
            <div style={{ fontSize: 9, color: 'var(--color-text-dim)', marginTop: 8 }}>
              If fewer than 3 players enter, the split adjusts automatically. Unclaimed pools roll over to the next period.
            </div>
          </div>

          <div style={infoBlock}>
            <div style={{ fontFamily: 'var(--font-pixel)', fontSize: 8, color: 'var(--color-orange)', marginBottom: 4 }}>
              SPONSOR BONUSES
            </div>
            <div style={{ fontSize: 9, color: 'var(--color-text-dim)' }}>
              Sponsors can deposit bonus tokens into any tournament period. These bonuses are added on top of the regular prize pool and awarded to the 1st place winner. Sponsor slots are limited to 50 per period.
            </div>
          </div>
        </section>

        {/* ── SCORING ────────────────────────────────────────────────────── */}
        <section className="card" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <h2 className="pixel" style={{ ...sectionTitle, color: 'var(--color-blue)' }}>
            🎯 SCORING SYSTEM
          </h2>

          <div style={infoBlock}>
            <div style={{ fontFamily: 'var(--font-pixel)', fontSize: 8, color: 'var(--color-orange)', marginBottom: 4 }}>
              BASE FORMULA
            </div>
            <div style={{ color: 'var(--color-green)', fontFamily: 'var(--font-mono)' }}>
              Score = basePoints × waveClearBonus
            </div>
            <div style={{ fontSize: 9, color: 'var(--color-text-dim)', marginTop: 4 }}>
              Each enemy tier has different base points. Clear waves quickly to earn a bonus multiplier on the next wave.
            </div>
          </div>

          <div style={infoBlock}>
            <div style={{ fontFamily: 'var(--font-pixel)', fontSize: 8, color: 'var(--color-orange)', marginBottom: 4 }}>
              WAVE CLEAR BONUS
            </div>
            <div style={{ color: 'var(--color-green)', fontFamily: 'var(--font-mono)' }}>
              5x multiplier for ~10 seconds after clearing a wave
            </div>
            <div style={{ fontSize: 9, color: 'var(--color-text-dim)', marginTop: 4 }}>
              Clear all enemies in a wave quickly, then kill the next wave's enemies during the bonus window for massive points.
            </div>
          </div>

          <div style={infoBlock}>
            <div style={{ fontFamily: 'var(--font-pixel)', fontSize: 8, color: 'var(--color-orange)', marginBottom: 4 }}>
              REFLECTION BONUS
            </div>
            <div style={{ color: 'var(--color-green)', fontFamily: 'var(--font-mono)' }}>
              +1% of your current score every 25 kills
            </div>
            <div style={{ fontSize: 9, color: 'var(--color-text-dim)', marginTop: 4 }}>
              The higher your score, the bigger the bonus. Keep your kill streak going!
            </div>
          </div>

        </section>

      </main>

      {/* Footer */}
      <footer style={{
        padding: '10px 24px', borderTop: '1px solid var(--color-border)',
        fontFamily: 'var(--font-pixel)', fontSize: 8, color: 'var(--color-text-dim)',
        display: 'flex', justifyContent: 'space-between',
      }}>
        <span>BITMOON'ING GUIDE</span>
        <span
          style={{ cursor: 'pointer', color: 'var(--color-blue)' }}
          onClick={() => navigate('lobby')}
        >
          ← BACK TO LOBBY
        </span>
      </footer>
    </div>
  );
}
