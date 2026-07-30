import * as React from "react";

import { cn } from "../../lib/utils";

const BUTTON_BASE_CLASSES =
  "inline-flex items-center justify-center whitespace-nowrap rounded-lg text-sm font-medium ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 relative overflow-hidden cursor-pointer";

const BUTTON_VARIANT_CLASSES = {
  default: "btn-primary",
  secondary: "btn-secondary",
  destructive:
    "bg-gradient-to-t from-red-600 to-red-500 text-white hover:from-red-700 hover:to-red-600",
} as const;

const BUTTON_SIZE_CLASSES = {
  default: "h-10 px-4 py-2",
  sm: "h-9 rounded-md px-3",
  lg: "h-11 rounded-md px-8",
} as const;

type ButtonVariant = keyof typeof BUTTON_VARIANT_CLASSES;
type ButtonSize = keyof typeof BUTTON_SIZE_CLASSES;

export function buttonVariants(
  options: {
    variant?: ButtonVariant | null;
    size?: ButtonSize | null;
    className?: string;
  } = {},
) {
  return cn(
    BUTTON_BASE_CLASSES,
    BUTTON_VARIANT_CLASSES[options.variant ?? "default"],
    BUTTON_SIZE_CLASSES[options.size ?? "default"],
    options.className,
  );
}

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => (
    <button
      className={buttonVariants({ variant, size, className })}
      ref={ref}
      {...props}
    />
  ),
);
Button.displayName = "Button";

export { Button };
