import React, { useMemo, useState, useEffect } from "react";

type WeightKey = "bold" | "regular" | "semibold" | string;

// Lazy SVG imports - modules loaded on demand, not at startup
const SVG_LOADERS = import.meta.glob<string>(
  "../../assets/sf-symbols/**/*.svg",
  {
    eager: false, // Lazy load - returns loader functions
    import: "default",
    query: "?raw",
  },
);

// Build a map from normalized name to loader function
const svgLoaderRegistry: Record<string, () => Promise<string>> = {};
for (const [path, loader] of Object.entries(SVG_LOADERS)) {
  const afterRoot = path.substring(
    path.lastIndexOf("sf-symbols/") + "sf-symbols/".length,
  );
  const normalized = afterRoot
    .replace(/\.svg$/i, "")
    .split("/")
    .join(".");
  svgLoaderRegistry[normalized] = loader;
}

// Cache for loaded SVG content - persists across renders
const svgCache = new Map<string, string>();

// Track in-flight loading promises to avoid duplicate requests
const loadingPromises = new Map<string, Promise<string | null>>();

async function loadSvgForName(
  name: string,
  weight?: WeightKey | null,
): Promise<string | null> {
  const candidates = weight
    ? [`${name}.${weight}`, `${name}-${weight}`, name]
    : [name];

  for (const candidate of candidates) {
    // Return cached SVG if available
    const cached = svgCache.get(candidate);
    if (cached !== undefined) {
      return cached;
    }

    // Check if there's a loader for this name
    const loader = svgLoaderRegistry[candidate];
    if (loader) {
      // Check if already loading
      const existing = loadingPromises.get(candidate);
      if (existing) {
        return existing;
      }

      // Start loading and cache the promise
      const loadPromise = loader().then((svg) => {
        svgCache.set(candidate, svg);
        loadingPromises.delete(candidate);
        return svg;
      });
      loadingPromises.set(candidate, loadPromise);
      return loadPromise;
    }
  }

  return null;
}

// Sync version for initial render - returns cached value or null
function getCachedSvg(name: string, weight?: WeightKey | null): string | null {
  const candidates = weight
    ? [`${name}.${weight}`, `${name}-${weight}`, name]
    : [name];

  for (const candidate of candidates) {
    const cached = svgCache.get(candidate);
    if (cached !== undefined) {
      return cached;
    }
  }
  return null;
}

function sanitizeSvg(svg: string, title?: string): string {
  let cleaned = svg
    .replace(/<\?xml[\s\S]*?\?>/gi, "")
    .replace(/<!DOCTYPE[\s\S]*?>/gi, "")
    .trim();

  cleaned = cleaned.replace(/<svg([^>]*)>/i, (match, attrs) => {
    const withoutDimensions = attrs
      .replace(/\s+width="[^"]*"/gi, "")
      .replace(/\s+height="[^"]*"/gi, "")
      .replace(/\s+fill="[^"]*"/gi, "")
      .replace(/\s+stroke="[^"]*"/gi, "");
    const fillAttr = /fill=/i.test(attrs) ? "" : ' fill="currentColor"';
    return `<svg${withoutDimensions} width="100%" height="100%"${fillAttr} focusable="false">`;
  });

  cleaned = cleaned.replace(/<title>[\s\S]*?<\/title>/gi, "");

  cleaned = cleaned.replace(/\sfill="([^"]*)"/gi, (match, value) => {
    const normalized = value.trim().toLowerCase();
    if (normalized === "none" || normalized.startsWith("url(")) {
      return ` fill="${value}"`;
    }
    return ' fill="currentColor"';
  });

  cleaned = cleaned.replace(/\sstroke="([^"]*)"/gi, (match, value) => {
    const normalized = value.trim().toLowerCase();
    if (normalized === "none" || normalized.startsWith("url(")) {
      return ` stroke="${value}"`;
    }
    return ' stroke="currentColor"';
  });

  if (title) {
    cleaned = cleaned.replace(
      /<svg([^>]*)>/i,
      (match, attrs) => `<svg${attrs}><title>${escapeHtml(title)}</title>`,
    );
  }

  return cleaned;
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Some SF Symbols have narrower native proportions (e.g. trash's tall, thin
// viewBox) that render visibly smaller than a square glyph at an identical
// box size under uniform xMidYMid-meet scaling. Corrected by sqrt(area
// ratio) against a square reference, not by naive width-fill ratio (which
// overshoots for height-constrained glyphs already maxed at the box size).
const OPTICAL_SCALE: Record<string, number> = {
  trash: 1.09,
};

export interface SfIconProps {
  name: string; // e.g., "keyboard.badge.eye.fill"
  weight?: WeightKey; // default "bold"
  size?: number; // px, default 16
  className?: string;
  title?: string;
}

const SfIcon: React.FC<SfIconProps> = ({
  name,
  weight = "bold",
  size = 16,
  className = "",
  title,
}) => {
  // Try to get cached SVG synchronously for instant render
  const [rawSvg, setRawSvg] = useState<string | null>(() =>
    getCachedSvg(name, weight),
  );

  // Load SVG if not cached
  useEffect(() => {
    // Skip if already loaded
    if (getCachedSvg(name, weight)) {
      setRawSvg(getCachedSvg(name, weight));
      return;
    }

    let cancelled = false;
    loadSvgForName(name, weight).then((svg) => {
      if (!cancelled && svg) {
        setRawSvg(svg);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [name, weight]);

  const normalizedSvg = useMemo(
    () => (rawSvg ? sanitizeSvg(rawSvg, title) : null),
    [rawSvg, title],
  );

  const scale = OPTICAL_SCALE[name] ?? 1;
  const renderedSize = size * scale;

  if (!normalizedSvg) {
    return (
      <span
        className={className}
        style={{
          display: "inline-flex",
          width: renderedSize,
          height: renderedSize,
        }}
        aria-hidden
      />
    );
  }

  return (
    <span
      className={className}
      role={title ? "img" : undefined}
      aria-label={title ?? undefined}
      aria-hidden={title ? undefined : true}
      style={{
        display: "inline-flex",
        width: renderedSize,
        height: renderedSize,
      }}
      dangerouslySetInnerHTML={{ __html: normalizedSvg }}
    />
  );
};

export default SfIcon;
