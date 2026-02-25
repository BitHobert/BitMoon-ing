import { useState, useEffect, useCallback } from 'react';
import { getLeaderboard } from '../api/http';
import type { LeaderboardEntry, LeaderboardPeriod, BadgeLevel } from '../types';

const BADGE_ICONS: Record<BadgeLevel, string> = {
  bronze:  '🥉',
  silver:  '🥈',
  gold:    '🥇',
  diamond: '💎',
  lunar:   '🌕',
};

const PERIODS: LeaderboardPeriod[] = ['daily', 'weekly', 'monthly', 'alltime'];

function truncate(addr: string) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export function LeaderboardTable() {
  const [period, setPeriod]   = useState<LeaderboardPeriod>('daily');
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (p: LeaderboardPeriod) => {
    setLoading(true);
    try {
      const res = await getLeaderboard(p, 10);
      setEntries(res.entries);
    } catch { setEntries([]); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(period); }, [period, load]);

  return (
    <div className="card" style={{ flex: '1 1 340px' }}>
      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 16, borderBottom: '1px solid var(--color-border)', paddingBottom: 8 }}>
        {PERIODS.map((p) => (
          <button
            key={p}
            onClick={() => setPeriod(p)}
            style={{
              fontFamily: 'var(--font-pixel)',
              fontSize: 8,
              padding: '4px 8px',
              background: period === p ? 'var(--color-orange)' : 'transparent',
              color:      period === p ? '#000' : 'var(--color-text-dim)',
              border: `1px solid ${period === p ? 'var(--color-orange)' : 'transparent'}`,
              borderRadius: 2,
              cursor: 'pointer',
              textTransform: 'uppercase',
            }}
          >
            {p}
          </button>
        ))}
      </div>

      {/* Table */}
      {loading ? (
        <div style={{ fontFamily: 'var(--font-pixel)', fontSize: 9, color: 'var(--color-text-dim)', textAlign: 'center', padding: 24 }}>
          LOADING…
        </div>
      ) : entries.length === 0 ? (
        <div style={{ fontFamily: 'var(--font-pixel)', fontSize: 9, color: 'var(--color-text-dim)', textAlign: 'center', padding: 24 }}>
          NO DATA YET
        </div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 10 }}>
          <thead>
            <tr style={{ color: 'var(--color-text-dim)', fontFamily: 'var(--font-pixel)', fontSize: 8 }}>
              <th style={{ textAlign: 'left', padding: '4px 8px' }}>#</th>
              <th style={{ textAlign: 'left', padding: '4px 8px' }}>PLAYER</th>
              <th style={{ textAlign: 'right', padding: '4px 8px' }}>SCORE</th>
              <th style={{ textAlign: 'center', padding: '4px 8px' }}>BADGE</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.playerAddress} style={{
                borderTop: '1px solid var(--color-border)',
                color: e.rank <= 3 ? 'var(--color-orange)' : 'var(--color-text)',
              }}>
                <td style={{ padding: '6px 8px', fontFamily: 'var(--font-pixel)', fontSize: 9 }}>
                  {e.rank === 1 ? '🥇' : e.rank === 2 ? '🥈' : e.rank === 3 ? '🥉' : `#${e.rank}`}
                </td>
                <td style={{ padding: '6px 8px', fontFamily: 'var(--font-mono)', fontSize: 10 }}>
                  {truncate(e.playerAddress)}
                </td>
                <td style={{ padding: '6px 8px', textAlign: 'right', fontFamily: 'var(--font-pixel)', fontSize: 9 }}>
                  {e.score.toLocaleString()}
                </td>
                <td style={{ padding: '6px 8px', textAlign: 'center', fontSize: 14 }}>
                  {BADGE_ICONS[e.badgeLevel]}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
