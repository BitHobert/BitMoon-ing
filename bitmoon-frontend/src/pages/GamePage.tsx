import { useState, useCallback, useEffect, useRef } from 'react';
import type { NavigateFn, PageContext } from '../App';
import type { GameEvent, TierNumber } from '../types';
import { createGameSession, endSession } from '../api/http';
import { useWalletContext } from '../context/WalletContext';
import { useAuthContext } from '../context/AuthContext';
import { GameCanvas } from '../components/GameCanvas';
import { GameHUD } from '../components/GameHUD';
import { PLAYER_LIVES } from '../game/constants';
import type { PlanetConfig, PowerupKind } from '../game/constants';

interface Props { navigate: NavigateFn; ctx: PageContext; }

export function GamePage({ navigate, ctx }: Props) {
  const wallet = useWalletContext();
  const auth   = useAuthContext();

  const [score,         setScore]         = useState(0);
  const [wave,          setWave]          = useState(1);
  const [lives,         setLives]         = useState(PLAYER_LIVES);
  const [loading,       setLoading]       = useState(true);
  const [currentPlanet,  setCurrentPlanet]  = useState<PlanetConfig | null>(null);
  const [weaponFrames,   setWeaponFrames]   = useState(0);
  const [laserFrames,    setLaserFrames]    = useState(0);
  const [shieldCount,    setShieldCount]    = useState(0);

  const handlePowerup = useCallback((_kind: PowerupKind | null, wf: number, lf: number, sc: number) => {
    setWeaponFrames(wf);
    setLaserFrames(lf);
    setShieldCount(sc);
  }, []);

  // Game session refs — set during mount, read when game ends
  const sessionIdRef       = useRef<string | null>(null);
  const tokenRef           = useRef<string | null>(null);
  const turnsRemainingRef  = useRef<number | undefined>(undefined);

  // Guard against React 18 StrictMode double-mount.
  // Without this, createGameSession is called twice in dev mode,
  // consuming 2 turns per game instead of 1.
  const initCalledRef = useRef(false);

  // Create a FRESH game session on mount.
  // Uses the existing auth token from TournamentEntryPage to create a new
  // session on the backend (no re-signing needed). This ensures the session
  // is alive and has the correct tournamentType context.
  useEffect(() => {
    if (initCalledRef.current) return;
    initCalledRef.current = true;

    async function initSession() {
      try {
        if (wallet.connected && wallet.address && auth.token) {
          // Create a fresh game session from the existing auth token
          const resp = await createGameSession(auth.token, ctx.tournamentType);
          sessionIdRef.current = resp.sessionId;
          tokenRef.current = resp.token;
          turnsRemainingRef.current = resp.turnsRemaining;
          console.log('[GamePage] Game session created:', resp.sessionId, 'turnsRemaining:', resp.turnsRemaining);
        } else if (wallet.connected && wallet.address) {
          // No auth token yet — login first (non-tournament / first visit)
          const token = await auth.login(
            wallet.address, wallet.signMessage, wallet.getPublicKey, ctx.tournamentType,
          );
          if (token && auth.sessionId) {
            sessionIdRef.current = auth.sessionId;
            tokenRef.current = token;
          }
        }
        // No wallet: guest play — game runs locally, score not saved
      } catch (err: unknown) {
        console.warn('[GamePage] Session init failed:', err);
        // If this was a tournament session and it failed (e.g. no turns remaining),
        // redirect to entry page instead of silently falling into guest mode.
        if (ctx.tournamentType) {
          navigate('tournament-entry', { tournamentType: ctx.tournamentType });
          return;
        }
      } finally {
        setLoading(false);
      }
    }
    void initSession();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleGameOver = useCallback(async (events: GameEvent[], finalScore: number, burned: bigint) => {
    // Count kills and waves from the events array (works for both guest and auth)
    const kills = events.filter(e => e.type === 'kill').length;
    const wavesCleared = events.filter(e => e.type === 'wave_clear').length;

    const sessionId = sessionIdRef.current;
    const token     = tokenRef.current;
    if (!sessionId || !token) {
      // Guest mode — store client-side stats so ResultPage can display them
      sessionStorage.setItem('lastScoreResult', JSON.stringify({
        isValid: true,
        validatedScore: finalScore,
        kills,
        wavesCleared,
        totalBurned: burned.toString(),
        tournamentType: ctx.tournamentType,
        turnsRemaining: 0,
      }));
      navigate('result', { resultSessionId: undefined, tournamentType: ctx.tournamentType });
      return;
    }
    try {
      const result = await endSession(token, {
        sessionId,
        events,
        clientScore: finalScore,
        clientBurned: burned.toString(),
      });
      // Backend response includes turnsRemaining and tournamentType
      sessionStorage.setItem('lastScoreResult', JSON.stringify(result));
    } catch (err) {
      console.error('endSession failed:', err);
      // Server call failed — fall back to client-side stats
      sessionStorage.setItem('lastScoreResult', JSON.stringify({
        isValid: true,
        validatedScore: finalScore,
        kills,
        wavesCleared,
        totalBurned: burned.toString(),
        tournamentType: ctx.tournamentType,
        turnsRemaining: turnsRemainingRef.current != null
          ? Math.max(0, turnsRemainingRef.current - 1)
          : 0,
      }));
    }
    navigate('result', { resultSessionId: sessionId, tournamentType: ctx.tournamentType });
  }, [navigate]);

  const handleKill = useCallback((_tier: TierNumber, _pts: number) => {
    // Kill feed will be emitted via WebSocket from the backend when session ends;
    // for now just track locally via score callback
  }, []);

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh' }}>
        <p className="pixel" style={{ color: 'var(--color-orange)', fontSize: 10 }}>LOADING…</p>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: 'var(--color-bg)', overflow: 'hidden' }}>
      {/* HUD */}
      <GameHUD
        score={score}
        wave={wave}
        lives={lives}
        tournamentType={ctx.tournamentType}
      />

      {/* Game area */}
      <div style={{
        flex: 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        position: 'relative',
        overflow: 'hidden',
      }}>
        {/* Stars background */}
        <div style={{
          position: 'absolute', inset: 0,
          backgroundImage: 'radial-gradient(1px 1px at 10% 15%,#fff 0%,transparent 100%),radial-gradient(1px 1px at 25% 40%,#fff 0%,transparent 100%),radial-gradient(1.5px 1.5px at 50% 20%,#fff 0%,transparent 100%),radial-gradient(1px 1px at 70% 60%,#fff 0%,transparent 100%),radial-gradient(1px 1px at 85% 30%,#fff 0%,transparent 100%),radial-gradient(1px 1px at 35% 75%,#fff 0%,transparent 100%),radial-gradient(1px 1px at 60% 85%,#fff 0%,transparent 100%)',
          pointerEvents: 'none',
        }} />

        <GameCanvas
          onGameOver={handleGameOver}
          onScore={setScore}
          onWave={setWave}
          onLives={setLives}
          onKill={handleKill}
          onPlanet={setCurrentPlanet}
          onPowerup={handlePowerup}
        />
      </div>

      {/* Active booster strip */}
      {(weaponFrames > 0 || laserFrames > 0 || shieldCount > 0) && (
        <div style={{
          padding: '4px 20px',
          background: 'rgba(10,10,30,0.97)',
          borderTop: '1px solid rgba(74,158,255,0.15)',
          fontFamily: 'var(--font-pixel)',
          fontSize: 8,
          display: 'flex',
          gap: 20,
          alignItems: 'center',
        }}>
          {weaponFrames > 0 && (
            <span style={{ color: '#f7931a' }}>
              ⚡ WEAPON BOOST — {Math.ceil(weaponFrames / 60)}s
            </span>
          )}
          {laserFrames > 0 && (
            <span style={{ color: '#ff4444' }}>
              🔴 LASER — {Math.ceil(laserFrames / 60)}s
            </span>
          )}
          {shieldCount > 0 && (
            <span style={{ color: 'var(--color-blue)' }}>
              🛡 SHIELD ×{shieldCount}
            </span>
          )}
        </div>
      )}

      {/* Controls hint */}
      <div style={{
        padding: '6px 20px',
        background: 'rgba(10,10,30,0.97)',
        borderTop: '1px solid var(--color-border)',
        fontFamily: 'var(--font-pixel)',
        fontSize: 8,
        color: 'var(--color-text-dim)',
        display: 'flex',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: 8,
      }}>
        <span>WASD / ARROWS — MOVE</span>
        {currentPlanet
          ? (
            <span style={{ color: '#ffd700' }}>
              {currentPlanet.glyph} PROTECT THE {currentPlanet.label} — LOSE {currentPlanet.penalty.toLocaleString()} PTS IF DESTROYED
            </span>
          ) : (
            <span style={{ color: '#e74c3c' }}>
              ⚡ BOSS WAVE — DESTROY THE BOSS!
            </span>
          )
        }
        <span style={{ color: 'var(--color-blue)' }}>🔵 SHIELD = INVULNERABLE ENEMY — DODGE!</span>
      </div>
    </div>
  );
}
