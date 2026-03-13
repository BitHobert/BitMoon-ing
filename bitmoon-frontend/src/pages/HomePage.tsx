import { useState, useEffect } from 'react';
import type { NavigateFn } from '../App';
import { getTournaments } from '../api/http';
import type { TournamentInfo, TournamentType, TierNumber, SponsorLink } from '../types';
import { SponsorIcons } from '../components/SponsorIcons';
import { PlayerCard } from '../components/PlayerCard';
import { useWalletContext } from '../context/WalletContext';
import {
  TIER_CONFIGS,
  PLANETS,
  BOSS_POOL,
  POWERUP_CONFIGS,
} from '../game/constants';

// ── Shared helpers ────────────────────────────────────────────────────────────

const TYPE_LABELS: Record<TournamentType, string> = {
  daily: 'DAILY', weekly: 'WEEKLY', monthly: 'MONTHLY',
};
const TYPE_COLORS: Record<TournamentType, string> = {
  daily: 'var(--color-blue)', weekly: 'var(--color-orange)', monthly: '#b975ff',
};
const TYPE_GLYPHS: Record<TournamentType, string> = {
  daily: '⚡', weekly: '🔥', monthly: '💎',
};

function formatTokens(raw: string, decimals = 8): string {
  const n = BigInt(raw);
  const divisor = BigInt(10 ** decimals);
  const whole = n / divisor;
  const frac = n % divisor;
  if (frac === 0n) return whole.toLocaleString();
  const fracStr = frac.toString().padStart(decimals, '0').replace(/0+$/, '');
  return `${whole.toLocaleString()}.${fracStr}`;
}

function framesTo(s: number): string {
  return `${(s / 60).toFixed(0)}s`;
}

// ── Guide styles ──────────────────────────────────────────────────────────────

const tierColors: Record<TierNumber, string> = {
  1: 'var(--color-text)', 2: 'var(--color-blue)', 3: 'var(--color-orange)', 4: '#ff6b6b', 5: '#ff3b3b',
};

const POWERUP_EFFECTS: Record<string, string> = {
  weapon: 'Triple shot + faster fire rate (±18° spread)',
  laser:  'Piercing beam — 10 hits/sec through enemies',
  shield: 'Absorbs 1 hit per stack (max 2 stacks)',
};

const tableStyle: React.CSSProperties = {
  width: '100%', borderCollapse: 'collapse', fontFamily: 'var(--font-mono)', fontSize: 14,
};
const thStyle: React.CSSProperties = {
  padding: '10px 8px', textAlign: 'left',
  fontFamily: 'var(--font-pixel)', fontSize: 11,
  color: 'var(--color-text-dim)', borderBottom: '1px solid var(--color-border)',
};
const tdStyle: React.CSSProperties = {
  padding: '10px', borderBottom: '1px solid var(--color-border)',
};
const noteStyle: React.CSSProperties = {
  fontSize: 13, fontFamily: 'var(--font-mono)', color: 'var(--color-text-dim)',
  marginTop: 10, fontStyle: 'italic',
};
const infoBlock: React.CSSProperties = {
  background: 'var(--color-bg)', borderRadius: 4, padding: '10px 14px',
  marginBottom: 10, fontSize: 14, fontFamily: 'var(--font-mono)', color: 'var(--color-text)',
};

// ── Component ─────────────────────────────────────────────────────────────────

interface Props { navigate: NavigateFn; }

