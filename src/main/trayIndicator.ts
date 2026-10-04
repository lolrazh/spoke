/**
 * Tray Update Indicator
 *
 * Drives the menu-bar icon through the update states: the plain logo, a
 * progress bar while downloading, a bar-to-dot morph when the download lands,
 * a dot while the update waits for a restart, a hollow dot on failure, and a
 * turning logo while the install handoff runs.
 *
 * Frames come from trayIconFrames and are built lazily and cached. Animations
 * pick their frame from elapsed wall time, so a late timer drops a frame
 * instead of stretching the motion. Exactly one timer runs at a time, and none
 * at rest.
 */

import {
  MORPH_FRAME_MS,
  morphShapes,
  rasterizeBar,
  rasterizeFailed,
  rasterizeRotated,
  rasterizeShape,
  readyShape,
  spinAngles,
  type AlphaMask,
} from "./trayIconFrames";

export type IndicatorVisual =
  | { kind: "idle" }
  | { kind: "download"; percent: number }
  | { kind: "ready" }
  | { kind: "failed" }
  | { kind: "installing" };

export interface IndicatorSnapshot {
  status: string;
  readyToInstall: boolean;
  downloadPercent: number | null;
}

export function deriveVisual(
  snapshot: IndicatorSnapshot,
  installing: boolean,
): IndicatorVisual {
  if (installing) return { kind: "installing" };
  if (snapshot.readyToInstall) return { kind: "ready" };
  if (snapshot.status === "downloading") {
    const p = Math.round(snapshot.downloadPercent ?? 0);
    return { kind: "download", percent: Math.max(0, Math.min(100, p)) };
  }
  if (snapshot.status === "error") return { kind: "failed" };
  return { kind: "idle" };
}

// Hold the full bar for a beat before it flows into the dot.
export const MORPH_HOLD_MS = 250;
const MORPH_POLL_MS = 4;
const SPIN_FRAME_MS = 1000 / 12;

export interface IndicatorDeps<Img> {
  /** The plain template logo. */
  baseImage: () => Img;
  /** 32x32 alpha of the logo, the source every frame is drawn from. */
  logoAlpha: () => AlphaMask | null;
  /** Turn a mask into a template image. */
  toImage: (mask: AlphaMask) => Img;
  setImage: (img: Img) => void;
  prefersReducedMotion: () => boolean;
}

export interface TrayIndicator {
  show: (visual: IndicatorVisual) => void;
  current: () => IndicatorVisual;
  isAnimating: () => boolean;
  dispose: () => void;
}

export function createTrayIndicator<Img>(
  deps: IndicatorDeps<Img>,
): TrayIndicator {
  let visual: IndicatorVisual = { kind: "idle" };
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastImage: Img | null = null;
  let disposed = false;

  // ── frame cache ──
  const barCache = new Map<number, Img>();
  let morphCache: Img[] | null = null;
  let readyCache: Img | null = null;
  let failedCache: Img | null = null;
  let spinCache: Img[] | null = null;

  const withLogo = <T>(fn: (logo: AlphaMask) => T): T | null => {
    const logo = deps.logoAlpha();
    return logo ? fn(logo) : null;
  };
  const barImage = (percent: number): Img => {
    let img = barCache.get(percent);
    if (!img) {
      img = withLogo((l) => deps.toImage(rasterizeBar(l, percent))) ?? deps.baseImage();
      barCache.set(percent, img);
    }
    return img;
  };
  const morphImages = (): Img[] => {
    if (!morphCache)
      morphCache =
        withLogo((l) => morphShapes().map((s) => deps.toImage(rasterizeShape(l, s)))) ??
        [readyImage()];
    return morphCache;
  };
  const readyImage = (): Img => {
    if (!readyCache)
      readyCache = withLogo((l) => deps.toImage(rasterizeShape(l, readyShape()))) ?? deps.baseImage();
    return readyCache;
  };
  const failedImage = (): Img => {
    if (!failedCache)
      failedCache = withLogo((l) => deps.toImage(rasterizeFailed(l))) ?? deps.baseImage();
    return failedCache;
  };
  const spinImages = (): Img[] => {
    if (!spinCache)
      spinCache =
        withLogo((l) => spinAngles().map((a) => deps.toImage(rasterizeRotated(l, a)))) ??
        [deps.baseImage()];
    return spinCache;
  };

  const put = (img: Img) => {
    if (disposed || img === lastImage) return;
    lastImage = img;
    deps.setImage(img);
  };
  const stop = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };

  // Poll on a short timer and pick the frame from elapsed time.
  const runFrames = (
    frames: Img[],
    frameMs: number,
    { loop, onDone }: { loop: boolean; onDone?: () => void },
  ) => {
    const t0 = Date.now();
    const pollMs = loop ? Math.min(frameMs / 2, 40) : MORPH_POLL_MS;
    const tick = () => {
      timer = null;
      const idx = Math.floor((Date.now() - t0) / frameMs);
      if (!loop && idx >= frames.length - 1) {
        put(frames[frames.length - 1]);
        onDone?.();
        return;
      }
      put(frames[loop ? idx % frames.length : idx]);
      timer = setTimeout(tick, pollMs);
    };
    tick();
  };

  const playMorph = () => {
    const frames = morphImages();
    put(frames[0]);
    timer = setTimeout(() => {
      timer = null;
      runFrames(frames, MORPH_FRAME_MS, { loop: false, onDone: () => put(readyImage()) });
    }, MORPH_HOLD_MS);
  };

  const show = (next: IndicatorVisual) => {
    if (disposed) return;
    const prev = visual;
    if (prev.kind === next.kind) {
      // Same state again: only download progress changes the picture.
      if (next.kind === "download" && prev.kind === "download" && next.percent !== prev.percent) {
        visual = next;
        put(barImage(next.percent));
      }
      return;
    }
    visual = next;
    stop();
    const motion = !deps.prefersReducedMotion();
    switch (next.kind) {
      case "idle":
        put(deps.baseImage());
        break;
      case "download":
        put(barImage(next.percent));
        break;
      case "ready":
        // Animate only when we watched the download land; an update that was
        // already staged (or reduced motion) just shows the dot.
        if (prev.kind === "download" && motion) playMorph();
        else put(readyImage());
        break;
      case "failed":
        put(failedImage());
        break;
      case "installing":
        if (motion) runFrames(spinImages(), SPIN_FRAME_MS, { loop: true });
        else put(deps.baseImage());
        break;
    }
  };

  return {
    show,
    current: () => visual,
    isAnimating: () => timer !== null,
    dispose: () => {
      stop();
      disposed = true;
    },
  };
}
