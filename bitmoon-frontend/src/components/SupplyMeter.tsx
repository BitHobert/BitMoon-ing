import { useWsContext, INITIAL_SUPPLY } from '../context/WsContext';

function formatSupply(raw: string): string {
  // raw units have 8 decimals: 1 token = 100_000_000 raw units
  const n = BigInt(raw);
  const whole = n / 100_000_000n;
  if (whole >= 1_000_000n) return `${(Number(whole) / 1_000_000).toFixed(2)}M`;
  if (whole >= 1_000n)     return `${(Number(whole) / 1_000).toFixed(1)}K`;
  return whole.toString();
}

export function SupplyMeter() {
  const { supply } = useWsContext();

  const currentRaw  = supply ? BigInt(supply.currentSupply) : INITIAL_SUPPLY;
  const pct         = Number((currentRaw * 10000n) / INITIAL_SUPPLY) / 100;
  const multiplier  = supply?.scarcityMultiplier ?? 1;

  const barColor =
    pct > 50 ? 'var(--color-green)' :
    pct > 20 ? 'var(--color-orange)' :
               'var(--color-red)';

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <div style={{ fontFamily: 'var(--font-pixel)', fontSize: 8, color: 'var(--color-text-dim)', whiteSpace: 'nowrap' }}>
        SUPPLY
      </div>
      <div style={{
        position: 'relative',
        width: 140,
        height: 10,
        background: 'var(--color-bg)',
        border: '1px solid var(--color-border)',
        borderRadius: 2,
        overflow: 'hidden',
      }}>
        <div style={{
          position: 'absolute',
          left: 0, top: 0, bottom: 0,
          width: `${pct}%`,
          background: barColor,
          boxShadow: `0 0 6px ${barColor}`,
          transition: 'width 1s ease',
        }} />
      </div>
      <div style={{
        fontFamily: 'var(--font-pixel)',
        fontSize: 8,
        color: barColor,
        minWidth: 60,
        textAlign: 'right',
      }}>
        {supply ? formatSupply(supply.currentSupply) : '—'}
      </div>
      <div style={{
        fontFamily: 'var(--font-pixel)',
        fontSize: 8,
        color: 'var(--color-blue)',
        whiteSpace: 'nowrap',
      }}>
        {multiplier.toFixed(2)}×
      </div>
    </div>
  );
}
