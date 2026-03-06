import { useState, useEffect, useCallback } from 'react';
import type { NavigateFn } from '../App';
import { getTournaments, getTournamentLeaderboard } from '../api/http';
import type { TournamentInfo, TournamentType } from '../types';
import { WalletButton } from '../components/WalletButton';
import { TournamentCard } from '../components/TournamentCard';
import { TournamentLeaderboard } from '../components/TournamentLeaderboard';
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
  const [playerRanks,  setPlayerRanks]  = useState<Partial<Record<TournamentType, number | null>>>({});
  const [prizePools,   setPrizePools]   = useState<Partial<Record<TournamentType, string>>>({});
  const [blockHeight,  setBlockHeight]  = useState<string | null>(null);

  useEffect(() => {
    getTournaments()
      .then(async (r) => {
        setTournaments(r.tournaments);
        if (r.currentBlock) setBlockHeight(r.currentBlock);

        // Build prize pool map for TournamentLeaderboard payout display
        const pools: Partial<Record<TournamentType, string>> = {};
        r.tournaments.forEach(t => { pools[t.tournamentType] = t.prizePool; });
        setPrizePools(pools);

        // Fetch tournament leaderboards in parallel to find the player's rank
        if (!address) return;
        const lbs = await Promise.all(
          r.tournaments.map(t =>
            getTournamentLeaderboard(t.tournamentType, 200).catch(() => null)
          )
        );
        const ranks: Partial<Record<TournamentType, number | null>> = {};
        lbs.forEach((lb, i) => {
          if (!lb) return;
          const entry = lb.entries.find(
            e => e.playerAddress.toLowerCase() === address.toLowerCase()
          );
          ranks[r.tournaments[i].tournamentType] = entry?.rank ?? null;
        });
        setPlayerRanks(ranks);
      })
      .catch(console.error);
  }, [address]); // re-run when wallet connects so rank badge appears immediately

  // Poll block height every 30s so the current block display stays fresh
  const refreshBlock = useCallback(() => {
    getTournaments()
      .then((r) => { if (r.currentBlock) setBlockHeight(r.currentBlock); })
      .catch(() => { /* silent */ });
  }, []);

  useEffect(() => {
    const id = setInterval(refreshBlock, 30_000);
    return () => clearInterval(id);
  }, [refreshBlock]);

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
          BITMOON'ING
        </div>
        <button
          className="btn btn-blue"
          style={{ fontSize: 8, padding: '6px 12px' }}
          onClick={() => navigate('guide')}
        >
          📖 GUIDE
        </button>
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
            Kill enemies · climb the leaderboard · win prizes
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
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
              <h2 className="pixel" style={{ fontSize: 10, color: 'var(--color-text-dim)', margin: 0 }}>
                ACTIVE TOURNAMENTS
              </h2>
              {blockHeight && (
                <div style={{
                  fontFamily: 'var(--font-pixel)',
                  fontSize: 9,
                  color: 'var(--color-text-dim)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                }}>
                  <span style={{ color: 'var(--color-green)', fontSize: 8 }}>●</span>
                  CURRENT BLOCK <span style={{ color: 'var(--color-orange)' }}>{Number(blockHeight).toLocaleString()}</span>
                </div>
              )}
            </div>
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
              {tournaments.map((t) => (
                <TournamentCard
                  key={t.tournamentType}
                  info={t}
                  navigate={navigate}
                  playerRank={playerRanks[t.tournamentType]}
                />
              ))}
            </div>
          </section>
        )}

        {/* Tournament rankings */}
        {tournaments.length > 0 && (
          <section style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-start' }}>
            <TournamentLeaderboard prizePools={prizePools} />
          </section>
        )}

        {/* Free play all-time + past winners + player stats */}
        <section style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-start' }}>
          <LeaderboardTable />
          <div style={{ flex: '0 0 240px', display: 'flex', flexDirection: 'column', gap: 16 }}>
            <button
              className="btn btn-blue"
              style={{ width: '100%', fontSize: 8, padding: '8px 12px' }}
              onClick={() => setShowWinners(true)}
            >
              🏆 PAST WINNERS
            </button>
            {address && <PlayerCard address={address} />}
          </div>
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
        <span>BITMOON'ING © 2026</span>
        <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
          <span
            style={{ cursor: 'pointer', opacity: 0.4 }}
            onClick={() => navigate('admin')}
            title="Admin Panel"
          >
            ADMIN
          </span>
          <span style={{ color: supply ? 'var(--color-green)' : 'var(--color-red)' }}>
            {supply ? '● LIVE' : '○ CONNECTING…'}
          </span>
        </div>
      </footer>
    </div>
  );
}
