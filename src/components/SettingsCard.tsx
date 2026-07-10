import React from "react";
import { m } from "framer-motion";
import { panelCascadeItem } from "./shared/panelMotion";

type SettingsCardProps = {
  title: string;
  titleAccessory?: React.ReactNode;
  description?: string;
  icon?: React.ReactNode;
  children?: React.ReactNode; // Right-aligned control area
  className?: string;
  inGroup?: boolean; // When true, removes individual border/rounding for use in grouped container
  interactive?: boolean; // When true, the row highlights on hover (like a history row). Independent of `onClick`.
  onClick?: () => void; // When set, the whole row acts as a button
};

const SettingsCard: React.FC<SettingsCardProps> = ({
  title,
  titleAccessory,
  description,
  icon,
  children,
  className = "",
  inGroup = false,
  interactive = false,
  onClick,
}) => {
  const borderClass = inGroup
    ? "border-0 border-b border-white/[0.08]"
    : "border border-white/[0.08]";

  const roundedClass = inGroup ? "" : "rounded-[var(--radius-lg)]";

  const baseClass = inGroup
    ? "p-3 flex items-center justify-between gap-3"
    : "settings-card onboarding-permission-row p-3 md:p-3 flex items-center justify-between gap-3";

  const clickableProps = onClick
    ? {
        role: "button" as const,
        tabIndex: 0,
        onClick,
        onKeyDown: (e: React.KeyboardEvent) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onClick();
          }
        },
      }
    : { role: "group" as const };

  return (
    <m.div
      variants={panelCascadeItem}
      className={`group ${baseClass} ${roundedClass} ${borderClass} ${
        interactive ? "transition-colors hover:bg-white/5" : ""
      } ${onClick ? "cursor-pointer" : ""} ${className}`}
      aria-label={title}
      {...clickableProps}
    >
      <div className="flex items-center gap-3 min-w-0">
        {icon && (
          <div className="w-8 h-8 rounded-[var(--radius-md)] card-floating flex items-center justify-center shrink-0">
            {icon}
          </div>
        )}
        <div className="text-left min-w-0">
          <div className="flex min-w-0 items-baseline gap-1.5">
            <div className="min-w-0 truncate text-xs font-medium leading-4 text-white">
              {title}
            </div>
            {titleAccessory && (
              <div className="shrink-0 leading-4">{titleAccessory}</div>
            )}
          </div>
          {description && (
            <div className="text-[10px] text-subtle mt-0.5 truncate">
              {description}
            </div>
          )}
        </div>
      </div>
      {children && (
        <div
          className="flex items-center shrink-0"
          style={{ WebkitAppRegion: "no-drag" }}
        >
          {children}
        </div>
      )}
    </m.div>
  );
};

/**
 * Trailing controls for a settings card, laid out as two fixed columns so a
 * stacked list of cards reads as aligned columns:
 *
 *   [ primary glyph ][ reserved action column ]
 *
 * - `primary` is the row's main state glyph (e.g. download / check). It is
 *   centered in a fixed-width slot (`--card-primary-col`) so glyphs of
 *   differing widths share an exact column center vertically across every row,
 *   regardless of whether a trailing action is present.
 * - `action` is an optional reveal-on-hover control (e.g. the uninstall trash).
 *   Its column width is reserved via `--card-action-col` even when `action` is
 *   omitted, so neighbouring rows never shift the primary glyph to fill the gap.
 *
 * Centralising this convention here means future cards get aligned trailing
 * controls for free instead of hand-rolling the spacing.
 */
export const CardTrailing: React.FC<{
  primary?: React.ReactNode;
  action?: React.ReactNode;
}> = ({ primary, action }) => (
  <div className="flex items-center gap-2">
    <div
      className="flex items-center justify-center shrink-0"
      style={{ width: "var(--card-primary-col)" }}
    >
      {primary}
    </div>
    <div
      className="flex items-center justify-center shrink-0"
      style={{ width: "var(--card-action-col)" }}
    >
      {action}
    </div>
  </div>
);

export default SettingsCard;
