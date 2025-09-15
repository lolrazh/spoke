import React, { useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";

type IntroExperienceProps = {
  logoSrc: string;
  onFinish: () => void;
  maxDurationMs?: number;
};

const prefersReducedMotion = () => {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
};

const useCountdownGuard = (enabled: boolean, ms: number, onEnd: () => void) => {
  useEffect(() => {
    if (!enabled) return;
    const id = setTimeout(onEnd, ms);
    return () => clearTimeout(id);
  }, [enabled, ms, onEnd]);
};

const GridBackground: React.FC = () => {
  return (
    <div className="sf-intro-grid" aria-hidden />
  );
};

const ParticlesCanvas: React.FC<{ disabled?: boolean }> = ({ disabled }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const particlesRef = useRef<Array<{ x: number; y: number; vx: number; vy: number; r: number }>>([]);
  const [dpr, setDpr] = useState<number>(1);

  useEffect(() => {
    if (disabled) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) return;

    const handleResize = () => {
      const ratio = Math.min(2, window.devicePixelRatio || 1);
      setDpr(ratio);
      const { innerWidth: w, innerHeight: h } = window;
      canvas.width = Math.floor(w * ratio);
      canvas.height = Math.floor(h * ratio);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
    };
    handleResize();
    window.addEventListener("resize", handleResize);

    // Init particles (keep count modest to avoid overdraw)
    const count = Math.min(320, Math.floor((window.innerWidth * window.innerHeight) / 24000));
    const particles = new Array(count).fill(0).map(() => ({
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height,
      vx: (Math.random() - 0.5) * 0.15 * dpr,
      vy: (Math.random() - 0.5) * 0.15 * dpr,
      r: (Math.random() * 1.2 + 0.4) * dpr,
    }));
    particlesRef.current = particles;

    const animate = () => {
      const ctx2 = ctx;
      const width = canvas.width;
      const height = canvas.height;
      ctx2.clearRect(0, 0, width, height);
      ctx2.globalAlpha = 0.7;
      ctx2.fillStyle = "rgba(255,255,255,0.6)";
      const centerX = width / 2;
      const centerY = Math.floor(height * 0.42);

      for (const p of particlesRef.current) {
        // Gentle attraction to center for converge feel
        const dx = centerX - p.x;
        const dy = centerY - p.y;
        p.vx += (dx * 0.00002) * dpr;
        p.vy += (dy * 0.00002) * dpr;
        // Damping
        p.vx *= 0.995;
        p.vy *= 0.995;
        p.x += p.vx;
        p.y += p.vy;
        // Wrap
        if (p.x < -50) p.x = width + 50;
        if (p.x > width + 50) p.x = -50;
        if (p.y < -50) p.y = height + 50;
        if (p.y > height + 50) p.y = -50;
        // Draw
        ctx2.beginPath();
        ctx2.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx2.fill();
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

export const IntroExperience: React.FC<IntroExperienceProps> = ({ logoSrc, onFinish, maxDurationMs = 5000 }) => {
  const reduced = prefersReducedMotion();
  const [stage, setStage] = useState<0 | 1 | 2 | 3>(0);
  const [visible, setVisible] = useState(true);

  // Global guard: never block beyond maxDurationMs
  useCountdownGuard(visible, maxDurationMs, () => {
    setVisible(false);
    onFinish();
  });

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

          {/* Skip */}
          <button className="sf-intro-skip" onClick={handleSkip} aria-label="Skip intro">Skip</button>

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


