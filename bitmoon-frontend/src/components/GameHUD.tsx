import { PLAYER_LIVES } from '../game/constants';

interface Props {
  score:      number;
  wave:       number;
  lives:      number;
  tournamentType?: string;
}

export function GameHUD({ score, wave, lives, tournamentType }: Props) {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '8px 20px',
      background: 'rgba(10,10,30,0.96)',
      borderBottom: '1px solid var(--color-border)',
      gap: 20,
      flexWrap: 'wrap',
    }}>
      {/* Logo */}
      <div className="pixel glow-orange" style={{ fontSize: 12, letterSpacing: 2 }}>
        BITMOON'ING
      </div>

      {/* Stats */}
      <div style={{ display: 'flex', gap: 24, alignItems: 'center', flex: 1, justifyContent: 'center' }}>
        <Stat label="SCORE"  value={score.toLocaleString()} color="var(--color-orange)" />
        <Stat label="WAVE"   value={String(wave).padStart(2, '0')} color="var(--color-blue)" />
        {tournamentType && (
          <Stat label="MODE"   value={tournamentType.toUpperCase()} color="#b975ff" />
        )}
      </div>

      {/* Lives */}
      <div style={{ display: 'flex', gap: 4, fontSize: 18 }}>
        {Array.from({ length: PLAYER_LIVES }).map((_, i) => (
          <span key={i} style={{ opacity: i < lives ? 1 : 0.2, filter: 'drop-shadow(0 0 4px #f7931a)' }}>
            🚀
          </span>
        ))}
      </div>
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
      <div style={{ fontFamily: 'var(--font-pixel)', fontSize: 7, color: 'var(--color-text-dim)', letterSpacing: 1 }}>
        {label}
      </div>
      <div style={{ fontFamily: 'var(--font-pixel)', fontSize: 13, color, textShadow: `0 0 8px ${color}` }}>
        {value}
      </div>
    </div>
  );
}
