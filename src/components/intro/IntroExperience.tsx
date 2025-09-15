import React, { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";

type IntroExperienceProps = {
  logoSrc: string;
  onFinish: () => void;
};

const prefersReducedMotion = () => {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
};

// no countdown guard: intro remains until user interacts

const GridBackground: React.FC = () => {
  return (
    <div className="sf-intro-grid" aria-hidden />
  );
};

const ParticlesCanvas: React.FC<{ disabled?: boolean }> = ({ disabled }) => {
  type Star = {
    theta: number; // angle in radians
    r: number; // radius (distance to center) in device pixels
    speed: number; // radial speed (px/sec)
    size: number; // base size in device pixels
  };
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const starsRef = useRef<Star[]>([]);
  const lastTsRef = useRef<number | null>(null);
  const [dpr, setDpr] = useState<number>(1);

  useEffect(() => {
    if (disabled) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) return;

    const setupCanvas = () => {
      const ratio = Math.min(2, window.devicePixelRatio || 1);
      setDpr(ratio);
      const { innerWidth: w, innerHeight: h } = window;
      canvas.width = Math.floor(w * ratio);
      canvas.height = Math.floor(h * ratio);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
    };
    setupCanvas();

    const center = () => ({
      x: canvas.width / 2,
      y: Math.floor(canvas.height * 0.42),
    });
    const maxRadius = () => Math.hypot(canvas.width, canvas.height) * 0.65;
    const innerRadius = () => 10 * (window.devicePixelRatio || 1);

    const makeStar = (): Star => {
      const th = Math.random() * Math.PI * 2;
      const r = maxRadius() * (0.8 + Math.random() * 0.4);
      const speed = 60 + Math.random() * 140; // px/sec inward
      const size = (0.6 + Math.random() * 1.2) * (window.devicePixelRatio || 1);
      return { theta: th, r, speed, size };
    };

    const initStars = () => {
      const density = Math.min(420, Math.floor((window.innerWidth * window.innerHeight) / 20000));
      starsRef.current = new Array(Math.max(120, density)).fill(0).map(() => makeStar());
    };
    initStars();

    const handleResize = () => {
      setupCanvas();
      initStars();
    };
    window.addEventListener("resize", handleResize);

    const animate = (ts: number) => {
      const ctx2 = ctx;
      const { x: cx, y: cy } = center();
      const w = canvas.width;
      const h = canvas.height;
      const last = lastTsRef.current ?? ts;
      const dt = Math.min(0.033, (ts - last) / 1000); // cap at ~33ms for stability
      lastTsRef.current = ts;

      ctx2.clearRect(0, 0, w, h);
      ctx2.globalCompositeOperation = "source-over";
      ctx2.globalAlpha = 0.85;
      ctx2.fillStyle = "rgba(255,255,255,0.9)";

      for (let i = 0; i < starsRef.current.length; i++) {
        const s = starsRef.current[i];
        // Subtle swirl proportional to radius
        const swirl = 0.25 * dt * (s.r / maxRadius()); // radians per sec scaled by radius fraction
        s.theta += swirl;
        // Radial inward motion
        s.r -= s.speed * dt;
        if (s.r < innerRadius()) {
          starsRef.current[i] = makeStar();
          continue;
        }
        const x = cx + Math.cos(s.theta) * s.r;
        const y = cy + Math.sin(s.theta) * s.r;
        // Size slightly scales with distance to create depth
        const scale = 0.6 + 0.6 * (s.r / maxRadius());
        const rpx = Math.max(0.6 * dpr, s.size * scale);
        // Draw a short trail for motion impression
        const trail = Math.min(12 * dpr, (s.speed * dt * 0.8));
        ctx2.beginPath();
        ctx2.arc(x, y, rpx * 0.65, 0, Math.PI * 2);
        ctx2.fill();
        // trail line slightly behind the star along radial direction
        const tx = x + Math.cos(s.theta) * trail;
        const ty = y + Math.sin(s.theta) * trail;
        ctx2.globalAlpha = 0.55;
        ctx2.strokeStyle = "rgba(255,255,255,0.8)";
        ctx2.lineWidth = Math.max(0.5 * dpr, rpx * 0.25);
        ctx2.beginPath();
        ctx2.moveTo(tx, ty);
        ctx2.lineTo(x, y);
        ctx2.stroke();
        ctx2.globalAlpha = 0.85;
      }

      rafRef.current = requestAnimationFrame(animate);
    };
    rafRef.current = requestAnimationFrame(animate);

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      window.removeEventListener("resize", handleResize);
    };
  }, [disabled, dpr]);

  return <canvas ref={canvasRef} className="sf-intro-particles" aria-hidden />;
};

export const IntroExperience: React.FC<IntroExperienceProps> = ({ logoSrc, onFinish }) => {
  const reduced = prefersReducedMotion();
  const [stage, setStage] = useState<0 | 1 | 2 | 3>(0);
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    if (reduced) {
      // Skip to final stage quickly
      const id = setTimeout(() => setStage(3), 50);
      return () => clearTimeout(id);
    }
    const t0 = setTimeout(() => setStage(1), 700);
    const t1 = setTimeout(() => setStage(2), 1500);
    const t2 = setTimeout(() => setStage(3), 2300);
    return () => { clearTimeout(t0); clearTimeout(t1); clearTimeout(t2); };
  }, [reduced]);

  const handleSkip = () => {
    setVisible(false);
    onFinish();
  };

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          className="sf-intro-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.35 }}
          role="dialog"
          aria-label="Sonic Flow intro"
        >
          <GridBackground />
          {!reduced && <ParticlesCanvas />}

          {/* Center group */}
          <div className="sf-intro-center">
            {/* Logo */}
            <motion.img
              src={logoSrc}
              alt="Sonic Flow logo"
              className="sf-intro-logo"
              initial={{ opacity: 0, y: 8, filter: "blur(6px)" }}
              animate={{ opacity: stage >= 2 ? 1 : 0, y: stage >= 2 ? 0 : 8, filter: stage >= 2 ? "blur(0px)" : "blur(6px)" }}
              transition={{ duration: 0.6, ease: [0.25, 0.8, 0.25, 1] }}
            />
            {/* Tagline */}
            <motion.div
              className="sf-intro-tagline"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: stage >= 3 ? 1 : 0, y: stage >= 3 ? 0 : 6 }}
              transition={{ duration: 0.45 }}
            >
              <div className="sf-intro-heading">Think it. Say it. See it.</div>
              <div className="sf-intro-sub">Press Right Option to start dictating anytime.</div>
            </motion.div>
            {/* CTA */}
            <motion.button
              className="sf-intro-cta"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: stage >= 3 ? 1 : 0, y: stage >= 3 ? 0 : 8 }}
              transition={{ duration: 0.4, delay: 0.1 }}
              onClick={handleSkip}
            >
              Get set up
            </motion.button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default IntroExperience;


