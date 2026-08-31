import * as React from "react";

import { cn } from "../../lib/utils";

type SwitchProps = Omit<
  React.ButtonHTMLAttributes<HTMLButtonElement>,
  "onClick" | "type"
> & {
  checked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  onClick?: React.MouseEventHandler<HTMLButtonElement>;
};

const Switch = React.forwardRef<HTMLButtonElement, SwitchProps>(
  ({ className, checked = false, onCheckedChange, onClick, ...props }, ref) => {
    const state = checked ? "checked" : "unchecked";

    return (
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        data-state={state}
        className={cn(
          // Unified glass track styling via CSS utilities
          "peer switch-track relative inline-flex h-5 w-10 shrink-0 cursor-pointer items-center rounded-[6px] transition-all",
          "disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none",
          className,
        )}
        {...props}
        ref={ref}
        onClick={(event) => {
          onClick?.(event);
          if (!event.defaultPrevented) onCheckedChange?.(!checked);
        }}
      >
        <span
          aria-hidden="true"
          data-state={state}
          className={cn(
            // Thumb adopts glass tokenized styling from CSS utilities
            "switch-thumb pointer-events-none block h-3.5 w-3.5 rounded-[4px] transition-all",
            "data-[state=checked]:translate-x-[22px] data-[state=unchecked]:translate-x-0.5",
          )}
        />
      </button>
    );
  },
);
Switch.displayName = "Switch";

export { Switch };
