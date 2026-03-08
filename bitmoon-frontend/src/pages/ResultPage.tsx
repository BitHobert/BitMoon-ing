import { useEffect, useState } from 'react';
import type { NavigateFn, PageContext } from '../App';
import type { ScoreResult } from '../types';
import { useAuthContext } from '../context/AuthContext';

interface Props { navigate: NavigateFn; ctx: PageContext; }

export function ResultPage({ navigate, ctx }: Props) {
  const auth = useAuthContext();
  const [result, setResult] = useState<ScoreResult | null>(null);

  useEffect(() => {
    const cached = sessionStorage.getItem('lastScoreResult');
    if (cached) {
      try { setResult(JSON.parse(cached) as ScoreResult); } catch { /* ignore */ }
      sessionStorage.removeItem('lastScoreResult');
    }
  }, []);

  const score  = result?.validatedScore ?? 0;
  const kills  = result?.kills          ?? 0;
  const waves  = result?.wavesCleared   ?? 0;
  const turnsRemaining = result?.turnsRemaining ?? 0;
  const tournamentType = result?.tournamentType ?? ctx.tournamentType;

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      minHeight: 'calc(100vh - 60px)', position: 'relative', zIndex: 1, gap: 24, padding: 24,
    }}>
      {/* Header */}
      <div className="pixel glow-orange" style={{ fontSize: 20 }}>GAME OVER</div>

      {/* Score card */}
      <div className="card" style={{ minWidth: 340, maxWidth: 480, width: '100%' }}>
        {result?.isValid === false && (
          <div style={{
            background: 'rgba(231,76,60,0.15)', border: '1px solid var(--color-red)',
            borderRadius: 3, padding: '8px 12px', marginBottom: 16,
            fontFamily: 'var(--font-pixel)', fontSize: 8, color: 'var(--color-red)',
          }}>
            ⚠ {result.rejectionReason ?? 'Score validation failed'}
          </div>
        )}

        {/* Main score */}
        <div style={{ textAlign: 'center', marginBottom: 20 }}>
          <div style={{ fontFamily: 'var(--font-pixel)', fontSize: 9, color: 'var(--color-text-dim)', marginBottom: 6 }}>
            FINAL SCORE
          </div>
          <div className="pixel glow-orange" style={{ fontSize: 26 }}>
            {score.toLocaleString()}
          </div>
        </div>

        {/* Stats */}
        <div style={{ display: 'flex', justifyContent: 'space-around', marginBottom: 20 }}>
          {([
            ['KILLS',  kills.toString()],
            ['WAVES',  waves.toString()],
          ] as [string,string][]).map(([label, val]) => (
            <div key={label} style={{ textAlign: 'center' }}>
              <div style={{ fontFamily: 'var(--font-pixel)', fontSize: 16, color: 'var(--color-blue)' }}>{val}</div>
              <div style={{ fontFamily: 'var(--font-pixel)', fontSize: 8, color: 'var(--color-text-dim)', marginTop: 4 }}>{label}</div>
            </div>
          ))}
        </div>

        {/* Tournament info */}
        {tournamentType && (
          <div style={{
            textAlign: 'center', padding: '8px 0',
            borderTop: '1px solid var(--color-border)',
            fontFamily: 'var(--font-pixel)', fontSize: 9, color: '#b975ff',
          }}>
            {tournamentType.toUpperCase()} TOURNAMENT ENTRY RECORDED
          </div>
        )}
      </div>

      {/* Actions */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', justifyContent: 'center' }}>
        {/* Turn-aware buttons for tournament players */}
        {tournamentType && turnsRemaining > 0 && (
          <button className="btn btn-solid-orange" onClick={() => navigate('game', {
            tournamentType,
          })}>
            PLAY NEXT TURN ({turnsRemaining} LEFT)
          </button>
        )}

        {tournamentType && turnsRemaining <= 0 && (
          <button className="btn btn-solid-orange" onClick={() => navigate('tournament-entry', {
            tournamentType,
          })}>
            BUY MORE TURNS
          </button>
        )}

        {/* Non-tournament guest play */}
        {!tournamentType && (
          <button className="btn btn-solid-orange" onClick={() => navigate('home')}>
            BACK TO HOME
          </button>
        )}

        <button className="btn btn-blue" onClick={() => navigate('home')}>
          LEADERBOARD
        </button>
      </div>

      {/* Wallet prompt for guests */}
      {!auth.token && (
        <p style={{ fontFamily: 'var(--font-pixel)', fontSize: 8, color: 'var(--color-text-dim)', textAlign: 'center', maxWidth: 320, lineHeight: 2 }}>
          Connect your wallet to save your score and join tournaments
        </p>
      )}
    </div>
  );
}
