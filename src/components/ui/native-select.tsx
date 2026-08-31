import * as React from "react";

import { cn } from "../../lib/utils";

export type NativeSelectOption = {
  value: string;
  label: string;
};

type NativeSelectProps = Omit<
  React.SelectHTMLAttributes<HTMLSelectElement>,
  "children" | "onChange" | "value"
> & {
  value: string;
  options: readonly NativeSelectOption[];
  onValueChange: (value: string) => void;
};

const NATIVE_SELECT_CLASSES =
  "card-floating flex h-10 w-full cursor-pointer appearance-none items-center rounded-lg border border-white/10 bg-transparent px-3 py-2 pr-9 text-left text-sm font-normal text-white/70 outline-none transition-colors duration-200 hover:bg-white/5 focus:border-white/20 focus:bg-white/5 focus:ring-2 focus:ring-white/10";

export const NativeSelect = React.forwardRef<
  HTMLSelectElement,
  NativeSelectProps
>(({ className, options, onValueChange, style, ...props }, ref) => (
  <div className="relative">
    <select
      {...props}
      ref={ref}
      value={props.value}
      onChange={(event) => onValueChange(event.target.value)}
      className={cn(NATIVE_SELECT_CLASSES, className)}
      style={{
        ...style,
        colorScheme: "dark",
        WebkitAppRegion: "no-drag",
      }}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/50"
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  </div>
));

NativeSelect.displayName = "NativeSelect";
