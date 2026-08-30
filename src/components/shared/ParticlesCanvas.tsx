import React, { useEffect, useRef } from "react";

type Star = {
  theta: number; // angle in radians
  r: number; // radius (distance to center) in device pixels
  speed: number; // radial speed (px/sec)
  size: number; // base size in device pixels
};

type ParticlesCanvasProps = {
  disabled?: boolean;
  opacity?: number; // Global opacity multiplier (0-1)
  density?: number; // Density multiplier
};

const prefersReducedMotion = () => {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
};

export const ParticlesCanvas: React.FC<ParticlesCanvasProps> = ({
  disabled = false,
  opacity = 0.85,
  density = 1.0,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const starsRef = useRef<Star[]>([]);
  const lastTsRef = useRef<number | null>(null);

  useEffect(() => {
    if (disabled || prefersReducedMotion()) return;

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) return;

    let pixelRatio = 1;
    let devicePixelRatio = 1;
    let maxRadius = 0;
    let innerRadius = 10;

    const setupCanvas = () => {
      devicePixelRatio = window.devicePixelRatio || 1;
      pixelRatio = Math.min(2, devicePixelRatio);
      const { innerWidth: w, innerHeight: h } = window;
      canvas.width = Math.floor(w * pixelRatio);
      canvas.height = Math.floor(h * pixelRatio);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      maxRadius = Math.hypot(canvas.width, canvas.height) * 0.65;
      innerRadius = 10 * devicePixelRatio;
    };
    setupCanvas();

    // Slowly drifting focal point to avoid stacking everything in one spot
    let t = 0;

    const makeStar = (): Star => {
      const th = Math.random() * Math.PI * 2;
      const r = maxRadius * (0.8 + Math.random() * 0.4);
      const speed = 60 + Math.random() * 140; // px/sec inward
      const size = (0.6 + Math.random() * 1.2) * devicePixelRatio;
      return { theta: th, r, speed, size };
    };

    const initStars = () => {
      const baseDensity = Math.min(
        420,
        Math.floor((window.innerWidth * window.innerHeight) / 20000),
      );
      const adjustedDensity = Math.floor(baseDensity * density);
      starsRef.current = new Array(Math.max(120, adjustedDensity))
        .fill(0)
        .map(() => makeStar());
    };
    initStars();

    const handleResize = () => {
      setupCanvas();
      initStars();
    };
    window.addEventListener("resize", handleResize);

    const animate = (ts: number) => {
      const ctx2 = ctx;
      const cx =
        canvas.width / 2 + Math.cos(t * 0.15) * 40 * devicePixelRatio;
      const cy =
        Math.floor(canvas.height * 0.42) +
        Math.sin(t * 0.11) * 28 * devicePixelRatio;
      const w = canvas.width;
      const h = canvas.height;
      const last = lastTsRef.current ?? ts;
      const dt = Math.min(0.033, (ts - last) / 1000); // cap at ~33ms for stability
      lastTsRef.current = ts;
      t += dt;

      ctx2.clearRect(0, 0, w, h);
      ctx2.globalCompositeOperation = "source-over";
      ctx2.globalAlpha = opacity;
      ctx2.fillStyle = "rgba(255,255,255,0.85)";

      for (let i = 0; i < starsRef.current.length; i++) {
        const s = starsRef.current[i];
        // Subtle swirl proportional to radius
        const swirl = 0.18 * dt * (s.r / maxRadius); // slightly calmer swirl
        s.theta += swirl;
        // Radial inward motion
        s.r -= s.speed * dt;
        if (s.r < innerRadius) {
          starsRef.current[i] = makeStar();
          continue;
        }
        const distFrac = s.r / maxRadius;
        const cosTheta = Math.cos(s.theta);
        const sinTheta = Math.sin(s.theta);
        const x = cx + cosTheta * s.r;
        const y = cy + sinTheta * s.r;
        // Size scales with distance; also dim near center to reduce hot spot
        const scale = 0.6 + 0.6 * distFrac;
        const rpx = Math.max(0.55 * pixelRatio, s.size * scale);
        // Local alpha falloff near the center
        const localAlpha = Math.max(0.3, Math.min(1, distFrac * 1.05));
        ctx2.globalAlpha = opacity * localAlpha;
        // Draw a short trail for motion impression
        const trail = Math.min(10 * pixelRatio, s.speed * dt * 0.7);
        ctx2.beginPath();
        ctx2.arc(x, y, rpx * 0.65, 0, Math.PI * 2);
        ctx2.fill();
        // trail line slightly behind the star along radial direction
        const tx = x + cosTheta * trail;
        const ty = y + sinTheta * trail;
        ctx2.globalAlpha = opacity * 0.45 * localAlpha;
        ctx2.strokeStyle = "rgba(255,255,255,0.8)";
        ctx2.lineWidth = Math.max(0.5 * pixelRatio, rpx * 0.25);
        ctx2.beginPath();
        ctx2.moveTo(tx, ty);
        ctx2.lineTo(x, y);
        ctx2.stroke();
        ctx2.globalAlpha = opacity;
      }

      rafRef.current = requestAnimationFrame(animate);
    };
    rafRef.current = requestAnimationFrame(animate);

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      window.removeEventListener("resize", handleResize);
    };
  }, [disabled, opacity, density]);

  return <canvas ref={canvasRef} className="sf-intro-particles" aria-hidden />;
};
