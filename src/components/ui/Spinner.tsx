import React from "react";

// The app's single loading spinner. Every surface — onboarding, permissions,
// models, updates — imports this so the colours, border weight, and speed stay
// identical instead of being hand-rolled each time. Pass size/spacing via
// `className` (defaults to a 16px circle).
const Spinner: React.FC<{ className?: string }> = ({ className = "h-4 w-4" }) => (
  <span
    className={`inline-block shrink-0 animate-spin will-change-transform rounded-full border-2 border-white/30 border-t-white ${className}`}
    aria-hidden
  />
);

export default Spinner;
