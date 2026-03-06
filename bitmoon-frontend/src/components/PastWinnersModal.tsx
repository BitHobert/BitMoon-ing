import { useState, useEffect } from 'react';
import { getTournamentWinners } from '../api/http';
import type { PrizeDistribution, TournamentType } from '../types';

const TYPES: TournamentType[] = ['daily', 'weekly', 'monthly'];
const PLACE_LABELS = ['🥇 1ST', '🥈 2ND', '🥉 3RD'];
const PLACE_COLORS = ['#ffd700', '#c0c0c0', '#cd7f32'];

function fmtTokens(raw: string, decimals = 8): string {
  const n = BigInt(raw);
  const divisor = BigInt(10 ** decimals);
  const whole = n / divisor;
  const frac  = n % divisor;
  if (frac === 0n) return whole.toLocaleString();
  const fracStr = frac.toString().padStart(decimals, '0').replace(/0+$/, '');
  return `${whole.toLocaleString()}.${fracStr}`;
}

function shortAddr(addr: string) {
  return addr.length > 14 ? `${addr.slice(0, 6)}…${addr.slice(-6)}` : addr;
}

interface Props {
  onClose: () => void;
}

export function PastWinnersModal({ onClose }: Props) {
  const [tab,    setTab]    = useState<TournamentType>('daily');
  const [data,   setData]   = useState<PrizeDistribution | null>(null);
  const [loading, setLoading] = useState(false);
  const [error,  setError]  = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setData(null);
    setError(null);
    getTournamentWinners(tab)
      .then((r) => setData(r.distribution))
      .catch(() => setError('Could not load winners'))
      .finally(() => setLoading(false));
  }, [tab]);

  return (
    /* Backdrop */
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(0,0,0,0.82)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        backdropFilter: 'blur(2px)',
      }}
    >
      {/* Panel */}
      <div style={{
        background: 'var(--color-bg-card)',
        border: '1px solid var(--color-border)',
        borderRadius: 4,
        padding: '24px',
        minWidth: 340,
        maxWidth: 480,
        width: '100%',
        boxShadow: '0 0 40px rgba(247,147,26,0.15)',
        position: 'relative',
      }}>
        {/* Close */}
        <button
          onClick={onClose}
          style={{
            position: 'absolute', top: 12, right: 14,
            background: 'none', border: 'none', cursor: 'pointer',
            fontFamily: 'var(--font-pixel)', fontSize: 10,
            color: 'var(--color-text-dim)',
          }}
        >
          ✕
        </button>

        {/* Title */}
        <div className="pixel glow-orange" style={{ fontSize: 12, marginBottom: 20 }}>
          PAST WINNERS
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
          {TYPES.map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              style={{
                flex: 1,
                padding: '6px 4px',
                fontFamily: 'var(--font-pixel)',
                fontSize: 8,
                cursor: 'pointer',
                background: tab === t ? 'var(--color-orange)' : 'transparent',
                color:      tab === t ? '#000' : 'var(--color-text-dim)',
                border:     `1px solid ${tab === t ? 'var(--color-orange)' : 'var(--color-border)'}`,
                borderRadius: 2,
                transition: 'all 0.15s',
              }}
            >
              {t.toUpperCase()}
            </button>
          ))}
        </div>

        {/* Content */}
        {loading && (
          <div style={{ textAlign: 'center', padding: '24px 0', fontFamily: 'var(--font-pixel)', fontSize: 8, color: 'var(--color-orange)' }}>
            LOADING…
          </div>
        )}

        {error && (
          <div style={{ textAlign: 'center', padding: '24px 0', fontFamily: 'var(--font-pixel)', fontSize: 8, color: 'var(--color-red)' }}>
            {error}
          </div>
        )}

        {!loading && !error && !data && (
          <div style={{ textAlign: 'center', padding: '24px 0', fontFamily: 'var(--font-pixel)', fontSize: 8, color: 'var(--color-text-dim)' }}>
            NO COMPLETED TOURNAMENTS YET
          </div>
        )}

        {!loading && data && (
          <>
            {/* Meta */}
            <div style={{
              marginBottom: 16, padding: '8px 12px',
              background: 'rgba(255,255,255,0.03)',
              border: '1px solid var(--color-border)',
              borderRadius: 2,
              fontFamily: 'var(--font-pixel)', fontSize: 7,
              color: 'var(--color-text-dim)',
              display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap',
            }}>
              <span>ROUND: {data.tournamentKey}</span>
              <span>PRIZE POOL: {fmtTokens(data.totalPrize)} LFGT</span>
              <span>DATE: {new Date(data.distributedAt).toLocaleDateString()}</span>
            </div>

            {/* Winners */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {data.winners.map((w) => (
                <div key={w.place} style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '10px 14px',
                  background: 'rgba(255,255,255,0.02)',
                  border: `1px solid ${PLACE_COLORS[w.place - 1]}30`,
                  borderRadius: 3,
                  gap: 12,
                }}>
                  <span style={{
                    fontFamily: 'var(--font-pixel)', fontSize: 9,
                    color: PLACE_COLORS[w.place - 1],
                    whiteSpace: 'nowrap',
                  }}>
                    {PLACE_LABELS[w.place - 1]}
                  </span>
                  <div style={{ flex: 1, textAlign: 'center' }}>
                    <div style={{
                      fontFamily: 'var(--font-mono)', fontSize: 10,
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
                    fontFamily: 'var(--font-pixel)', fontSize: 9,
                    color: 'var(--color-orange)',
                    whiteSpace: 'nowrap',
                  }}>
                    {fmtTokens(w.amount)} LFGT
                  </span>
                </div>
              ))}
            </div>

            {/* TX link */}
            <div style={{
              marginTop: 14, fontFamily: 'var(--font-pixel)', fontSize: 7,
              color: 'var(--color-text-dim)', textAlign: 'center',
            }}>
              TX: {data.txHash.slice(0, 10)}…{data.txHash.slice(-8)}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
