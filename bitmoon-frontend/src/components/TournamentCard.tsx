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
  /** Connected player's rank in this tournament, if entered. */
  playerRank?: number | null;
}

export function TournamentCard({ info, navigate, playerRank }: Props) {
  const color        = TYPE_COLORS[info.tournamentType];
  const prizeDisplay = formatTokens(info.prizePool);
  const carryoverAmt = BigInt(info.carryover || '0');
  const basePool     = BigInt(info.prizePool) - carryoverAmt;
  const baseDisplay  = formatTokens(basePool.toString());
  const feeDisplay   = formatTokens(info.entryFee);

  const endBlock = info.endsAtBlock;

  // Prize split: 1st 70 % · 2nd 20 % · 3rd 10 %
  const pool   = BigInt(info.prizePool);
  const prize1 = formatTokens((pool * 70n / 100n).toString());
  const prize2 = formatTokens((pool * 20n / 100n).toString());
  const prize3 = formatTokens((pool * 10n / 100n).toString());

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
        <span style={{ marginLeft: 'auto', fontFamily: 'var(--font-pixel)', fontSize: 9 }}>
          {info.isActive
            ? <span style={{ color: 'var(--color-green)' }}>● LIVE</span>
            : <span style={{ color: '#ffd700' }}>🏆 DISTRIBUTING</span>
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
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
          <span className="pixel" style={{ fontSize: 15, color: 'var(--color-orange)' }}>
            {carryoverAmt > 0n ? baseDisplay : prizeDisplay}
          </span>
          {BigInt(info.carryover || '0') > 0n && (
            <span style={{ fontSize: 9, fontFamily: 'var(--font-pixel)', color: 'var(--color-green)' }}>
              +{formatTokens(info.carryover)} carryover
            </span>
          )}
        </div>
        <div style={{ fontSize: 9, color: 'var(--color-text-dim)', marginTop: 2 }}>LFGT</div>
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

      {/* Stats: Players & Entry Fee on one line */}
      <div style={{ fontSize: 9, fontFamily: 'var(--font-pixel)', color: 'var(--color-text-dim)' }}>
        <div style={{ marginBottom: 4 }}>
          <span style={{ color: 'var(--color-text)' }}>{info.entrantCount}</span> PLAYS · <span style={{ color: 'var(--color-text)' }}>{feeDisplay}</span> LFGT ENTRY FEE
        </div>
        <div>
          TOURNAMENT END BLOCK <span style={{ color: 'var(--color-text)' }}>{Number(endBlock).toLocaleString()}</span>
        </div>
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

      {/* Next round notice when in gap */}
      {!info.isActive && (
        <div style={{
          textAlign: 'center',
          fontFamily: 'var(--font-pixel)',
          fontSize: 8,
          color: '#ffd700',
          padding: '6px 0',
        }}>
          NEXT ROUND AT BLOCK {Number(info.nextStartBlock).toLocaleString()}
        </div>
      )}

      {/* Enter button */}
      <div style={{ marginTop: 'auto' }}>
        <button
          className="btn btn-solid-orange"
          style={{ width: '100%', fontSize: 8, opacity: info.isActive ? 1 : 0.4 }}
          onClick={() => navigate('tournament-entry', { tournamentType: info.tournamentType })}
          disabled={!info.isActive}
        >
          {info.isActive ? 'ENTER' : 'WAITING…'}
        </button>
      </div>
    </div>
  );
}
