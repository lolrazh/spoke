import React from "react";
import { m } from "framer-motion";

// The app's single loading spinner. Every surface — onboarding, permissions,
// models, updates — imports this so the colours, border weight and speed stay
// identical instead of being hand-rolled each time. Pass size/spacing via
// `className` (defaults to a 16px circle).
//
// Rotation is driven by framer-motion (JS) rather than the CSS `animate-spin`
// utility on purpose: a global `prefers-reduced-motion` rule sets
// `animation: none !important` on `.animate-spin`, which froze every spinner.
// A loading spinner is functional feedback (not decoration), so it should keep
// turning — and a JS transform is immune to that CSS override.
const Spinner: React.FC<{ className?: string }> = ({ className = "h-4 w-4" }) => (
  <m.span
    className={`inline-block shrink-0 rounded-full border-2 border-white/30 border-t-white ${className}`}
    animate={{ rotate: 360 }}
    transition={{ duration: 0.8, repeat: Infinity, ease: "linear" }}
    aria-hidden
  />
);

export default Spinner;
