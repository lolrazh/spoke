export type ClassValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | ClassValue[]
  | { [key: string]: boolean | null | undefined };

function flattenClassValues(inputs: ClassValue[]): string[] {
  const classes: string[] = [];

  const append = (value: ClassValue): void => {
    if (typeof value === "string") {
      classes.push(...value.split(/\s+/).filter(Boolean));
      return;
    }

    if (typeof value === "number") {
      if (value) classes.push(String(value));
      return;
    }

    if (Array.isArray(value)) {
      value.forEach(append);
      return;
    }

    if (value && typeof value === "object") {
      for (const [className, enabled] of Object.entries(value)) {
        if (enabled) classes.push(className);
      }
    }
  };

  inputs.forEach(append);
  return classes;
}

function mergeKnownConflicts(classes: string[]): string[] {
  const result: string[] = [];
  const indexes = new Map<string, number>();

  for (const className of classes) {
    // Keep the one Tailwind conflict pattern used by this repository's
    // callers. This is deliberately narrow instead of pretending to be a
    // second general-purpose Tailwind parser.
    const parts = className.split(":");
    const utility = parts.pop() ?? "";
    const variantPrefix = parts.join(":");
    const key = /^!?px-/.test(utility) ? `${variantPrefix}:px` : className;
    const previousIndex = indexes.get(key);

    if (previousIndex === undefined) {
      indexes.set(key, result.length);
      result.push(className);
    } else {
      result[previousIndex] = className;
    }
  }

  return result;
}

export function cn(...inputs: ClassValue[]) {
  return mergeKnownConflicts(flattenClassValues(inputs)).join(" ");
}
