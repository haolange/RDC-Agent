import React, { useEffect, useRef } from 'react';

/** Sparse pool — low-frequency, restrained emit from the right source. */
const SPARK_POOL = 12;
/** Average gap between new emits from the source (seconds). */
const EMIT_GAP_MIN = 0.16;
const EMIT_GAP_MAX = 0.34;

interface SparkParticle {
  /** 0 at right source → 1 at left exit. */
  progress: number;
  /** Progress units per second. */
  speed: number;
  /** Final vertical offset from midline (px), reached as progress → 1. */
  spread: number;
  size: number;
  opacity: number;
  /** Seconds to wait before this slot emits again. */
  wait: number;
  active: boolean;
}

function randomBetween(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function emitGap(): number {
  return randomBetween(EMIT_GAP_MIN, EMIT_GAP_MAX);
}

function spawnSpark(seedProgress = 0): SparkParticle {
  const spreadSign = Math.random() < 0.5 ? -1 : 1;
  return {
    progress: seedProgress,
    speed: randomBetween(0.38, 0.58),
    // Near source almost no Y; far left fans to a clear but soft spread.
    spread: spreadSign * randomBetween(3.5, 7.5),
    size: Math.random() < 0.55 ? 2 : 1,
    opacity: randomBetween(0.5, 0.85),
    wait: 0,
    active: true,
  };
}

function resetSpark(spark: SparkParticle, delayed: boolean): void {
  const next = spawnSpark(0);
  spark.progress = 0;
  spark.speed = next.speed;
  spark.spread = next.spread;
  spark.size = next.size;
  spark.opacity = next.opacity;
  spark.wait = delayed ? emitGap() * randomBetween(0.6, 1.8) : 0;
  spark.active = !delayed;
}

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Right-fixed source fountain:
 * particles start vertically tight at the outlet, ease into a wider fan while
 * traveling left, and the source keeps emitting at a low rate while Max is held.
 */
export const EffortMaxSparks: React.FC = () => {
  const layerRef = useRef<HTMLSpanElement>(null);
  const nodesRef = useRef<Array<HTMLSpanElement | null>>([]);

  useEffect(() => {
    const layer = layerRef.current;
    if (!layer) return undefined;

    const measure = () => ({
      width: Math.max(1, layer.clientWidth),
      height: Math.max(1, layer.clientHeight),
    });

    if (prefersReducedMotion()) {
      const { width: w, height: h } = measure();
      const midY = h * 0.5;
      nodesRef.current.forEach((node, index) => {
        if (!node) return;
        const t = index / Math.max(1, SPARK_POOL - 1);
        // Dense/tight on the right, rarer + more spread on the left.
        const progress = t * t;
        const x = w * (0.9 - progress * 0.82);
        const y = midY + (index % 2 === 0 ? -1 : 1) * progress * progress * (h * 0.38);
        node.style.transform = `translate3d(${x.toFixed(2)}px, ${y.toFixed(2)}px, 0)`;
        node.style.opacity = String(0.28 + (1 - progress) * 0.4);
        node.style.width = '2px';
        node.style.height = '2px';
      });
      return undefined;
    }

    // Seed a thin stream already in flight so Max does not look empty on enter.
    const particles = Array.from({ length: SPARK_POOL }, (_, index) => {
      if (index < 4) {
        return spawnSpark((index + 1) / 5);
      }
      const idle = spawnSpark(0);
      idle.active = false;
      idle.wait = emitGap() * (index - 2);
      return idle;
    });

    let frame = 0;
    let last = performance.now();
    let emitCooldown = 0;

    const hide = (node: HTMLSpanElement | null) => {
      if (!node) return;
      node.style.opacity = '0';
      node.style.transform = 'translate3d(-12px, 0, 0)';
    };

    const paint = (
      particle: SparkParticle,
      node: HTMLSpanElement | null,
      width: number,
      height: number,
    ) => {
      if (!node) return;
      if (!particle.active) {
        hide(node);
        return;
      }

      const sourceX = width * 0.9;
      const travel = width * 0.88;
      const midY = height * 0.5;
      // Ease-in disperse: stay tight near the source, fan out toward the left.
      const disperse = particle.progress * particle.progress;
      const x = sourceX - particle.progress * travel;
      const y = midY + particle.spread * disperse;
      const fadeIn = Math.min(1, particle.progress / 0.06);
      const fadeOut = particle.progress > 0.78
        ? Math.max(0, 1 - (particle.progress - 0.78) / 0.22)
        : 1;

      node.style.transform = `translate3d(${x.toFixed(2)}px, ${y.toFixed(2)}px, 0)`;
      node.style.opacity = String(particle.opacity * fadeIn * fadeOut);
      node.style.width = `${particle.size}px`;
      node.style.height = `${particle.size}px`;
    };

    const tick = (now: number) => {
      const dt = Math.min(0.033, (now - last) / 1000);
      last = now;
      const { width, height } = measure();
      emitCooldown = Math.max(0, emitCooldown - dt);

      for (let i = 0; i < particles.length; i += 1) {
        const particle = particles[i]!;

        if (!particle.active) {
          particle.wait -= dt;
          if (particle.wait <= 0 && emitCooldown <= 0) {
            resetSpark(particle, false);
            emitCooldown = emitGap();
          }
          paint(particle, nodesRef.current[i] ?? null, width, height);
          continue;
        }

        particle.progress += particle.speed * dt;
        if (particle.progress >= 1) {
          resetSpark(particle, true);
          paint(particle, nodesRef.current[i] ?? null, width, height);
          continue;
        }

        paint(particle, nodesRef.current[i] ?? null, width, height);
      }

      frame = window.requestAnimationFrame(tick);
    };

    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, []);

  return (
    <span ref={layerRef} className="composer-effort-slider-sparks" aria-hidden="true">
      {Array.from({ length: SPARK_POOL }, (_, index) => (
        <span
          key={index}
          className="composer-effort-slider-spark"
          ref={(node) => {
            nodesRef.current[index] = node;
          }}
        />
      ))}
    </span>
  );
};
