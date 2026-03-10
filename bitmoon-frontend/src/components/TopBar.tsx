import type { NavigateFn, PageName } from '../App';
import { WalletButton } from './WalletButton';
import { useBlockHeight } from '../hooks/useBlockHeight';
import { useWsContext } from '../context/WsContext';
import { useWalletContext } from '../context/WalletContext';
import { NETWORK } from '../config/network';

interface Props {
  navigate: NavigateFn;
  currentPage: PageName;
}

export function TopBar({ navigate }: Props) {
  const blockHeight = useBlockHeight();
  const { supply } = useWsContext();
  const { networkMismatch, connected } = useWalletContext();

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

      {/* Center: Network badge + Block tracker */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span
          className="pixel"
          style={{
            fontSize: 7,
            padding: '2px 6px',
            borderRadius: 3,
            border: `1px solid ${NETWORK.color}`,
            color: NETWORK.color,
            background: `${NETWORK.color}11`,
            letterSpacing: 1,
          }}
        >
          {NETWORK.badge}
        </span>
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

      {/* Network mismatch warning */}
      {connected && networkMismatch && (
        <div
          className="pixel"
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            right: 0,
            padding: '4px 20px',
            fontSize: 8,
            textAlign: 'center',
            background: 'rgba(255, 60, 60, 0.9)',
            color: '#fff',
            zIndex: 51,
          }}
        >
          WALLET IS ON WRONG NETWORK — SWITCH TO {NETWORK.label.toUpperCase()} IN YOUR WALLET
        </div>
      )}
    </header>
  );
}
