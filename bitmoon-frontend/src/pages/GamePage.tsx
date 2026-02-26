import { useState, useCallback, useEffect, useRef } from 'react';
import type { NavigateFn, PageContext } from '../App';
import type { GameEvent, TierNumber } from '../types';
import { endSession } from '../api/http';
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
  const [shieldActive,   setShieldActive]   = useState(false);

  const handlePowerup = useCallback((_kind: PowerupKind | null, wf: number, sa: boolean) => {
    setWeaponFrames(wf);
    setShieldActive(sa);
  }, []);

  // Session is created in useEffect; token may come from auth context or be created fresh
  const sessionIdRef = useRef<string | null>(null);
  const tokenRef     = useRef<string | null>(null);

  // Create a game session on mount
  useEffect(() => {
    async function initSession() {
      try {
        // If wallet connected, use existing auth token (or login first)
        if (wallet.connected && wallet.address) {
          let token = auth.token;
          if (!token) {
            await auth.login(wallet.address, wallet.signMessage, wallet.getPublicKey, ctx.tournamentType);
            token = auth.token;
          }
          if (token && auth.sessionId) {
            sessionIdRef.current = auth.sessionId;
            tokenRef.current = token;
          }
        }
        // Guest play (no wallet): skip session — game runs locally, score not saved
      } catch (err) {
        // Session creation failed — log but don't block the game (free play still works)
        console.warn('Session init failed (game will run in guest mode):', err);
      } finally {
        setLoading(false);
      }
    }
    void initSession();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleGameOver = useCallback(async (events: GameEvent[], finalScore: number, burned: bigint) => {
    const sessionId = sessionIdRef.current;
    const token     = tokenRef.current;
    if (!sessionId || !token) {
      // No session — just navigate to result with client score
      navigate('result', { resultSessionId: undefined });
      return;
    }
    try {
      await endSession(token, {
        sessionId,
        events,
        clientScore: finalScore,
        clientBurned: burned.toString(),
      });
    } catch (err) {
      console.error('endSession failed:', err);
    }
    navigate('result', { resultSessionId: sessionId });
  }, [navigate]);

  const handleKill = useCallback((_tier: TierNumber, _pts: number, _mult: number) => {
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
      {(weaponFrames > 0 || shieldActive) && (
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
          {shieldActive && (
            <span style={{ color: 'var(--color-blue)' }}>
              🛡 SHIELD ACTIVE
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
