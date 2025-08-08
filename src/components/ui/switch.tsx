import * as React from "react";
import * as SwitchPrimitives from "@radix-ui/react-switch";

import { cn } from "../../lib/utils";

const Switch = React.forwardRef<
  React.ElementRef<typeof SwitchPrimitives.Root>,
  React.ComponentPropsWithoutRef<typeof SwitchPrimitives.Root>
>(({ className, ...props }, ref) => (
  <SwitchPrimitives.Root
    className={cn(
      // Glass track: subtle translucent background, border, blur - now rectangular with minimal rounding
      "peer relative inline-flex h-5 w-10 shrink-0 cursor-pointer items-center rounded-[6px] border transition-all",
      "backdrop-blur-md disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20",
      // Unchecked/checked track states with better contrast
      "data-[state=unchecked]:bg-white/5 data-[state=unchecked]:border-white/10",
      "data-[state=checked]:bg-white/15 data-[state=checked]:border-white/30",
      className,
    )}
    {...props}
    ref={ref}
  >
    <SwitchPrimitives.Thumb
      className={cn(
        // Thumb: rectangular with minimal rounded corners, different states for better visibility
        "pointer-events-none block h-3.5 w-3.5 rounded-sm shadow-md ring-0 transition-all",
        "data-[state=unchecked]:bg-white/75 data-[state=unchecked]:border-white/20",
        "data-[state=checked]:bg-white/95 data-[state=checked]:border-white/40",
        "data-[state=checked]:translate-x-[22px] data-[state=unchecked]:translate-x-0.5",
      )}
    />
  </SwitchPrimitives.Root>
));
Switch.displayName = SwitchPrimitives.Root.displayName;

export { Switch };
