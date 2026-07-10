import React from "react";
import SfIcon from "../icons/SfIcon";

interface IconButtonProps {
  /** SF-symbol name (see src/assets/sf-symbols). */
  name: string;
  onClick?: () => void;
  title?: string;
  ariaLabel?: string;
  /** Icon + hit-box size in px. Matches the history copy icon by default. */
  size?: number;
  /** Hidden until the nearest `.group` ancestor is hovered (row-reveal). */
  revealOnHover?: boolean;
  className?: string;
  children?: React.ReactNode;
}

/**
 * The app's standard bare icon button: no background box — the icon itself
 * sits muted and brightens to `foreground` on hover. Mirrors the transcript
 * history copy icon so every surface uses one rule instead of re-deriving it.
 */
const IconButton: React.FC<IconButtonProps> = ({
  name,
  onClick,
  title,
  ariaLabel,
  size = 14,
  revealOnHover = false,
  className = "",
  children,
}) => (
  <button
    type="button"
    onClick={onClick}
    title={title}
    aria-label={ariaLabel ?? title}
    style={{ width: size, height: size }}
    className={`relative flex items-center justify-center text-muted-foreground/50 transition-[color,opacity] hover:text-foreground focus-visible:outline-none after:absolute after:-inset-[3px] after:content-[''] ${
      revealOnHover
        ? "opacity-0 focus-visible:opacity-100 group-hover:opacity-100"
        : ""
    } ${className}`}
  >
    {children ?? <SfIcon name={name} size={size} />}
  </button>
);

export default IconButton;
