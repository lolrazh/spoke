import React, { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "../ui/button";
import { ParticlesCanvas } from "../shared/ParticlesCanvas";

type IntroExperienceProps = {
  logoSrc: string;
  onFinish: () => void;
  onReadyForControls?: () => void; // called when main content fully visible
};

const prefersReducedMotion = () => {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
};

// no countdown guard: intro remains until user interacts

const GridBackground: React.FC<{ holeActive: boolean }> = ({ holeActive }) => {
  return (
    <div
      className={`sf-intro-grid${holeActive ? " hole-active" : ""}`}
      aria-hidden
    />
  );
};

export const IntroExperience: React.FC<IntroExperienceProps> = ({
  logoSrc,
  onFinish,
  onReadyForControls,
}) => {
  const reduced = prefersReducedMotion();
  const [stage, setStage] = useState<0 | 1 | 2 | 3>(0);
  const [visible, setVisible] = useState(true);
  const isMountedRef = useRef(true);

  // Match onboarding page transition spring
  const spring = {
    type: "spring" as const,
    stiffness: 340,
    damping: 28,
    mass: 0.45,
  };

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Animation stages
  useEffect(() => {
    if (reduced) {
      // Skip to final stage quickly
      const id = setTimeout(() => setStage(3), 50);
      return () => clearTimeout(id);
    }
    // Slower motion, minimal waiting (earlier stage triggers)
    const t0 = setTimeout(() => setStage(1), 600);
    const t1 = setTimeout(() => setStage(2), 1200);
    const t2 = setTimeout(() => setStage(3), 1800);
    return () => {
      clearTimeout(t0);
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [reduced]);

  const handleSkip = () => {
    try {
      const root = document.querySelector(".onboarding-window");
      if (root) root.classList.remove("resizing");
    } catch {}
    setVisible(false);
  };

  // Notify parent when content is fully visible
  const notifiedRef = useRef(false);
  useEffect(() => {
    if (!notifiedRef.current && stage >= 3) {
      notifiedRef.current = true;
      // Delay slightly so headline and CTA finish easing before showing controls
      const delay = reduced ? 120 : 650; // CTA anim ~550ms + small buffer
      const id = setTimeout(() => {
        try {
          onReadyForControls && onReadyForControls();
        } catch {}
      }, delay);
      return () => clearTimeout(id);
    }
  }, [stage, onReadyForControls, reduced]);

  return (
    <AnimatePresence onExitComplete={onFinish}>
      {visible && (
        <motion.div
          className="sf-intro-overlay"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -16 }}
          transition={spring}
          role="dialog"
          aria-label="Spoke intro"
        >
          <GridBackground holeActive={stage >= 2} />
          {!reduced && <ParticlesCanvas />}

          {/* Logo - positioned independently */}
          <motion.img
            src={logoSrc}
            alt="Spoke logo"
            className="sf-intro-logo"
            initial={{ opacity: 0, y: 10, scale: 0.985, filter: "blur(8px)" }}
            animate={{
              opacity: stage >= 2 ? 1 : 0,
              y: stage >= 2 ? 0 : 10,
              scale: stage >= 2 ? 1 : 0.985,
              filter: stage >= 2 ? "blur(0px)" : "blur(8px)",
            }}
            transition={{ duration: 0.9, ease: [0.25, 0.8, 0.25, 1] }}
          />

          {/* Center group - text and CTA */}
          <div className="sf-intro-center space-y-3 md:space-y-4">
            {/* Headline + Subcopy */}
            <motion.div
              className="text-center space-y-1"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: stage >= 3 ? 1 : 0, y: stage >= 3 ? 0 : 6 }}
              transition={{ duration: 0.6, ease: [0.25, 0.8, 0.25, 1] }}
            >
              <h1 className="text-heading-xl heading-gradient heading-crisp text-breathe">
                So Good You'll Want to Lick It
              </h1>
              <p className="sf-intro-sub text-sm text-subtle leading-relaxed">
                Let's get you set up for the most intelligent dictation in the
                world.
              </p>
            </motion.div>
            {/* CTA */}
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: stage >= 3 ? 1 : 0, y: stage >= 3 ? 0 : 10 }}
              transition={{
                duration: 0.55,
                ease: [0.25, 0.8, 0.25, 1],
                delay: 0.1,
              }}
              className="space-y-2"
            >
              <Button onClick={handleSkip} className="btn-primary shimmer">
                <span>Get Started</span>
              </Button>
            </motion.div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default IntroExperience;
