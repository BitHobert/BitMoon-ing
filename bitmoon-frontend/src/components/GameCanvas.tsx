import { useEffect, useRef, useCallback } from 'react';
import { GameEngine } from '../game/GameEngine';
import { CANVAS_W, CANVAS_H } from '../game/constants';
import { useWsContext } from '../context/WsContext';
import type { TierNumber, GameEvent } from '../types';

interface Props {
  onGameOver: (events: GameEvent[], score: number, burned: bigint) => void;
  onScore:    (score: number)  => void;
  onWave:     (wave: number)   => void;
  onLives:    (lives: number)  => void;
  onKill:     (tier: TierNumber, points: number, mult: number) => void;
}

export function GameCanvas({ onGameOver, onScore, onWave, onLives, onKill }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<GameEngine | null>(null);
  const { scarcityMultiplier } = useWsContext();

  // Update scarcity multiplier live without restarting engine
  useEffect(() => {
    engineRef.current?.updateScarcity(scarcityMultiplier);
  }, [scarcityMultiplier]);

  const handleGameOver = useCallback((score: number, burned: bigint) => {
    const events = engineRef.current?.getEvents() ?? [];
    onGameOver(events, score, burned);
  }, [onGameOver]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const engine = new GameEngine(canvas, scarcityMultiplier, {
      onScore,
      onWave,
      onLives,
      onKill,
      onGameOver: handleGameOver,
    });
    engineRef.current = engine;
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