export function HomePage({ navigate }: Props) {
  const { address } = useWalletContext();
  const [tournaments, setTournaments] = useState<TournamentInfo[]>([]);
  const [currentBlock, setCurrentBlock] = useState<number | null>(null);

  useEffect(() => {
    getTournaments()
      .then((r) => {
        setTournaments(r.tournaments);
        setCurrentBlock(Number(r.currentBlock));
      })
      .catch(console.error);
  }, []);

  const tiers    = Object.values(TIER_CONFIGS);
  const planets  = Object.entries(PLANETS);
  const bosses   = BOSS_POOL;
  const powerups = Object.values(POWERUP_CONFIGS);

  // Guide accordion
  type GuideSection = 'enemies' | 'planets' | 'bosses' | 'powerups' | 'tournaments' | 'scoring';
  const [openGuide, setOpenGuide] = useState<GuideSection | null>(null);
  const toggleGuide = (s: GuideSection) => setOpenGuide(openGuide === s ? null : s);

  const guideHeader = (id: GuideSection, icon: string, label: string, color: string) => (
    <button
      onClick={() => toggleGuide(id)}
      style={{
        display: 'flex', alignItems: 'center', gap: 8, width: '100%',
        padding: '10px 14px', border: 'none', cursor: 'pointer',
        background: openGuide === id ? 'var(--color-bg)' : 'transparent',
        borderBottom: `1px solid ${openGuide === id ? 'var(--color-border)' : 'transparent'}`,
      }}
    >
      <span style={{ fontSize: 14 }}>{icon}</span>
      <span className="pixel" style={{ flex: 1, textAlign: 'left', fontSize: 11, color }}>{label}</span>
      <span style={{ fontSize: 10, color: 'var(--color-text-dim)' }}>{openGuide === id ? '▲' : '▼'}</span>
    </button>
  );

  return (
    <div style={{
      position: 'relative', zIndex: 1,
      display: 'flex', flexDirection: 'column',
      minHeight: 'calc(100vh - 60px)',
      padding: '24px 20px',
      maxWidth: 1000,
      margin: '0 auto',
      width: '100%',
    }}>

      {/* Hero */}
      <div style={{ textAlign: 'center', padding: '24px 0 12px' }}>
        <h1 className="pixel glow-orange" style={{ fontSize: 20, marginBottom: 10 }}>
          SHOOT TO EARN
        </h1>
        <p style={{
          color: 'var(--color-text-dim)', fontFamily: 'var(--font-mono)', fontSize: 18, whiteSpace: 'nowrap',
          maxWidth: 400, margin: '0 auto',
        }}>
          Kill enemies · climb the leaderboard
        </p>
      </div>

      {/* Player stats — right-aligned */}
      {address && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 10 }}>
          <div style={{ width: 260 }}>
            <PlayerCard address={address} />
          </div>
        </div>
      )}

      {/* ── Linear tournament cards ─────────────────────────────────────── */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginBottom: 24 }}>

        {/* Tournament cards — full width, stacked */}
        {(['daily', 'weekly', 'monthly'] as TournamentType[]).map((type) => {
          const info = tournaments.find((t) => t.tournamentType === type);
          const color = TYPE_COLORS[type];
          const glyph = TYPE_GLYPHS[type];

          return (
            <div
              key={type}
              className="card"
              onClick={() => navigate('tournament-detail', { tournamentType: type })}
              style={{
                width: '100%',
                borderColor: color,
                boxShadow: `0 0 20px ${color}18`,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 16,
                padding: '16px 20px',
                transition: 'transform 0.15s, box-shadow 0.15s',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.transform = 'translateY(-2px)';
                e.currentTarget.style.boxShadow = `0 0 30px ${color}30`;
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = 'translateY(0)';
                e.currentTarget.style.boxShadow = `0 0 20px ${color}18`;
              }}
            >
              {/* Left: icon + label */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 120 }}>
                <span style={{ fontSize: 22 }}>{glyph}</span>
                <span className="pixel" style={{ fontSize: 13, color }}>{TYPE_LABELS[type]}</span>
              </div>

              {/* Center: prize pool + stats */}
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 24, flexWrap: 'wrap' }}>
                {info ? (
                  <>
                    <div>
                      <div style={{ fontFamily: 'var(--font-pixel)', fontSize: 7, color: 'var(--color-text-dim)', marginBottom: 2 }}>
                        PRIZE POOL
                      </div>
                      <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
                        <span className="pixel" style={{ fontSize: 14, color: 'var(--color-orange)' }}>
                          {formatTokens(info.prizePool)}
                        </span>
                        <span style={{ fontFamily: 'var(--font-pixel)', fontSize: 7, color: 'var(--color-text-dim)' }}>
                          LFGT
                        </span>
                      </div>
                    </div>
                    <div style={{ fontFamily: 'var(--font-pixel)', fontSize: 8, color: 'var(--color-text-dim)' }}>
                      <span style={{ color: 'var(--color-text)' }}>{info.entrantCount}</span> PLAYS
                      <span style={{ margin: '0 6px' }}>·</span>
                      <span style={{ color: 'var(--color-text)' }}>{formatTokens(info.entryFee)}</span> ENTRY
                      {BigInt(info.pendingPool || '0') > 0n && (
                        <>
                          <span style={{ margin: '0 6px' }}>·</span>
                          <span style={{ color: '#ffd700' }}>⏳ {formatTokens(info.pendingPool)} PENDING</span>
                        </>
                      )}
                    </div>
                    {info.sponsorBonuses && info.sponsorBonuses.length > 0 && (() => {
                      const bySymbol = new Map<string, { total: bigint; decimals: number; links: SponsorLink[] }>();
                      for (const b of info.sponsorBonuses) {
                        const sym = b.tokenSymbol || 'BONUS';
                        const prev = bySymbol.get(sym);
                        const mergedLinks = [...(prev?.links ?? []), ...(b.links ?? [])];
                        const uniqueLinks = mergedLinks.filter((l, i, arr) => arr.findIndex(x => x.platform === l.platform) === i);
                        bySymbol.set(sym, { total: (prev?.total ?? 0n) + BigInt(b.amount), decimals: b.decimals ?? 8, links: uniqueLinks });
                      }
                      return (
                        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
                          {[...bySymbol.entries()].map(([sym, { total, decimals, links }]) => (
                            <span key={sym} style={{
                              display: 'inline-flex', alignItems: 'center', gap: 3,
                              padding: '2px 6px', borderRadius: 3, fontSize: 7,
                              fontFamily: 'var(--font-pixel)',
                              background: 'rgba(57,255,20,0.1)', border: '1px solid rgba(57,255,20,0.3)',
                              color: 'var(--color-green)',
                            }}>
                              <span style={{ fontSize: 8 }}>⭐</span>
                              +{formatTokens(total.toString(), decimals)} {sym}
                              {links.length > 0 && <SponsorIcons links={links} size={10} />}
                            </span>
                          ))}
                        </div>
                      );
                    })()}
                  </>
                ) : (
                  <div style={{ fontFamily: 'var(--font-pixel)', fontSize: 9, color: 'var(--color-text-dim)' }}>
                    LOADING…
                  </div>
                )}
              </div>

              {/* Right: status + blocks + arrow */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
                {info && (
                  <span style={{
                    fontFamily: 'var(--font-pixel)', fontSize: 8,
                  }}>
                    {info.isActive ? (
                      <>
                        <span style={{ color: 'var(--color-green)' }}>● LIVE</span>
                        {currentBlock != null && (
                          <>
                            <span style={{ margin: '0 6px', color: 'var(--color-text-dim)' }}>·</span>
                            <span style={{ color: '#ffd700' }}>
                              {Math.max(0, Number(info.endsAtBlock) - currentBlock).toLocaleString()} BLOCKS LEFT
                            </span>
                          </>
                        )}
                      </>
                    ) : (
                      <><span style={{ color: '#ffd700' }}>🏆 DISTRIBUTING</span>{' · '}<span style={{ color }}>⏳ NEXT TOURNAMENT STARTS AT BLOCK {Number(info.nextStartBlock).toLocaleString()}</span></>
                    )}
                  </span>
                )}
                {(!info || info.isActive) && (
                  <span style={{ fontFamily: 'var(--font-pixel)', fontSize: 9, color }}>
                    ENTER →
                  </span>
                )}
              </div>
            </div>
          );
        })}

        {/* Free Play card — full width */}
        <div
          className="card"
          onClick={() => navigate('game', {})}
          style={{
            width: '100%',
            borderColor: 'var(--color-green)',
            boxShadow: '0 0 20px rgba(57,255,20,0.12)',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 16,
            padding: '16px 20px',
            transition: 'transform 0.15s, box-shadow 0.15s',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.transform = 'translateY(-2px)';
            e.currentTarget.style.boxShadow = '0 0 30px rgba(57,255,20,0.25)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.transform = 'translateY(0)';
            e.currentTarget.style.boxShadow = '0 0 20px rgba(57,255,20,0.12)';
          }}
        >
          {/* Left: icon + label */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 120 }}>
            <span style={{ fontSize: 22 }}>🎮</span>
            <span className="pixel" style={{ fontSize: 13, color: 'var(--color-green)' }}>PLAY NOW</span>
          </div>

          {/* Center: description */}
          <div style={{ flex: 1 }}>
            <div style={{ fontFamily: 'var(--font-pixel)', fontSize: 8, color: 'var(--color-text-dim)', marginBottom: 2 }}>
              FREE MODE
            </div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--color-text-dim)' }}>
              No entry fee · practice your skills · climb the all-time leaderboard
            </div>
          </div>

          {/* Right: arrow */}
          <span style={{ fontFamily: 'var(--font-pixel)', fontSize: 13, color: 'var(--color-green)', flexShrink: 0 }}>
            PLAY →
          </span>
        </div>
      </div>

      {/* ── GAME GUIDE ─────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20, marginBottom: 24 }}>

        <div className="pixel glow-orange" style={{ fontSize: 16, textAlign: 'center' }}>
          📖 GAME GUIDE
        </div>

        {/* Enemies */}
        <section className="card" style={{ display: 'flex', flexDirection: 'column', gap: 0, overflow: 'hidden' }}>
          {guideHeader('enemies', '👾', 'ENEMIES', 'var(--color-orange)')}
          {openGuide === 'enemies' && <div style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
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
                    <td style={{ ...tdStyle, color: tierColors[t.tier], fontFamily: 'var(--font-pixel)', fontSize: 12 }}>
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
          </div>}
        </section>

        {/* Planets */}
        <section className="card" style={{ display: 'flex', flexDirection: 'column', gap: 0, overflow: 'hidden' }}>
          {guideHeader('planets', '🌕', 'PLANETS', '#b975ff')}
          {openGuide === 'planets' && <div style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
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
                    <td style={{ ...tdStyle, fontFamily: 'var(--font-pixel)', fontSize: 12, color: 'var(--color-text)' }}>
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
          </div>}
        </section>

        {/* Bosses */}
        <section className="card" style={{ display: 'flex', flexDirection: 'column', gap: 0, overflow: 'hidden' }}>
          {guideHeader('bosses', '👹', 'BOSSES', '#ff3b3b')}
          {openGuide === 'bosses' && <div style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
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
                    <td style={{ ...tdStyle, fontFamily: 'var(--font-pixel)', fontSize: 12, color: 'var(--color-orange)' }}>
                      {b.name}
                    </td>
                    <td style={{ ...tdStyle, color: 'var(--color-text)' }}>{b.hp}</td>
                    <td style={{ ...tdStyle, color: 'var(--color-green)' }}>{b.points.toLocaleString()}</td>
                    <td style={{ ...tdStyle, color: 'var(--color-text)' }}>every {b.fireRate}f</td>
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
          </div>}
        </section>

        {/* Power-ups */}
        <section className="card" style={{ display: 'flex', flexDirection: 'column', gap: 0, overflow: 'hidden' }}>
          {guideHeader('powerups', '⚡', 'POWER-UPS', 'var(--color-green)')}
          {openGuide === 'powerups' && <div style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {powerups.map(p => (
              <div key={p.kind} style={{
                ...infoBlock,
                display: 'flex', alignItems: 'center', gap: 12,
                border: '1px solid var(--color-border)',
              }}>
                <span style={{ fontSize: 24 }}>{p.glyph}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontFamily: 'var(--font-pixel)', fontSize: 12, color: 'var(--color-green)', marginBottom: 4 }}>
                    {p.label}
                  </div>
                  <div style={{ fontSize: 13, color: 'var(--color-text-dim)' }}>
                    {POWERUP_EFFECTS[p.kind]}
                  </div>
                </div>
                <div style={{ textAlign: 'right', fontFamily: 'var(--font-pixel)', fontSize: 11, color: 'var(--color-text-dim)' }}>
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
          </div>}
        </section>

        {/* Tournaments & Prizes */}
        <section className="card" style={{ display: 'flex', flexDirection: 'column', gap: 0, overflow: 'hidden' }}>
          {guideHeader('tournaments', '🏆', 'TOURNAMENTS & PRIZES', 'var(--color-orange)')}
          {openGuide === 'tournaments' && <div style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>

          <div style={infoBlock}>
            <div style={{ fontFamily: 'var(--font-pixel)', fontSize: 12, color: 'var(--color-orange)', marginBottom: 4 }}>
              FEE ALLOCATION
            </div>
            <div style={{ fontSize: 13, color: 'var(--color-text-dim)' }}>
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
                  <span style={{ fontFamily: 'var(--font-pixel)', fontSize: 13, color: s.color }}>{s.pct}</span>
                  <span style={{ fontSize: 12, fontFamily: 'var(--font-pixel)', color: 'var(--color-text-dim)' }}>{s.label}</span>
                </div>
              ))}
            </div>
          </div>

          <div style={infoBlock}>
            <div style={{ fontFamily: 'var(--font-pixel)', fontSize: 12, color: 'var(--color-orange)', marginBottom: 4 }}>
              PRIZE DISTRIBUTION
            </div>
            <div style={{ fontSize: 13, color: 'var(--color-text-dim)', marginBottom: 8 }}>
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
                  <span style={{ fontFamily: 'var(--font-pixel)', fontSize: 13, color: 'var(--color-green)' }}>{p.pct}</span>
                  <span style={{ fontSize: 12, fontFamily: 'var(--font-pixel)', color: 'var(--color-text-dim)' }}>{p.label}</span>
                </div>
              ))}
            </div>
            <div style={{ fontSize: 13, color: 'var(--color-text-dim)', marginTop: 8 }}>
              If fewer than 3 players enter, the split adjusts automatically. Unclaimed pools roll over to the next period.
            </div>
            <div style={{ fontSize: 13, color: 'var(--color-text-dim)', marginTop: 8 }}>
              Your score is locked to whichever tournament is active when you finish playing. If a period ends mid-game, your score automatically counts toward the next tournament. Unplayed turns and fees carry over.
            </div>
          </div>

          <div style={infoBlock}>
            <div style={{ fontFamily: 'var(--font-pixel)', fontSize: 12, color: 'var(--color-orange)', marginBottom: 4 }}>
              PENDING POOL
            </div>
            <div style={{ fontSize: 13, color: 'var(--color-text-dim)', marginBottom: 8 }}>
              Entry fees don't go straight into the prize pool. They sit in a visible "Pending Pool" until you actually play.
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {[
                { icon: '⏳', text: 'When you buy turns, your fee enters the Pending Pool — visible to everyone.' },
                { icon: '🎮', text: 'Each time you play, that turn\'s share moves from Pending into the prize pool.' },
                { icon: '🔄', text: 'Unplayed turns roll forward automatically. Your money stays in the Pending Pool until you play.' },
              ].map(r => (
                <div key={r.text} style={{
                  display: 'flex', alignItems: 'flex-start', gap: 8,
                  padding: '4px 10px', borderRadius: 3,
                  background: 'var(--color-bg)', border: '1px solid var(--color-border)',
                }}>
                  <span style={{ fontSize: 12, flexShrink: 0 }}>{r.icon}</span>
                  <span style={{ fontSize: 12, fontFamily: 'var(--font-pixel)', color: 'var(--color-text-dim)' }}>{r.text}</span>
                </div>
              ))}
            </div>
          </div>

          <div style={infoBlock}>
            <div style={{ fontFamily: 'var(--font-pixel)', fontSize: 12, color: 'var(--color-orange)', marginBottom: 4 }}>
              SPONSOR BONUSES
            </div>
            <div style={{ fontSize: 13, color: 'var(--color-text-dim)' }}>
              Sponsors can donate bonus tokens into any tournament period. These bonuses are added on top of the regular prize pool and awarded to the 1st place winner.
            </div>
          </div>

          <div style={infoBlock}>
            <div style={{ fontFamily: 'var(--font-pixel)', fontSize: 12, color: 'var(--color-orange)', marginBottom: 4 }}>
              TURNS & ROLLOVER
            </div>
            <div style={{ fontSize: 13, color: 'var(--color-text-dim)' }}>
              Each entry fee purchase gives you play turns. Use them whenever you want during the tournament period.
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
              {[
                { icon: '🎮', text: 'Each entry fee = 1 play turn' },
                { icon: '🔄', text: 'Buy more turns anytime to stack on top of remaining' },
                { icon: '🔁', text: 'Unplayed turns automatically roll to the next period' },
                { icon: '📅', text: 'Turns carry over — if you don\'t play, your entry rolls to the next period automatically' },
              ].map(r => (
                <div key={r.text} style={{
                  display: 'flex', alignItems: 'flex-start', gap: 8,
                  padding: '4px 10px', borderRadius: 3,
                  background: 'var(--color-bg)', border: '1px solid var(--color-border)',
                }}>
                  <span style={{ fontSize: 12, flexShrink: 0 }}>{r.icon}</span>
                  <span style={{ fontSize: 12, fontFamily: 'var(--font-pixel)', color: 'var(--color-text-dim)' }}>{r.text}</span>
                </div>
              ))}
            </div>
          </div>
          </div>}
        </section>

        {/* Scoring */}
        <section className="card" style={{ display: 'flex', flexDirection: 'column', gap: 0, overflow: 'hidden' }}>
          {guideHeader('scoring', '🎯', 'SCORING SYSTEM', 'var(--color-blue)')}
          {openGuide === 'scoring' && <div style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>

          <div style={infoBlock}>
            <div style={{ fontFamily: 'var(--font-pixel)', fontSize: 12, color: 'var(--color-orange)', marginBottom: 4 }}>
              BASE FORMULA
            </div>
            <div style={{ color: 'var(--color-green)', fontFamily: 'var(--font-mono)' }}>
              Score = basePoints × waveClearBonus
            </div>
            <div style={{ fontSize: 13, color: 'var(--color-text-dim)', marginTop: 4 }}>
              Each enemy tier has different base points. Clear waves quickly to earn a bonus multiplier on the next wave.
            </div>
          </div>

          <div style={infoBlock}>
            <div style={{ fontFamily: 'var(--font-pixel)', fontSize: 12, color: 'var(--color-orange)', marginBottom: 4 }}>
              WAVE CLEAR BONUS
            </div>
            <div style={{ color: 'var(--color-green)', fontFamily: 'var(--font-mono)' }}>
              5x multiplier for ~10 seconds after clearing a wave
            </div>
            <div style={{ fontSize: 13, color: 'var(--color-text-dim)', marginTop: 4 }}>
              Clear all enemies in a wave quickly, then kill the next wave's enemies during the bonus window for massive points.
            </div>
          </div>

          <div style={infoBlock}>
            <div style={{ fontFamily: 'var(--font-pixel)', fontSize: 12, color: 'var(--color-orange)', marginBottom: 4 }}>
              REFLECTION BONUS
            </div>
            <div style={{ color: 'var(--color-green)', fontFamily: 'var(--font-mono)' }}>
              +1% of your current score every 25 kills
            </div>
            <div style={{ fontSize: 13, color: 'var(--color-text-dim)', marginTop: 4 }}>
              The higher your score, the bigger the bonus. Keep your kill streak going!
            </div>
          </div>
          </div>}
        </section>
      </div>

      {/* Footer */}
      <footer style={{
        marginTop: 'auto',
        padding: '16px 0 4px',
        borderTop: '1px solid var(--color-border)',
        fontFamily: 'var(--font-pixel)',
        fontSize: 7,
        color: 'var(--color-text-dim)',
        display: 'flex',
        justifyContent: 'space-between',
      }}>
        <span>BITMOON'ING © 2026</span>
        <span
          style={{ cursor: 'pointer', opacity: 0.4 }}
          onClick={() => navigate('admin')}
          title="Admin Panel"
        >
          ADMIN
        </span>
      </footer>
    </div>
  );
}
