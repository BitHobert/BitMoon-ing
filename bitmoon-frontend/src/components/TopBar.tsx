import type { NavigateFn, PageName } from '../App';
import { WalletButton } from './WalletButton';
import { useBlockHeight } from '../hooks/useBlockHeight';
import { useWsContext } from '../context/WsContext';

interface Props {
  navigate: NavigateFn;
  currentPage: PageName;
}

export function TopBar({ navigate }: Props) {
  const blockHeight = useBlockHeight();
  const { supply } = useWsContext();

  return (
    <header
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 50,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '10px 20px',
        borderBottom: '1px solid var(--color-border)',
        background: 'rgba(17, 17, 24, 0.95)',
        backdropFilter: 'blur(8px)',
        gap: 12,
        flexWrap: 'wrap',
      }}
    >
      {/* Left: Title */}
      <div
        className="pixel glow-orange"
        style={{ fontSize: 12, letterSpacing: 2, cursor: 'pointer', whiteSpace: 'nowrap' }}
        onClick={() => navigate('home')}
      >
        BITMOON'ING
      </div>

      {/* Center: Block tracker */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {blockHeight && (
          <div
            className="pixel glow-orange"
            style={{
              fontSize: 10,
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              whiteSpace: 'nowrap',
            }}
          >
            <span style={{ color: 'var(--color-green)', fontSize: 8 }}>●</span>
            BLOCK{' '}
            <span style={{ color: 'var(--color-orange)' }}>
              {Number(blockHeight).toLocaleString()}
            </span>
          </div>
        )}

        {/* WebSocket connection indicator */}
        <span
          className="pixel"
          style={{
            fontSize: 8,
            color: supply ? 'var(--color-green)' : 'var(--color-red)',
          }}
        >
          {supply ? '● LIVE' : '○'}
        </span>
      </div>

      {/* Right: Wallet */}
      <WalletButton />
    </header>
  );
}
