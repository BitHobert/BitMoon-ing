import { useMemo } from 'react';

/**
 * Fixed-position background layer with floating game sprites.
 * Uses CSS keyframe animations (defined in theme.css) for performance.
 * Renders behind all page content via z-index: 0.
 */

// All available sprites from /public/sprites/
const SPRITE_POOL = [
  // Enemies
  'sprites/enemy1.webp',
  'sprites/enemy2.webp',
  'sprites/enemy3.webp',
  'sprites/enemy4.webp',
  'sprites/enemy5.webp',
  // Planets
  'sprites/planet-moon.webp',
  'sprites/planet-nebula.webp',
  'sprites/planet-earth.webp',
  'sprites/planet-saturn.webp',
  'sprites/planet-darkmoon.webp',
  'sprites/planet-inferno.webp',
  // Bosses
  'sprites/boss-devourer.webp',
  'sprites/boss-abductor.webp',
  'sprites/boss-overlord.webp',
  'sprites/boss-watcher.webp',
];

// Deterministic "random" using a seed so elements don't reshuffle on re-render
function seededRandom(seed: number): number {
  const x = Math.sin(seed * 9301 + 49297) * 49297;
  return x - Math.floor(x);
}

interface FloatingElement {
  sprite: string;
  size: number;       // px
  top: number;        // % from top
  delay: number;      // animation-delay seconds
  duration: number;   // animation-duration seconds
  opacity: number;
  direction: 'across' | 'down';
}

function generateElements(count: number): FloatingElement[] {
  const elements: FloatingElement[] = [];
  for (let i = 0; i < count; i++) {
    const r = (offset: number) => seededRandom(i * 7 + offset);
    const sprite = SPRITE_POOL[Math.floor(r(0) * SPRITE_POOL.length)];
    const isPlanetOrBoss = sprite.includes('planet') || sprite.includes('boss');
    const size = isPlanetOrBoss
      ? 36 + Math.floor(r(1) * 32)   // 36-68px for planets/bosses
      : 20 + Math.floor(r(1) * 24);  // 20-44px for enemies

    elements.push({
      sprite,
      size,
      top: Math.floor(r(2) * 85) + 5,         // 5-90% from top
      delay: Math.floor(r(3) * 40),            // 0-40s stagger
      duration: 50 + Math.floor(r(4) * 50),    // 50-100s per cycle
      opacity: isPlanetOrBoss
        ? 0.04 + r(5) * 0.06                   // 0.04-0.10 for planets/bosses
        : 0.06 + r(5) * 0.08,                  // 0.06-0.14 for enemies
      direction: r(6) > 0.8 ? 'down' : 'across',
    });
  }
  return elements;
}

// Small static stars in the background
function generateStars(count: number): { x: number; y: number; size: number; delay: number }[] {
  const stars = [];
  for (let i = 0; i < count; i++) {
    const r = (offset: number) => seededRandom(i * 13 + offset + 100);
    stars.push({
      x: r(0) * 100,
      y: r(1) * 100,
      size: 1 + r(2) * 2,
      delay: r(3) * 4,
    });
  }
  return stars;
}

export function SpaceBackground() {
  const elements = useMemo(() => generateElements(14), []);
  const stars = useMemo(() => generateStars(60), []);

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 0,
        pointerEvents: 'none',
        overflow: 'hidden',
        background: 'radial-gradient(ellipse at 50% 0%, #0d0d1a 0%, #0a0a0f 70%)',
      }}
      aria-hidden="true"
    >
      {/* Static stars */}
      {stars.map((s, i) => (
        <div
          key={`star-${i}`}
          style={{
            position: 'absolute',
            left: `${s.x}%`,
            top: `${s.y}%`,
            width: s.size,
            height: s.size,
            borderRadius: '50%',
            background: '#fff',
            opacity: 0.4,
            animation: `twinkle ${3 + s.delay}s ease-in-out infinite`,
            animationDelay: `${s.delay}s`,
          }}
        />
      ))}

      {/* Floating game elements */}
      {elements.map((el, i) => (
        <img
          key={`float-${i}`}
          src={`/${el.sprite}`}
          alt=""
          style={{
            position: 'absolute',
            top: el.direction === 'across' ? `${el.top}%` : undefined,
            left: el.direction === 'down' ? `${el.top}%` : undefined,
            width: el.size,
            height: el.size,
            objectFit: 'contain',
            imageRendering: 'pixelated',
            opacity: el.opacity,
            animation: `${el.direction === 'across' ? 'float-across' : 'float-down'} ${el.duration}s linear infinite`,
            animationDelay: `${el.delay}s`,
          }}
        />
      ))}
    </div>
  );
}
