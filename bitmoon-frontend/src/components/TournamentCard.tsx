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
  /** Connected player's rank in this tournament, if entered. */
  playerRank?: number | null;
}

export function TournamentCard({ info, navigate, currentBlock, playerRank }: Props) {
  const color        = TYPE_COLORS[info.tournamentType];
  const prizeDisplay = formatTokens(info.prizePool);
  const feeDisplay   = formatTokens(info.entryFee);

  const blocksLeft = currentBlock !== undefined
    ? Math.max(0, Number(BigInt(info.endsAtBlock) - currentBlock))
    : null;

  // Prize split: 1st 50 % · 2nd 30 % · 3rd 20 %
  const pool   = BigInt(info.prizePool);
  const prize1 = formatTokens((pool * 50n / 100n).toString());
  const prize2 = formatTokens((pool * 30n / 100n).toString());
  const prize3 = formatTokens((pool * 20n / 100n).toString());

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
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span className="pixel" style={{ fontSize: 11, color }}>{TYPE_LABELS[info.tournamentType]}</span>
        <span style={{ marginLeft: 'auto' }}>
          {info.isActive
            ? <span style={{ fontSize: 9, color: 'var(--color-green)', fontFamily: 'var(--font-pixel)' }}>● LIVE</span>
            : <span style={{ fontSize: 9, color: 'var(--color-text-dim)', fontFamily: 'var(--font-pixel)' }}>INACTIVE</span>
          }
        </span>
        {playerRank != null && (
          <span style={{
            fontSize: 8,
            fontFamily: 'var(--font-pixel)',
            color: '#000',
            background: color,
            padding: '2px 6px',
            borderRadius: 2,
            whiteSpace: 'nowrap',
          }}>
            #{playerRank}
          </span>
        )}
      </div>

      {/* Prize pool */}
      <div>
        <div style={{ fontSize: 9, color: 'var(--color-text-dim)', marginBottom: 4, fontFamily: 'var(--font-pixel)' }}>PRIZE POOL</div>
        <div className="pixel" style={{ fontSize: 15, color: 'var(--color-orange)' }}>
          {prizeDisplay}
        </div>
        <div style={{ fontSize: 9, color: 'var(--color-text-dim)', marginTop: 2 }}>tBTC</div>
        {info.sponsorBonuses && info.sponsorBonuses.length > 0 && (() => {
          // Group bonuses by token symbol and show each separately
          const bySymbol = new Map<string, bigint>();
          for (const b of info.sponsorBonuses) {
            const sym = b.tokenSymbol || 'BONUS';
            bySymbol.set(sym, (bySymbol.get(sym) ?? 0n) + BigInt(b.amount));
          }
          return (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 6 }}>
              {[...bySymbol.entries()].map(([sym, total]) => (
                <div key={sym} style={{
                  display: 'inline-flex', alignItems: 'center', gap: 4,
                  padding: '3px 8px', borderRadius: 3,
                  background: 'rgba(57,255,20,0.1)', border: '1px solid rgba(57,255,20,0.3)',
                }}>
                  <span style={{ fontSize: 10 }}>⭐</span>
                  <span style={{
                    fontSize: 8, fontFamily: 'var(--font-pixel)', color: 'var(--color-green)',
                  }}>
                    +{formatTokens(total.toString())} {sym}
                  </span>
                </div>
              ))}
            </div>
          );
        })()}
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

      {/* Prize breakdown */}
      <div style={{
        display: 'flex', gap: 8,
        fontSize: 8, fontFamily: 'var(--font-pixel)',
        color: 'var(--color-text-dim)',
        background: 'var(--color-bg)',
        borderRadius: 4,
        padding: '6px 8px',
        flexWrap: 'wrap',
      }}>
        <span>🥇 {prize1}</span>
        <span>🥈 {prize2}</span>
        <span>🥉 {prize3}</span>
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
