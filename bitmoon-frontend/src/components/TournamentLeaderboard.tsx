import { useState, useEffect, useCallback } from 'react';
import { getTournamentLeaderboard } from '../api/http';
import { useWalletContext } from '../context/WalletContext';
import type { LeaderboardEntry, TournamentType } from '../types';

const TYPE_LABELS: Record<TournamentType, string> = {
  daily: 'DAILY', weekly: 'WEEKLY', monthly: 'MONTHLY',
};
const TYPE_COLORS: Record<TournamentType, string> = {
  daily:   'var(--color-blue)',
  weekly:  'var(--color-orange)',
  monthly: '#b975ff',
};
const TYPES: TournamentType[] = ['daily', 'weekly', 'monthly'];

function truncate(addr: string) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function fmtTokens(raw: bigint): string {
  const divisor = BigInt(10 ** 8);
  const whole   = raw / divisor;
  const frac    = raw % divisor;
  if (frac === 0n) return whole.toLocaleString();
  return `${whole.toLocaleString()}.${frac.toString().padStart(8, '0').replace(/0+$/, '')}`;
}

interface Props {
  /** Prize pool per tournament type so we can show calculated payouts. */
  prizePools: Partial<Record<TournamentType, string>>;
}

export function TournamentLeaderboard({ prizePools }: Props) {
  const { address } = useWalletContext();
  const [type,    setType]    = useState<TournamentType>('daily');
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (t: TournamentType) => {
    setLoading(true);
    try {
      const res = await getTournamentLeaderboard(t, 20);
      setEntries(res.entries);
    } catch { setEntries([]); }
    finally  { setLoading(false); }
  }, []);

  useEffect(() => { void load(type); }, [type, load]);

  const color    = TYPE_COLORS[type];
  const prizeRaw = prizePools[type] ?? '0';

  // Prize split: 1st 70 % · 2nd 20 % · 3rd 10 %
  const prizes = (() => {
    try {
      const pool = BigInt(prizeRaw);
      return [pool * 70n / 100n, pool * 20n / 100n, pool * 10n / 100n] as const;
    } catch { return [0n, 0n, 0n] as const; }
  })();

  return (
    <div className="card" style={{ flex: '1 1 340px' }}>

      {/* Title */}
      <div style={{ marginBottom: 12 }}>
        <span className="pixel" style={{ fontSize: 9, color: 'var(--color-text-dim)' }}>
          TOURNAMENT RANKINGS
        </span>
      </div>

      {/* Type tabs */}
      <div style={{
        display: 'flex', gap: 4, marginBottom: 16,
        borderBottom: '1px solid var(--color-border)', paddingBottom: 8,
      }}>
        {TYPES.map((t) => (
          <button
            key={t}
            onClick={() => setType(t)}
            style={{
              fontFamily: 'var(--font-pixel)',
              fontSize: 8,
              padding: '4px 8px',
              background: type === t ? TYPE_COLORS[t] : 'transparent',
              color:      type === t ? '#000' : 'var(--color-text-dim)',
              border:     `1px solid ${type === t ? TYPE_COLORS[t] : 'transparent'}`,
              borderRadius: 2,
              cursor: 'pointer',
              textTransform: 'uppercase',
            }}
          >
            {TYPE_LABELS[t]}
          </button>
        ))}
      </div>

      {/* Prize payout strip */}
      <div style={{
        display: 'flex', gap: 12, alignItems: 'center',
        marginBottom: 12, padding: '6px 8px',
        background: 'var(--color-bg)', borderRadius: 4,
        fontFamily: 'var(--font-pixel)', fontSize: 8,
        color: 'var(--color-text-dim)',
      }}>
        <span>🥇 {fmtTokens(prizes[0])}</span>
        <span>🥈 {fmtTokens(prizes[1])}</span>
        <span>🥉 {fmtTokens(prizes[2])}</span>
        <span style={{ marginLeft: 'auto', color }}>LFGT</span>
      </div>

      {/* Leaderboard table */}
      {loading ? (
        <div style={{
          fontFamily: 'var(--font-pixel)', fontSize: 9,
          color: 'var(--color-text-dim)', textAlign: 'center', padding: 24,
        }}>
          LOADING…
        </div>
      ) : entries.length === 0 ? (
        <div style={{
          fontFamily: 'var(--font-pixel)', fontSize: 9,
          color: 'var(--color-text-dim)', textAlign: 'center', padding: 24,
        }}>
          NO ENTRANTS YET
        </div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 10 }}>
          <thead>
            <tr style={{ color: 'var(--color-text-dim)', fontFamily: 'var(--font-pixel)', fontSize: 8 }}>
              <th style={{ textAlign: 'left',   padding: '4px 8px' }}>#</th>
              <th style={{ textAlign: 'left',   padding: '4px 8px' }}>PLAYER</th>
              <th style={{ textAlign: 'right',  padding: '4px 8px' }}>SCORE</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => {
              const isMe = Boolean(
                address && e.playerAddress.toLowerCase() === address.toLowerCase()
              );
              return (
                <tr
                  key={`${e.playerAddress}-${e.achievedAt}-${e.rank}`}
                  style={{
                    borderTop:  '1px solid var(--color-border)',
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
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
