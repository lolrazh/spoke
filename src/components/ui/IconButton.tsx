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
}) => (
  <button
    type="button"
    onClick={onClick}
    title={title}
    aria-label={ariaLabel ?? title}
    style={{ width: size, height: size }}
    className={`flex items-center justify-center transition-opacity focus-visible:outline-none ${
      revealOnHover
        ? "opacity-0 focus-visible:opacity-100 group-hover:opacity-100"
        : ""
    } ${className}`}
  >
    <SfIcon
      name={name}
      size={size}
      className="text-muted-foreground/50 transition-colors hover:text-foreground"
    />
  </button>
);

export default IconButton;
