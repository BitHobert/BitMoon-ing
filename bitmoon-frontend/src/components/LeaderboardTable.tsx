import { useState, useEffect, useCallback } from 'react';
import { getLeaderboard } from '../api/http';
import type { LeaderboardEntry } from '../types';

function truncate(addr: string) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export function LeaderboardTable() {
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getLeaderboard('alltime', 100);
      setEntries(res.entries);
    } catch { setEntries([]); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  return (
    <div className="card" style={{ flex: '1 1 340px' }}>
      {/* Title */}
      <div style={{
        fontFamily: 'var(--font-pixel)', fontSize: 9,
        color: 'var(--color-text-dim)', marginBottom: 12,
      }}>
        FREE PLAY — ALL TIME
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
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={`${e.playerAddress}-${e.achievedAt}-${e.rank}`} style={{
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
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
