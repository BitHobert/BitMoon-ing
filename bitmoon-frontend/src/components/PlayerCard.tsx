import { useState, useEffect } from 'react';
import { getPlayer } from '../api/http';
import type { PlayerStats, BadgeLevel } from '../types';
import { ApiError } from '../api/http';

const BADGE_LABELS: Record<BadgeLevel, string> = {
  bronze:  'BRONZE',
  silver:  'SILVER',
  gold:    'GOLD',
  diamond: 'DIAMOND',
  lunar:   'LUNAR',
};

const BADGE_COLORS: Record<BadgeLevel, string> = {
  bronze:  '#cd7f32',
  silver:  '#c0c0c0',
  gold:    '#ffd700',
  diamond: 'var(--color-blue)',
  lunar:   'var(--color-orange)',
};

interface Props {
  address: string;
}

export function PlayerCard({ address }: Props) {
  const [stats, setStats] = useState<PlayerStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getPlayer(address).then((s) => {
      if (!cancelled) { setStats(s); setLoading(false); }
    }).catch((err) => {
      if (!cancelled) {
        // 404 = new player, that's fine
        if (!(err instanceof ApiError && err.status === 404)) {
          console.error('getPlayer failed:', err);
        }
        setStats(null);
        setLoading(false);
      }
    });
    return () => { cancelled = true; };
  }, [address]);

  if (loading) {
    return (
      <div className="card" style={{ flex: '0 0 240px', textAlign: 'center', padding: 24 }}>
        <div style={{ fontFamily: 'var(--font-pixel)', fontSize: 9, color: 'var(--color-text-dim)' }}>LOADING…</div>
      </div>
    );
  }

  if (!stats) {
    return (
      <div className="card" style={{ flex: '0 0 240px', textAlign: 'center', padding: 24 }}>
        <div style={{ fontFamily: 'var(--font-pixel)', fontSize: 9, color: 'var(--color-text-dim)', lineHeight: 2 }}>
          NEW PLAYER<br />PLAY TO EARN<br />YOUR BADGE
        </div>
      </div>
    );
  }

  const badgeColor = BADGE_COLORS[stats.badge];

  return (
    <div className="card" style={{ flex: '0 0 240px', display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* Badge */}
      <div style={{ textAlign: 'center' }}>
        <div style={{
          fontFamily: 'var(--font-pixel)',
          fontSize: 13,
          color: badgeColor,
          textShadow: `0 0 10px ${badgeColor}`,
          marginBottom: 4,
        }}>
          {BADGE_LABELS[stats.badge]}
        </div>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--color-text-dim)' }}>
          {`${address.slice(0, 8)}…${address.slice(-6)}`}
        </div>
      </div>

      {/* Stats grid */}
      {([
        ['BEST SCORE',  stats.allTimeBest.toLocaleString()],
        ['TOTAL KILLS', stats.totalKills.toLocaleString()],
        ['WAVES',       stats.wavesCleared.toLocaleString()],
        ['GAMES',       stats.gamesPlayed.toLocaleString()],
      ] as [string, string][]).map(([label, value]) => (
        <div key={label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <span style={{ fontFamily: 'var(--font-pixel)', fontSize: 8, color: 'var(--color-text-dim)' }}>{label}</span>
          <span style={{ fontFamily: 'var(--font-pixel)', fontSize: 10, color: 'var(--color-orange)' }}>{value}</span>
        </div>
      ))}
    </div>
  );
}
