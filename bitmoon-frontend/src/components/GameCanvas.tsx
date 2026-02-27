import { useEffect, useRef, useCallback } from 'react';
import { GameEngine } from '../game/GameEngine';
import { AudioEngine } from '../game/AudioEngine';
import { CANVAS_W, CANVAS_H } from '../game/constants';
import type { PlanetConfig } from '../game/constants';
import type { PowerupKind } from '../game/constants';
import { useWsContext } from '../context/WsContext';
import type { TierNumber, GameEvent } from '../types';

interface Props {
  onGameOver: (events: GameEvent[], score: number, burned: bigint) => void;
  onScore:    (score: number)  => void;
  onWave:     (wave: number)   => void;
  onLives:    (lives: number)  => void;
  onKill:     (tier: TierNumber, points: number, mult: number) => void;
  onPlanet:   (planet: PlanetConfig | null) => void;
  onPowerup:  (kind: PowerupKind | null, weaponFrames: number, laserFrames: number, shieldCount: number) => void;
}

export function GameCanvas({ onGameOver, onScore, onWave, onLives, onKill, onPlanet, onPowerup }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<GameEngine | null>(null);
  const audioRef  = useRef<AudioEngine | null>(null);
  const { scarcityMultiplier } = useWsContext();

  // Update scarcity multiplier live without restarting engine
  useEffect(() => {
    engineRef.current?.updateScarcity(scarcityMultiplier);
  }, [scarcityMultiplier]);

  const handleGameOver = useCallback((score: number, burned: bigint) => {
    const events = engineRef.current?.getEvents() ?? [];
    onGameOver(events, score, burned);
  }, [onGameOver]);

  // Initialise audio and wire M-key mute toggle.
  // AudioContext must be created/resumed inside a user gesture (browser policy).
  // The keydown handler here fires before GameEngine's own keydown, so resume()
  // is always called on the very first keypress that starts gameplay.
  useEffect(() => {
    const audio = new AudioEngine();
    audioRef.current = audio;
    const handleKeyDown = (e: KeyboardEvent) => {
      audio.resume();
      if (e.key === 'm' || e.key === 'M') audio.setMuted(!audio.isMuted());
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const engine = new GameEngine(canvas, scarcityMultiplier, {
      onScore,
      onWave,
      onLives,
      onKill,
      onGameOver: handleGameOver,
      onPlanet,
      onPowerup,
    });
    engineRef.current = engine;
    if (audioRef.current) engine.audio = audioRef.current;
    engine.start();

    return () => {
      engine.stop();
      engineRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // only mount/unmount

  return (
    <div className="crt" style={{ display: 'inline-block', lineHeight: 0 }}>
      <canvas
        ref={canvasRef}
        width={CANVAS_W}
        height={CANVAS_H}
        style={{
          display: 'block',
          background: '#050510',
          border: '1px solid rgba(74,158,255,0.15)',
          boxShadow: '0 0 30px rgba(74,158,255,0.07), inset 0 0 60px rgba(0,0,0,0.5)',
          imageRendering: 'pixelated',
          maxWidth: '100%',
        }}
      />
    </div>
  );
}
