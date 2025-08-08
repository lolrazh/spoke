import * as React from "react";
import * as SwitchPrimitives from "@radix-ui/react-switch";

import { cn } from "../../lib/utils";

const Switch = React.forwardRef<
  React.ElementRef<typeof SwitchPrimitives.Root>,
  React.ComponentPropsWithoutRef<typeof SwitchPrimitives.Root>
>(({ className, ...props }, ref) => (
  <SwitchPrimitives.Root
    className={cn(
      // Glass track: subtle translucent background, border, blur - now rectangular
      "peer relative inline-flex h-5 w-10 shrink-0 cursor-pointer items-center rounded-lg border transition-all",
      "backdrop-blur-md disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20",
      // Unchecked/checked track states
      "data-[state=unchecked]:bg-white/5 data-[state=unchecked]:border-white/10",
      "data-[state=checked]:bg-white/10 data-[state=checked]:border-white/20",
      className,
    )}
    {...props}
    ref={ref}
  >
    <SwitchPrimitives.Thumb
      className={cn(
        // Thumb: rectangular with rounded corners, clearly visible over glass track
        "pointer-events-none block h-3.5 w-3.5 rounded-md bg-white/90 shadow-md ring-0 border border-white/30 transition-transform",
        "data-[state=checked]:translate-x-5 data-[state=unchecked]:translate-x-0.5",
      )}
    />
  </SwitchPrimitives.Root>
));
Switch.displayName = SwitchPrimitives.Root.displayName;

export { Switch };
