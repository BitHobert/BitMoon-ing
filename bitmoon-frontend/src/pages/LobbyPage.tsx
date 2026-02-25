import { useState, useEffect } from 'react';
import type { NavigateFn } from '../App';
import { getTournaments } from '../api/http';
import type { TournamentInfo } from '../types';
import { WalletButton } from '../components/WalletButton';
import { SupplyMeter } from '../components/SupplyMeter';
import { TournamentCard } from '../components/TournamentCard';
import { LeaderboardTable } from '../components/LeaderboardTable';
import { PlayerCard } from '../components/PlayerCard';
import { PastWinnersModal } from '../components/PastWinnersModal';
import { useWalletContext } from '../context/WalletContext';
import { useWsContext } from '../context/WsContext';

interface Props { navigate: NavigateFn; }

export function LobbyPage({ navigate }: Props) {
  const { address } = useWalletContext();
  const { supply }  = useWsContext();
  const [tournaments,  setTournaments]  = useState<TournamentInfo[]>([]);
  const [showWinners,  setShowWinners]  = useState(false);

  useEffect(() => {
    getTournaments()
      .then((r) => setTournaments(r.tournaments))
      .catch(console.error);
  }, []);

  // Use supply sequenceNumber as rough block proxy for display only
  const currentBlock = supply ? BigInt(supply.sequenceNumber) : undefined;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', background: 'var(--color-bg)' }}>

      {/* Header */}
      <header style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '14px 24px',
        borderBottom: '1px solid var(--color-border)',
        background: 'var(--color-bg-card)',
        gap: 16,
        flexWrap: 'wrap',
      }}>
        <div className="pixel glow-orange" style={{ fontSize: 14, letterSpacing: 2 }}>
          ₿ITMOON
        </div>
        <SupplyMeter />
        <WalletButton />
      </header>

      {/* Main */}
      <main style={{ flex: 1, padding: '24px', display: 'flex', flexDirection: 'column', gap: 24, maxWidth: 1200, margin: '0 auto', width: '100%' }}>

        {/* Hero */}
        <div style={{ textAlign: 'center', padding: '16px 0' }}>
          <h1 className="pixel glow-orange" style={{ fontSize: 18, marginBottom: 8 }}>
            SHOOT TO EARN
          </h1>
          <p style={{ color: 'var(--color-text-dim)', fontFamily: 'var(--font-mono)', fontSize: 12 }}>
            Kill enemies · burn supply · climb the leaderboard · win OP-20 prizes
          </p>
          <button
            className="btn btn-solid-orange"
            style={{ marginTop: 16, fontSize: 11, padding: '12px 28px' }}
            onClick={() => navigate('game', {})}
          >
            ▶ PLAY NOW (FREE)
          </button>
        </div>

        {/* Tournament cards */}
        {tournaments.length > 0 && (
          <section>
            <h2 className="pixel" style={{ fontSize: 10, color: 'var(--color-text-dim)', marginBottom: 12 }}>
              ACTIVE TOURNAMENTS
            </h2>
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
              {tournaments.map((t) => (
                <TournamentCard
                  key={t.tournamentType}
                  info={t}
                  navigate={navigate}
                  currentBlock={currentBlock}
                />
              ))}
            </div>
          </section>
        )}

        {/* Leaderboard + player stats */}
        <section style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-start' }}>
          <div style={{ flex: 1, minWidth: 280 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
              <span className="pixel" style={{ fontSize: 9, color: 'var(--color-text-dim)' }}>
                LEADERBOARD
              </span>
              <button
                className="btn btn-blue"
                style={{ fontSize: 7, padding: '4px 10px' }}
                onClick={() => setShowWinners(true)}
              >
                🏆 PAST WINNERS
              </button>
            </div>
            <LeaderboardTable />
          </div>
          {address && <PlayerCard address={address} />}
        </section>

      </main>

      {/* Past Winners Modal */}
      {showWinners && <PastWinnersModal onClose={() => setShowWinners(false)} />}

      {/* Footer */}
      <footer style={{
        padding: '10px 24px',
        borderTop: '1px solid var(--color-border)',
        fontFamily: 'var(--font-pixel)',
        fontSize: 8,
        color: 'var(--color-text-dim)',
        display: 'flex',
        justifyContent: 'space-between',
      }}>
        <span>BITMOON © 2026</span>
        <span style={{ color: supply ? 'var(--color-green)' : 'var(--color-red)' }}>
          {supply ? '● LIVE' : '○ CONNECTING…'}
        </span>
      </footer>
    </div>
  );
}
