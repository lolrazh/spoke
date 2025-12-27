import React, { useMemo } from "react";

type WeightKey = "bold" | "regular" | "semibold" | string;

const RAW_SVG_SYMBOLS = import.meta.glob<string>(
  "../../assets/sf-symbols/**/*.svg",
  {
    eager: true,
    import: "default",
    query: "?raw",
  },
);

const svgRegistry: Record<string, string> = Object.entries(
  RAW_SVG_SYMBOLS,
).reduce(
  (acc, [path, svg]) => {
    const afterRoot = path.substring(
      path.lastIndexOf("sf-symbols/") + "sf-symbols/".length,
    );
    const normalized = afterRoot
      .replace(/\.svg$/i, "")
      .split("/")
      .join(".");
    acc[normalized] = svg;
    return acc;
  },
  {} as Record<string, string>,
);

function getSvgForName(name: string, weight?: WeightKey | null): string | null {
  const candidates = weight
    ? [`${name}.${weight}`, `${name}-${weight}`, name]
    : [name];
  for (const candidate of candidates) {
    if (svgRegistry[candidate]) return svgRegistry[candidate];
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
  const rawSvg = useMemo(() => getSvgForName(name, weight), [name, weight]);
  const normalizedSvg = useMemo(
    () => (rawSvg ? sanitizeSvg(rawSvg, title) : null),
    [rawSvg, title],
  );

  if (!normalizedSvg) {
    return (
      <span
        className={className}
        style={{ display: "inline-flex", width: size, height: size }}
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
      style={{ display: "inline-flex", width: size, height: size }}
      dangerouslySetInnerHTML={{ __html: normalizedSvg }}
    />
  );
};

export default SfIcon;
