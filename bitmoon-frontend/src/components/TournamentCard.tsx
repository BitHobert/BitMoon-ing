import type { TournamentInfo, TournamentType } from '../types';
import type { NavigateFn } from '../App';

const TYPE_LABELS: Record<TournamentType, string> = {
  daily:   'DAILY',
  weekly:  'WEEKLY',
  monthly: 'MONTHLY',
};

const TYPE_COLORS: Record<TournamentType, string> = {
  daily:   'var(--color-blue)',
  weekly:  'var(--color-orange)',
  monthly: '#b975ff',
};

function formatTokens(raw: string, decimals = 8): string {
  const n = BigInt(raw);
  const divisor = BigInt(10 ** decimals);
  const whole = n / divisor;
  const frac  = n % divisor;
  if (frac === 0n) return whole.toLocaleString();
  const fracStr = frac.toString().padStart(decimals, '0').replace(/0+$/, '');
  return `${whole.toLocaleString()}.${fracStr}`;
}

interface Props {
  info: TournamentInfo;
  navigate: NavigateFn;
  currentBlock?: bigint;
}

export function TournamentCard({ info, navigate, currentBlock }: Props) {
  const color = TYPE_COLORS[info.tournamentType];
  const prizeDisplay = formatTokens(info.prizePool);
  const feeDisplay   = formatTokens(info.entryFee);

  const blocksLeft = currentBlock !== undefined
    ? Math.max(0, Number(BigInt(info.endsAtBlock) - currentBlock))
    : null;

  return (
    <div className="card" style={{
      borderColor: color,
      boxShadow: `0 0 16px ${color}22`,
      flex: 1,
      minWidth: 220,
      display: 'flex',
      flexDirection: 'column',
      gap: 12,
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span className="pixel" style={{ fontSize: 11, color }}>{TYPE_LABELS[info.tournamentType]}</span>
        {info.isActive
          ? <span style={{ fontSize: 9, color: 'var(--color-green)', fontFamily: 'var(--font-pixel)' }}>● LIVE</span>
          : <span style={{ fontSize: 9, color: 'var(--color-text-dim)', fontFamily: 'var(--font-pixel)' }}>INACTIVE</span>
        }
      </div>

      {/* Prize pool */}
      <div>
        <div style={{ fontSize: 9, color: 'var(--color-text-dim)', marginBottom: 4, fontFamily: 'var(--font-pixel)' }}>PRIZE POOL</div>
        <div className="pixel" style={{ fontSize: 15, color: 'var(--color-orange)' }}>
          {prizeDisplay}
        </div>
        <div style={{ fontSize: 9, color: 'var(--color-text-dim)', marginTop: 2 }}>BITMOON</div>
      </div>

      {/* Stats row */}
      <div style={{ display: 'flex', gap: 16, fontSize: 9, color: 'var(--color-text-dim)', fontFamily: 'var(--font-pixel)' }}>
        <div>
          <div style={{ color: 'var(--color-text)', marginBottom: 2 }}>{info.entrantCount}</div>
          <div>PLAYERS</div>
        </div>
        <div>
          <div style={{ color: 'var(--color-text)', marginBottom: 2 }}>{feeDisplay}</div>
          <div>ENTRY FEE</div>
        </div>
        {blocksLeft !== null && (
          <div>
            <div style={{ color: 'var(--color-text)', marginBottom: 2 }}>{blocksLeft}</div>
            <div>BLOCKS LEFT</div>
          </div>
        )}
      </div>

      {/* Buttons */}
      <div style={{ display: 'flex', gap: 8, marginTop: 'auto' }}>
        <button
          className="btn btn-blue"
          style={{ flex: 1, fontSize: 8 }}
          onClick={() => navigate('game', {})}
        >
          PLAY FREE
        </button>
        <button
          className="btn btn-solid-orange"
          style={{ flex: 1, fontSize: 8 }}
          onClick={() => navigate('tournament-entry', { tournamentType: info.tournamentType })}
        >
          ENTER
        </button>
      </div>
    </div>
  );
}
