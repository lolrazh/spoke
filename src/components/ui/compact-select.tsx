import * as React from "react";
import { createPortal } from "react-dom";

import { cn } from "../../lib/utils";

export type CompactSelectOption = {
  value: string;
  label: string;
};

type CompactSelectProps = {
  value: string;
  options: readonly CompactSelectOption[];
  onValueChange: (value: string) => void;
  className?: string;
  "aria-label"?: string;
  disabled?: boolean;
};

const TRIGGER_CLASSES =
  "card-floating flex h-9 w-full cursor-pointer items-center rounded-[var(--radius-md)] border border-white/10 bg-transparent pl-3 pr-8 text-left text-sm font-normal text-white/70 outline-none transition-colors duration-200 hover:bg-white/5 focus-visible:border-white/20 focus-visible:bg-white/5 focus-visible:ring-2 focus-visible:ring-white/10 disabled:cursor-not-allowed disabled:opacity-50 aria-expanded:bg-white/5";

const LIST_GAP_PX = 4;
const LIST_MAX_HEIGHT_PX = 320;

type ListPlacement = { top: number; right: number; minWidth: number };

/**
 * A compact, app-styled replacement for a native `<select>`. macOS draws a
 * native select's menu at system size, which cannot be styled; this keeps
 * the list inside the app's own visual language. No dependencies beyond
 * React, so it costs nothing at startup.
 */
export const CompactSelect: React.FC<CompactSelectProps> = ({
  value,
  options,
  onValueChange,
  className,
  disabled,
  "aria-label": ariaLabel,
}) => {
  const id = React.useId();
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const listRef = React.useRef<HTMLDivElement>(null);
  const [open, setOpen] = React.useState(false);
  const [placement, setPlacement] = React.useState<ListPlacement | null>(null);
  const selectedIndex = Math.max(
    0,
    options.findIndex((option) => option.value === value),
  );
  const [activeIndex, setActiveIndex] = React.useState(selectedIndex);

  const selected = options[selectedIndex];

  const close = React.useCallback(() => {
    setOpen(false);
    setPlacement(null);
  }, []);

  const openList = React.useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger || disabled || options.length === 0) return;
    const rect = trigger.getBoundingClientRect();
    setPlacement({
      top: rect.bottom + LIST_GAP_PX,
      right: Math.max(0, window.innerWidth - rect.right),
      minWidth: rect.width,
    });
    setActiveIndex(selectedIndex);
    setOpen(true);
  }, [disabled, options.length, selectedIndex]);

  const commit = React.useCallback(
    (index: number) => {
      const option = options[index];
      close();
      triggerRef.current?.focus();
      if (option && option.value !== value) onValueChange(option.value);
    },
    [close, onValueChange, options, value],
  );

  // Any outside interaction, window change, or ancestor scroll dismisses the
  // list, since its fixed placement would otherwise drift from the trigger.
  React.useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (
        listRef.current?.contains(target) ||
        triggerRef.current?.contains(target)
      ) {
        return;
      }
      close();
    };
    const onScroll = (event: Event) => {
      if (listRef.current?.contains(event.target as Node)) return;
      close();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", close);
    window.addEventListener("blur", close);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", close);
      window.removeEventListener("blur", close);
    };
  }, [open, close]);

  React.useEffect(() => {
    if (!open) return;
    listRef.current?.focus({ preventScroll: true });
    listRef.current
      ?.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [open, activeIndex]);

  const onTriggerKeyDown = (event: React.KeyboardEvent) => {
    if (["ArrowDown", "ArrowUp", "Enter", " "].includes(event.key)) {
      event.preventDefault();
      openList();
    }
  };

  const onListKeyDown = (event: React.KeyboardEvent) => {
    const last = options.length - 1;
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        setActiveIndex((index) => Math.min(last, index + 1));
        break;
      case "ArrowUp":
        event.preventDefault();
        setActiveIndex((index) => Math.max(0, index - 1));
        break;
      case "Home":
        event.preventDefault();
        setActiveIndex(0);
        break;
      case "End":
        event.preventDefault();
        setActiveIndex(last);
        break;
      case "Enter":
      case " ":
        event.preventDefault();
        commit(activeIndex);
        break;
      case "Escape":
      case "Tab":
        event.preventDefault();
        close();
        triggerRef.current?.focus();
        break;
      default:
        break;
    }
  };

  const listId = `${id}-list`;

  return (
    <div className={cn("relative", className)}>
      <button
        ref={triggerRef}
        type="button"
        role="combobox"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        disabled={disabled}
        className={TRIGGER_CLASSES}
        style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
        onClick={() => (open ? close() : openList())}
        onKeyDown={onTriggerKeyDown}
      >
        <span className="block truncate">{selected?.label ?? ""}</span>
      </button>
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-white/50"
      >
        <path d="m6 9 6 6 6-6" />
      </svg>
      {open && placement
        ? createPortal(
            <div
              ref={listRef}
              id={listId}
              role="listbox"
              aria-label={ariaLabel}
              aria-activedescendant={`${id}-option-${activeIndex}`}
              tabIndex={-1}
              className="card-floating fixed z-50 overflow-y-auto rounded-lg border border-white/10 p-1 text-white outline-none"
              style={
                {
                  top: placement.top,
                  right: placement.right,
                  minWidth: placement.minWidth,
                  maxHeight: LIST_MAX_HEIGHT_PX,
                  backgroundColor: "rgb(10, 10, 10)",
                  WebkitAppRegion: "no-drag",
                } as React.CSSProperties
              }
              onKeyDown={onListKeyDown}
            >
              {options.map((option, index) => {
                const isSelected = index === selectedIndex;
                const isActive = index === activeIndex;
                return (
                  <div
                    key={option.value}
                    id={`${id}-option-${index}`}
                    role="option"
                    aria-selected={isSelected}
                    data-index={index}
                    className={cn(
                      "relative flex cursor-pointer select-none items-center rounded-md py-1.5 pl-2 pr-8 text-sm text-white/70",
                      isActive && "bg-white/5 text-white",
                    )}
                    onPointerMove={() => setActiveIndex(index)}
                    onClick={() => commit(index)}
                  >
                    <span className="block truncate">{option.label}</span>
                    {isSelected ? (
                      <svg
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                        className="absolute right-2 h-4 w-4 text-white/70"
                      >
                        <path d="m5 12 5 5L20 7" />
                      </svg>
                    ) : null}
                  </div>
                );
              })}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
};
