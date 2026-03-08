import { useState, useEffect } from 'react';
import type { NavigateFn, PageContext } from '../App';
import { getTournaments, getTournamentLeaderboard, getTournamentWinners } from '../api/http';
import type { TournamentInfo, TournamentType, LeaderboardEntry, PrizeDistribution } from '../types';
import { useWalletContext } from '../context/WalletContext';
import { useBlockHeight } from '../hooks/useBlockHeight';
// ── Shared constants ──────────────────────────────────────────────────────────

const TYPE_LABELS: Record<TournamentType, string> = {
  daily: 'DAILY', weekly: 'WEEKLY', monthly: 'MONTHLY',
};
const TYPE_COLORS: Record<TournamentType, string> = {
  daily: 'var(--color-blue)', weekly: 'var(--color-orange)', monthly: '#b975ff',
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

function truncate(addr: string) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function shortAddr(addr: string) {
  return addr.length > 14 ? `${addr.slice(0, 6)}…${addr.slice(-6)}` : addr;
}

const WINNER_LIMITS: Record<TournamentType, number> = {
  daily: 30, weekly: 20, monthly: 10,
};

const PLACE_LABELS = ['🥇 1ST', '🥈 2ND', '🥉 3RD'];
const PLACE_COLORS = ['#ffd700', '#c0c0c0', '#cd7f32'];

// ── Component ─────────────────────────────────────────────────────────────────

interface Props { navigate: NavigateFn; ctx: PageContext; }

export function TournamentDetailPage({ navigate, ctx }: Props) {
  const tournamentType = ctx.tournamentType ?? 'daily';
  const { address } = useWalletContext();
  const blockHeight = useBlockHeight();
  const color = TYPE_COLORS[tournamentType];

  const [info, setInfo] = useState<TournamentInfo | null>(null);
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [pastWinners, setPastWinners] = useState<PrizeDistribution[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      getTournaments(),
      getTournamentLeaderboard(tournamentType, 50),
      getTournamentWinners(tournamentType, WINNER_LIMITS[tournamentType]),
    ])
      .then(([tournamentsRes, lbRes, winnersRes]) => {
        const t = tournamentsRes.tournaments.find(
          (t) => t.tournamentType === tournamentType,
        );
        if (t) setInfo(t);
        setEntries(lbRes.entries);
        setPastWinners(winnersRes.distributions ?? (winnersRes.distribution ? [winnersRes.distribution] : []));
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [tournamentType]);

  if (loading) {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        minHeight: 'calc(100vh - 60px)', position: 'relative', zIndex: 1,
      }}>
        <div className="pixel glow-orange" style={{ fontSize: 12 }}>LOADING…</div>
      </div>
    );
  }

  if (!info) {
    return (
      <div style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        justifyContent: 'center', minHeight: 'calc(100vh - 60px)',
        position: 'relative', zIndex: 1, gap: 16,
      }}>
        <div className="pixel" style={{ fontSize: 10, color: 'var(--color-text-dim)' }}>
          TOURNAMENT NOT FOUND
        </div>
        <button className="btn btn-orange" onClick={() => navigate('home')}>← HOME</button>
      </div>
    );
  }

  // Prize calculations
  const pool = BigInt(info.prizePool);
  const carryoverAmt = BigInt(info.carryover || '0');
  const basePool = pool - carryoverAmt;
  const prize1 = formatTokens((pool * 70n / 100n).toString());
  const prize2 = formatTokens((pool * 20n / 100n).toString());
  const prize3 = formatTokens((pool * 10n / 100n).toString());
  const feeDisplay = formatTokens(info.entryFee);

  // Blocks remaining
  const blocksRemaining = blockHeight
    ? Math.max(0, Number(info.endsAtBlock) - Number(blockHeight))
    : null;

  return (
    <div style={{
      position: 'relative', zIndex: 1,
      padding: '24px 20px', maxWidth: 900, margin: '0 auto', width: '100%',
      display: 'flex', flexDirection: 'column', gap: 20,
      minHeight: 'calc(100vh - 60px)',
    }}>

      {/* Back button */}
      <button
        className="btn btn-orange"
        style={{ alignSelf: 'flex-start', fontSize: 8, padding: '6px 12px' }}
        onClick={() => navigate('home')}
      >
        ← HOME
      </button>

      {/* Header strip */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
      }}>
        <span
          className="pixel"
          style={{
            fontSize: 16, color, padding: '4px 12px',
            border: `2px solid ${color}`, borderRadius: 4,
          }}
        >
          {TYPE_LABELS[tournamentType]}
        </span>
        <span style={{
          fontFamily: 'var(--font-pixel)', fontSize: 9,
          color: info.isActive ? 'var(--color-green)' : '#ffd700',
        }}>
          {info.isActive ? '● LIVE' : '🏆 DISTRIBUTING'}
        </span>
        {blocksRemaining !== null && info.isActive && (
          <span style={{
            fontFamily: 'var(--font-pixel)', fontSize: 8,
            color: 'var(--color-text-dim)', marginLeft: 'auto',
          }}>
            {blocksRemaining.toLocaleString()} BLOCKS LEFT
          </span>
        )}
      </div>

      {/* Prize pool card */}
      <div className="card" style={{ borderColor: color, boxShadow: `0 0 20px ${color}15` }}>
        <div style={{
          fontFamily: 'var(--font-pixel)', fontSize: 8,
          color: 'var(--color-text-dim)', marginBottom: 8,
        }}>
          PRIZE POOL
        </div>

        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 12 }}>
          <span className="pixel glow-orange" style={{ fontSize: 22 }}>
            {carryoverAmt > 0n ? formatTokens(basePool.toString()) : formatTokens(info.prizePool)}
          </span>
          <span style={{ fontFamily: 'var(--font-pixel)', fontSize: 9, color: 'var(--color-text-dim)' }}>
            LFGT
          </span>
          {carryoverAmt > 0n && (
            <span style={{ fontFamily: 'var(--font-pixel)', fontSize: 8, color: 'var(--color-green)' }}>
              +{formatTokens(info.carryover)} carryover
            </span>
          )}
        </div>

        {/* Sponsor bonuses */}
        {info.sponsorBonuses && info.sponsorBonuses.length > 0 && (() => {
          const bySymbol = new Map<string, bigint>();
          for (const b of info.sponsorBonuses) {
            const sym = b.tokenSymbol || 'BONUS';
            bySymbol.set(sym, (bySymbol.get(sym) ?? 0n) + BigInt(b.amount));
          }
          return (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
              {[...bySymbol.entries()].map(([sym, total]) => (
                <div key={sym} style={{
                  display: 'inline-flex', alignItems: 'center', gap: 4,
                  padding: '4px 10px', borderRadius: 3,
                  background: 'rgba(57,255,20,0.1)', border: '1px solid rgba(57,255,20,0.3)',
                }}>
                  <span style={{ fontSize: 10 }}>⭐</span>
                  <span style={{ fontSize: 8, fontFamily: 'var(--font-pixel)', color: 'var(--color-green)' }}>
                    +{formatTokens(total.toString())} {sym}
                  </span>
                </div>
              ))}
            </div>
          );
        })()}

        {/* Prize breakdown */}
        <div style={{
          display: 'flex', gap: 16, flexWrap: 'wrap',
          padding: '10px 12px', borderRadius: 4,
          background: 'var(--color-bg)',
          fontFamily: 'var(--font-pixel)', fontSize: 9,
        }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 16, marginBottom: 4 }}>🥇</div>
            <div style={{ color: 'var(--color-green)' }}>{prize1}</div>
            <div style={{ color: 'var(--color-text-dim)', fontSize: 7, marginTop: 2 }}>70%</div>
          </div>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 16, marginBottom: 4 }}>🥈</div>
            <div style={{ color: 'var(--color-green)' }}>{prize2}</div>
            <div style={{ color: 'var(--color-text-dim)', fontSize: 7, marginTop: 2 }}>20%</div>
          </div>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 16, marginBottom: 4 }}>🥉</div>
            <div style={{ color: 'var(--color-green)' }}>{prize3}</div>
            <div style={{ color: 'var(--color-text-dim)', fontSize: 7, marginTop: 2 }}>10%</div>
          </div>
        </div>
      </div>

      {/* Stats row */}
      <div style={{
        display: 'flex', gap: 12, flexWrap: 'wrap',
      }}>
        {([
          { label: 'PLAYS', value: info.entrantCount.toString(), color: 'var(--color-blue)' },
          { label: 'ENTRY FEE', value: `${feeDisplay} LFGT`, color: 'var(--color-orange)' },
          { label: 'END BLOCK', value: Number(info.endsAtBlock).toLocaleString(), color: 'var(--color-text)' },
          { label: 'START BLOCK', value: Number(info.startsAtBlock).toLocaleString(), color: 'var(--color-text-dim)' },
        ] as const).map((s) => (
          <div key={s.label} className="card" style={{ flex: '1 1 140px', textAlign: 'center' }}>
            <div style={{ fontFamily: 'var(--font-pixel)', fontSize: 14, color: s.color, marginBottom: 4 }}>
              {s.value}
            </div>
            <div style={{ fontFamily: 'var(--font-pixel)', fontSize: 7, color: 'var(--color-text-dim)' }}>
              {s.label}
            </div>
          </div>
        ))}
      </div>

      {/* Enter button */}
      <button
        className="btn btn-solid-orange"
        style={{
          width: '100%', fontSize: 12, padding: '16px 24px',
          opacity: info.isActive ? 1 : 0.4,
        }}
        onClick={() => navigate('tournament-entry', { tournamentType })}
        disabled={!info.isActive}
      >
        {info.isActive ? `ENTER TOURNAMENT — ${feeDisplay} LFGT` : 'WAITING FOR NEXT ROUND…'}
      </button>

      {/* Next round notice */}
      {!info.isActive && (
        <div style={{
          textAlign: 'center', fontFamily: 'var(--font-pixel)', fontSize: 9, color: '#ffd700',
        }}>
          NEXT ROUND AT BLOCK {Number(info.nextStartBlock).toLocaleString()}
        </div>
      )}

      {/* Leaderboard */}
      <div className="card">
        <div style={{
          fontFamily: 'var(--font-pixel)', fontSize: 9,
          color: 'var(--color-text-dim)', marginBottom: 12,
        }}>
          RANKINGS
        </div>

        {entries.length === 0 ? (
          <div style={{
            fontFamily: 'var(--font-pixel)', fontSize: 9,
            color: 'var(--color-text-dim)', textAlign: 'center', padding: 24,
          }}>
            NO ENTRANTS YET — BE THE FIRST!
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 10 }}>
            <thead>
              <tr style={{ color: 'var(--color-text-dim)', fontFamily: 'var(--font-pixel)', fontSize: 8 }}>
                <th style={{ textAlign: 'left', padding: '4px 8px' }}>#</th>
                <th style={{ textAlign: 'left', padding: '4px 8px' }}>PLAYER</th>
                <th style={{ textAlign: 'right', padding: '4px 8px' }}>SCORE</th>
                <th style={{ textAlign: 'right', padding: '4px 8px' }}>KILLS</th>
                <th style={{ textAlign: 'right', padding: '4px 8px' }}>WAVES</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => {
                const isMe = Boolean(
                  address && e.playerAddress.toLowerCase() === address.toLowerCase(),
                );
                return (
                  <tr
                    key={`${e.playerAddress}-${e.achievedAt}-${e.rank}`}
                    style={{
                      borderTop: '1px solid var(--color-border)',
                      background: isMe ? `${color}18` : 'transparent',
                      color: isMe
                        ? color
                        : e.rank <= 3
                          ? 'var(--color-orange)'
                          : 'var(--color-text)',
                    }}
                  >
                    <td style={{ padding: '6px 8px', fontFamily: 'var(--font-pixel)', fontSize: 9 }}>
                      {e.rank === 1 ? '🥇' : e.rank === 2 ? '🥈' : e.rank === 3 ? '🥉' : `#${e.rank}`}
                    </td>
                    <td style={{ padding: '6px 8px', fontFamily: 'var(--font-mono)', fontSize: 10 }}>
                      {truncate(e.playerAddress)}
                      {isMe && (
                        <span style={{
                          fontFamily: 'var(--font-pixel)', fontSize: 7,
                          marginLeft: 6, color,
                        }}>
                          YOU
                        </span>
                      )}
                    </td>
                    <td style={{ padding: '6px 8px', textAlign: 'right', fontFamily: 'var(--font-pixel)', fontSize: 9 }}>
                      {e.score.toLocaleString()}
                    </td>
                    <td style={{ padding: '6px 8px', textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 9 }}>
                      {e.kills}
                    </td>
                    <td style={{ padding: '6px 8px', textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 9 }}>
                      {e.wavesCleared}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Past Winners */}
      {pastWinners.length > 0 && (
        <div className="card">
          <div style={{
            fontFamily: 'var(--font-pixel)', fontSize: 9,
            color: 'var(--color-text-dim)', marginBottom: 14,
          }}>
            🏆 PAST WINNERS — {TYPE_LABELS[tournamentType]}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {pastWinners.map((dist) => (
              <div key={dist._id} style={{
                padding: '12px 14px', borderRadius: 4,
                background: 'rgba(255,255,255,0.02)',
                border: '1px solid var(--color-border)',
              }}>
                {/* Round meta row */}
                <div style={{
                  display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap',
                  fontFamily: 'var(--font-pixel)', fontSize: 7,
                  color: 'var(--color-text-dim)', marginBottom: 10,
                }}>
                  <span>ROUND: {dist.tournamentKey}</span>
                  <span>POOL: {formatTokens(dist.totalPrize)} LFGT</span>
                  <span>{new Date(dist.distributedAt).toLocaleDateString()}</span>
                </div>

                {/* Winners list */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {dist.winners.map((w) => (
                    <div key={w.place} style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      padding: '8px 10px',
                      background: 'rgba(255,255,255,0.02)',
                      border: `1px solid ${PLACE_COLORS[w.place - 1]}25`,
                      borderRadius: 3,
                      gap: 10,
                    }}>
                      <span style={{
                        fontFamily: 'var(--font-pixel)', fontSize: 8,
                        color: PLACE_COLORS[w.place - 1],
                        whiteSpace: 'nowrap',
                      }}>
                        {PLACE_LABELS[w.place - 1]}
                      </span>
                      <div style={{ flex: 1, textAlign: 'center' }}>
                        <div style={{
                          fontFamily: 'var(--font-mono)', fontSize: 9,
                          color: 'var(--color-text)',
                        }}>
                          {shortAddr(w.address)}
                        </div>
                        {w.score != null && (
                          <div style={{
                            fontFamily: 'var(--font-pixel)', fontSize: 7,
                            color: 'var(--color-text-dim)', marginTop: 2,
                          }}>
                            SCORE: {w.score.toLocaleString()}
                          </div>
                        )}
                      </div>
                      <span style={{
                        fontFamily: 'var(--font-pixel)', fontSize: 8,
                        color: 'var(--color-orange)',
                        whiteSpace: 'nowrap',
                      }}>
                        {formatTokens(w.amount)} LFGT
                      </span>
                    </div>
                  ))}
                </div>

                {/* TX hash */}
                {dist.txHash && (
                  <div style={{
                    marginTop: 8, fontFamily: 'var(--font-pixel)', fontSize: 7,
                    color: 'var(--color-text-dim)', textAlign: 'right',
                  }}>
                    TX: {dist.txHash.slice(0, 10)}…{dist.txHash.slice(-8)}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

    </div>
  );
}
