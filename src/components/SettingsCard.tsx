import React from "react";

type SettingsCardProps = {
  title: string;
  description?: string;
  icon?: React.ReactNode;
  children?: React.ReactNode; // Right-aligned control area
  className?: string;
};

const SettingsCard: React.FC<SettingsCardProps> = ({
  title,
  description,
  icon,
  children,
  className = "",
}) => {
  return (
    <div
      className={`onboarding-permission-row p-3 md:p-3 flex items-center justify-between gap-3 ${className}`}
      role="group"
      aria-label={title}
    >
      <div className="flex items-center gap-3 min-w-0">
        {icon && (
          <div className="w-8 h-8 rounded-md card-floating flex items-center justify-center shrink-0">
            {icon}
          </div>
        )}
        <div className="text-left min-w-0">
          <div className="text-xs font-medium text-white truncate">{title}</div>
          {description && (
            <div className="text-[10px] text-subtle mt-0.5 truncate">{description}</div>
          )}
        </div>
      </div>
      {children && (
        <div className="flex items-center shrink-0" style={{ WebkitAppRegion: "no-drag" }}>
          {children}
        </div>
      )}
    </div>
  );
};

export default SettingsCard;


