import React from "react";

// The determinate cousin of `Spinner`: same 16px box, same 2px stroke, same
// `white/30` track + `white` arc — but the arc length is driven by `progress`
// (0–1) instead of spinning. Use it anywhere a download/verify has a known
// completion so the fill resolves cleanly into the install check.
//
// Sizing mirrors Spinner: pass `className` (defaults to a 16px circle). The
// stroke width is fixed at 2px to match Spinner's `border-2`, so the geometry
// below is computed for the default 16px viewBox; scaling the box via
// `className` scales the whole SVG (stroke included) just like Spinner.

const SIZE = 16;
const STROKE = 2;
const RADIUS = (SIZE - STROKE) / 2; // inset the stroke so it doesn't clip
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

const ProgressRing: React.FC<{
  progress: number;
  className?: string;
}> = ({ progress, className = "h-4 w-4" }) => {
  const clamped = Math.max(0, Math.min(1, progress));
  const offset = CIRCUMFERENCE * (1 - clamped);

  return (
    <svg
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      className={`inline-block shrink-0 text-white ${className}`}
      // Start the arc at 12 o'clock and fill clockwise.
      style={{ transform: "rotate(-90deg)" }}
      role="img"
      aria-label="Downloading"
      data-testid="progress-ring"
    >
      {/* Full track ring — matches Spinner's `border-white/30`. */}
      <circle
        cx={SIZE / 2}
        cy={SIZE / 2}
        r={RADIUS}
        fill="none"
        stroke="currentColor"
        strokeOpacity={0.3}
        strokeWidth={STROKE}
      />
      {/* Progress arc — matches Spinner's solid `border-t-white`. */}
      <circle
        cx={SIZE / 2}
        cy={SIZE / 2}
        r={RADIUS}
        fill="none"
        stroke="currentColor"
        strokeWidth={STROKE}
        strokeLinecap="round"
        strokeDasharray={CIRCUMFERENCE}
        strokeDashoffset={offset}
        style={{ transition: "stroke-dashoffset 0.3s ease-out" }}
      />
    </svg>
  );
};

export default ProgressRing;
