import React from "react";

type SettingsCardProps = {
  title: string;
  description?: string;
  icon?: React.ReactNode;
  children?: React.ReactNode; // Right-aligned control area
  className?: string;
  status?: "default" | "success" | "warning";
  inGroup?: boolean; // When true, removes individual border/rounding for use in grouped container
  interactive?: boolean; // When true, the row highlights on hover (like a history row)
};

const SettingsCard: React.FC<SettingsCardProps> = ({
  title,
  description,
  icon,
  children,
  className = "",
  status = "default",
  inGroup = false,
  interactive = false,
}) => {
  const statusClass =
    status === "success"
      ? "border border-emerald-400/60 bg-emerald-500/5"
      : status === "warning"
        ? "border border-amber-400/60 bg-amber-500/5"
        : inGroup
          ? "border-0 border-b border-white/[0.08]"
          : "border border-white/[0.08]";

  const roundedClass = inGroup ? "" : "rounded-[var(--radius-lg)]";

  const baseClass = inGroup
    ? "p-3 flex items-center justify-between gap-3"
    : "settings-card onboarding-permission-row p-3 md:p-3 flex items-center justify-between gap-3";

  return (
    <div
      className={`group ${baseClass} ${roundedClass} ${statusClass} ${
        interactive ? "transition-colors hover:bg-white/5" : ""
      } ${className}`}
      role="group"
      aria-label={title}
    >
      <div className="flex items-center gap-3 min-w-0">
        {icon && (
          <div className="w-8 h-8 rounded-[var(--radius-md)] card-floating flex items-center justify-center shrink-0">
            {icon}
          </div>
        )}
        <div className="text-left min-w-0">
          <div className="text-xs font-medium text-white truncate">{title}</div>
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
    </div>
  );
};

export default SettingsCard;
