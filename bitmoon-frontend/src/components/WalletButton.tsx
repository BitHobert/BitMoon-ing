import { useState } from 'react';
import { useWalletContext } from '../context/WalletContext';
import { useAuthContext } from '../context/AuthContext';

function truncate(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function WalletButton() {
  const wallet = useWalletContext();
  const auth   = useAuthContext();
  const [showMenu, setShowMenu] = useState(false);

  const handleConnect = async () => {
    const detected = wallet.detectWallet();
    if (!detected) {
      alert('Please install OP_WALLET or Unisat browser extension.');
      return;
    }
    await wallet.connect();
  };

  const handleDisconnect = () => {
    wallet.disconnect();
    auth.logout();
    setShowMenu(false);
  };

  if (!wallet.connected) {
    return (
      <button
        className="btn btn-orange"
        onClick={handleConnect}
        disabled={wallet.connecting}
      >
        {wallet.connecting ? 'CONNECTING…' : 'CONNECT WALLET'}
      </button>
    );
  }

  return (
    <div style={{ position: 'relative' }}>
      <button
        className="btn btn-blue"
        onClick={() => setShowMenu((v) => !v)}
      >
        {wallet.type === 'opnet' ? '⚡ ' : '₿ '}
        {wallet.address ? truncate(wallet.address) : '—'}
      </button>

      {showMenu && (
        <div style={{
          position: 'absolute',
          top: '110%',
          right: 0,
          background: 'var(--color-bg-card)',
          border: '1px solid var(--color-border)',
          borderRadius: 4,
          padding: '8px 0',
          minWidth: 160,
          zIndex: 100,
        }}>
          <div style={{
            padding: '6px 16px',
            fontSize: 9,
            fontFamily: 'var(--font-pixel)',
            color: 'var(--color-text-dim)',
            borderBottom: '1px solid var(--color-border)',
            marginBottom: 4,
          }}>
            {wallet.type?.toUpperCase()}
          </div>
          <button
            onClick={handleDisconnect}
            style={{
              display: 'block',
              width: '100%',
              padding: '8px 16px',
              background: 'transparent',
              border: 'none',
              color: 'var(--color-red)',
              fontFamily: 'var(--font-pixel)',
              fontSize: 9,
              cursor: 'pointer',
              textAlign: 'left',
            }}
          >
            DISCONNECT
          </button>
        </div>
      )}

      {wallet.error && (
        <p style={{ color: 'var(--color-red)', fontSize: 9, marginTop: 4 }}>
          {wallet.error}
        </p>
      )}
    </div>
  );
}
