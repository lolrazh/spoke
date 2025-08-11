import React, { useEffect, useMemo, useState } from "react";

type WeightKey = "bold" | "regular" | "semibold" | string;

type SymbolEntry = {
  [weight in WeightKey]?: {
    path: string;
    geometry: { width: number; height: number };
  };
};

type SymbolsJson = Record<string, SymbolEntry>;

let symbolsCache: SymbolsJson | null = null;
let symbolsPromise: Promise<SymbolsJson> | null = null;

async function loadSymbols(): Promise<SymbolsJson> {
  if (symbolsCache) return symbolsCache;
  if (!symbolsPromise) {
    symbolsPromise = fetch("/assets/sf-symbols.json", { cache: "force-cache" })
      .then(async (res) => {
        if (!res.ok) throw new Error(`Failed to load sf-symbols.json: ${res.status}`);
        return (await res.json()) as SymbolsJson;
      })
      .then((json) => {
        symbolsCache = json;
        return json;
      })
      .catch((err) => {
        symbolsPromise = null;
        throw err;
      });
  }
  return symbolsPromise;
}

export interface SfIconProps {
  name: string; // e.g., "keyboard.badge.eye.fill"
  weight?: WeightKey; // default "bold"
  size?: number; // px, default 16
  className?: string;
  title?: string;
}

const SfIcon: React.FC<SfIconProps> = ({ name, weight = "bold", size = 16, className = "", title }) => {
  const [symbols, setSymbols] = useState<SymbolsJson | null>(symbolsCache);

  useEffect(() => {
    if (symbolsCache) return; // already loaded
    let mounted = true;
    loadSymbols()
      .then((json) => {
        if (mounted) setSymbols(json);
      })
      .catch(() => {
        // swallow; component will render fallback
      });
    return () => {
      mounted = false;
    };
  }, []);

  const spec = useMemo(() => {
    const entry = symbols?.[name];
    if (!entry) return null;
    const chosen = (entry[weight] || entry["bold"] || Object.values(entry)[0]) as
      | { path: string; geometry: { width: number; height: number } }
      | undefined;
    return chosen || null;
  }, [symbols, name, weight]);

  if (!spec) {
    // Fallback: empty box to preserve layout
    return <span className={className} style={{ display: "inline-block", width: size, height: size }} aria-hidden />;
  }

  const viewBox = `0 0 ${spec.geometry.width} ${spec.geometry.height}`;

  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox={viewBox}
      preserveAspectRatio="xMidYMid meet"
      fill="currentColor"
      aria-hidden={!title}
      role={title ? "img" : undefined}
    >
      {title ? <title>{title}</title> : null}
      <path d={spec.path} />
    </svg>
  );
};

export default SfIcon;


