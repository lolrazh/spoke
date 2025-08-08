import * as React from "react";
import * as SwitchPrimitives from "@radix-ui/react-switch";

import { cn } from "../../lib/utils";

const Switch = React.forwardRef<
  React.ElementRef<typeof SwitchPrimitives.Root>,
  React.ComponentPropsWithoutRef<typeof SwitchPrimitives.Root>
>(({ className, ...props }, ref) => (
  <SwitchPrimitives.Root
    className={cn(
      // Unified glass track styling via CSS utilities
      "peer switch-track relative inline-flex h-5 w-10 shrink-0 cursor-pointer items-center rounded-[6px] transition-all",
      "disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none",
      className,
    )}
    {...props}
    ref={ref}
  >
    <SwitchPrimitives.Thumb
      className={cn(
        // Thumb adopts glass tokenized styling from CSS utilities
        "switch-thumb pointer-events-none block h-3.5 w-3.5 rounded-[4px] transition-all",
        "data-[state=checked]:translate-x-[22px] data-[state=unchecked]:translate-x-0.5",
      )}
    />
  </SwitchPrimitives.Root>
));
Switch.displayName = SwitchPrimitives.Root.displayName;

export { Switch };
