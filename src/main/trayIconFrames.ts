/**
 * Tray Icon Frames
 *
 * Pure geometry and rasterizing for the menu-bar update states. Every frame is
 * a 32x32 alpha mask (16pt @2x template image): the Spoke logo with a gap cut
 * around whatever sits on top of it (download bar, ready dot, failed ring).
 *
 * The bar-to-dot morph reproduces the "Liquid flow" rig tuned in the tray
 * motion studio: the bar slides along one path (its own straight segment, then
 * a cubic up into the dot) with its head and tail on separate springs, sampled
 * at 60fps from Motion's spring engine so the numbers mean the same thing as
 * the app's framer-motion springs.
 *
 * Nothing here touches Electron, so it is unit-testable and cheap to cache.
 */

import { spring } from "motion-dom";

export const ICON_PX = 32;
const SS = 4; // supersampling per axis
const GRID = ICON_PX * SS;

// ── Geometry (icon px) ─────────────────────────────────────────────────

type Pt = [number, number];
type Disc = [number, number, number];
export interface TubeShape {
  discs: Disc[];
  gap: number;
}

export const DOT: Pt = [26.6, 5.4];
const BAR_LEFT: Pt = [4.75, 27.25];
const BAR_RIGHT: Pt = [27.25, 27.25];
const BAR_RADIUS = 3.75;
const DOT_RADIUS = 4.4;
const BAR_GAP = 2;
const BAR_LENGTH = BAR_RIGHT[0] - BAR_LEFT[0];
const TRACK_ALPHA = 0.28;
const FAILED_RING_RADIUS = 3.5;
const FAILED_RING_STROKE = 1.8;
const DISC_SPACING = 0.25;

// Locked "Liquid flow" tuning from the tray motion studio.
export const MORPH_TUNING = {
  fps: 60,
  h1: [1.6, -7] as Pt, // outgoing handle, relative to the bar's right end
  h2: [0.6, 7.5] as Pt, // incoming handle, relative to the dot
  headK: 420,
  headD: 22,
  headDelay: 0,
  tailK: 260,
  tailD: 24,
  tailDelay: 50,
  taper: 0.5,
  squash: 0.35,
  gapEnd: 2.6,
};

const SPIN_FRAMES = 24;

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

// ── Springs ────────────────────────────────────────────────────────────

export interface SampledSpring {
  at: (ms: number) => number;
  done: (ms: number) => boolean;
}

export function makeSpring(
  stiffness: number,
  damping: number,
  delay: number,
): SampledSpring {
  const g = spring({ keyframes: [0, 1], stiffness, damping, mass: 1 });
  return {
    at: (ms) => (ms <= delay ? 0 : (g.next(ms - delay).value as number)),
    done: (ms) => ms > delay && g.next(ms - delay).done,
  };
}

// ── Path: the bar's own straight segment, then a cubic into the dot ────

interface FlowPath {
  total: number;
  at: (s: number) => Pt;
}

function buildFlowPath(): FlowPath {
  const { h1, h2 } = MORPH_TUNING;
  const pts: Pt[] = [];
  for (let i = 0; i <= 90; i++)
    pts.push([lerp(BAR_LEFT[0], BAR_RIGHT[0], i / 90), BAR_LEFT[1]]);
  const c1: Pt = [BAR_RIGHT[0] + h1[0], BAR_RIGHT[1] + h1[1]];
  const c2: Pt = [DOT[0] + h2[0], DOT[1] + h2[1]];
  for (let i = 1; i <= 240; i++) {
    const t = i / 240;
    const u = 1 - t;
    pts.push([
      u * u * u * BAR_RIGHT[0] +
        3 * u * u * t * c1[0] +
        3 * u * t * t * c2[0] +
        t * t * t * DOT[0],
      u * u * u * BAR_RIGHT[1] +
        3 * u * u * t * c1[1] +
        3 * u * t * t * c2[1] +
        t * t * t * DOT[1],
    ]);
  }
  const cum = [0];
  for (let i = 1; i < pts.length; i++)
    cum.push(
      cum[i - 1] +
        Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]),
    );
  const total = cum[cum.length - 1];
  let ex = DOT[0] - c2[0];
  let ey = DOT[1] - c2[1];
  const el = Math.hypot(ex, ey) || 1;
  ex /= el;
  ey /= el;

  // Past the end the path continues along the arrival tangent, so a spring
  // overshoot carries the head slightly beyond the dot and back.
  const at = (s: number): Pt => {
    if (s <= 0) return [BAR_LEFT[0] + s, BAR_LEFT[1]];
    if (s >= total) return [DOT[0] + ex * (s - total), DOT[1] + ey * (s - total)];
    let lo = 0;
    let hi = cum.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (cum[mid] < s) lo = mid;
      else hi = mid;
    }
    const t = (s - cum[lo]) / (cum[hi] - cum[lo] || 1);
    return [lerp(pts[lo][0], pts[hi][0], t), lerp(pts[lo][1], pts[hi][1], t)];
  };
  return { total, at };
}

// A tube is a run of discs along a centreline, tapering from r0 to r1.
function tubeAlong(
  fn: (s: number) => Pt,
  s0: number,
  s1: number,
  r0: number,
  r1: number,
  gap: number,
): TubeShape {
  const discs: Disc[] = [];
  const len = Math.max(0, s1 - s0);
  const n = Math.max(1, Math.ceil(len / DISC_SPACING));
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const [x, y] = fn(lerp(s0, s1, t));
    discs.push([x, y, lerp(r0, r1, t)]);
  }
  return { discs, gap };
}

const alongBar = (s: number): Pt => [BAR_LEFT[0] + s, BAR_LEFT[1]];

export function barShape(): TubeShape {
  return tubeAlong(alongBar, 0, BAR_LENGTH, BAR_RADIUS, BAR_RADIUS, BAR_GAP);
}

export function readyShape(): TubeShape {
  return { discs: [[DOT[0], DOT[1], DOT_RADIUS]], gap: MORPH_TUNING.gapEnd };
}

/** The bar-to-dot morph as shapes at 60fps: frame 0 is the full bar, the last is the dot. */
export function morphShapes(): TubeShape[] {
  const T = MORPH_TUNING;
  const path = buildFlowPath();
  const head = makeSpring(T.headK, T.headD, T.headDelay);
  const tail = makeSpring(T.tailK, T.tailD, T.tailDelay);
  const shapeAt = (ms: number): TubeShape => {
    const ph = head.at(ms);
    const pt = tail.at(ms);
    const sh = BAR_LENGTH + (path.total - BAR_LENGTH) * ph;
    const st = Math.min(path.total * pt, sh);
    const spread = clamp01((sh - st) / BAR_LENGTH);
    const moving = clamp01(ph * 3);
    const k = clamp01(ph);
    let rHead = lerp(BAR_RADIUS, DOT_RADIUS, k);
    // Overshoot of either end fattens the ball slightly: the squash.
    const over = Math.max(0, pt - 1) + Math.max(0, ph - 1);
    rHead *= 1 + T.squash * over * 2;
    const rTail = rHead * (1 - T.taper * moving * spread);
    return tubeAlong(path.at, st, sh, rTail, rHead, lerp(BAR_GAP, T.gapEnd, k));
  };

  const step = 1000 / T.fps;
  const shapes: TubeShape[] = [];
  let ms = 0;
  for (;;) {
    shapes.push(shapeAt(ms));
    if ((head.done(ms) && tail.done(ms) && ms > 120) || ms > 2000) break;
    ms += step;
  }
  shapes[0] = barShape();
  shapes.push(readyShape());
  return shapes;
}

export const MORPH_FRAME_MS = 1000 / MORPH_TUNING.fps;

// ── Rasterizer ─────────────────────────────────────────────────────────

/** A 32x32 alpha mask, 0..255 per pixel, row-major. */
export type AlphaMask = Uint8Array;

/** Mark every supersample inside the union of discs (each grown by `grow`). */
function markDiscs(grid: Uint8Array, discs: Disc[], grow: number) {
  for (const [cx, cy, r0] of discs) {
    const r = r0 + grow;
    if (r <= 0) continue;
    const r2 = r * r;
    const gx0 = Math.max(0, Math.floor((cx - r) * SS));
    const gx1 = Math.min(GRID - 1, Math.ceil((cx + r) * SS));
    const gy0 = Math.max(0, Math.floor((cy - r) * SS));
    const gy1 = Math.min(GRID - 1, Math.ceil((cy + r) * SS));
    for (let gy = gy0; gy <= gy1; gy++) {
      const dy = (gy + 0.5) / SS - cy;
      const dy2 = dy * dy;
      if (dy2 > r2) continue;
      const row = gy * GRID;
      for (let gx = gx0; gx <= gx1; gx++) {
        const dx = (gx + 0.5) / SS - cx;
        if (dx * dx + dy2 <= r2) grid[row + gx] = 1;
      }
    }
  }
}

interface Layer {
  grid: Uint8Array;
  alpha: number;
}

/**
 * Composite per supersample: the topmost layer containing the sample wins,
 * else the knockout clears it, else the logo shows through. Averaging the
 * samples gives antialiased edges with no alpha build-up between discs.
 */
function composite(
  logo: AlphaMask,
  knock: Uint8Array | null,
  layers: Layer[],
): AlphaMask {
  const out = new Uint8Array(ICON_PX * ICON_PX);
  const n = SS * SS;
  for (let py = 0; py < ICON_PX; py++) {
    for (let px = 0; px < ICON_PX; px++) {
      const base = logo[py * ICON_PX + px] / 255;
      let sum = 0;
      for (let sy = 0; sy < SS; sy++) {
        const row = (py * SS + sy) * GRID + px * SS;
        for (let sx = 0; sx < SS; sx++) {
          const i = row + sx;
          let a = -1;
          for (let l = layers.length - 1; l >= 0; l--) {
            if (layers[l].grid[i]) {
              a = layers[l].alpha;
              break;
            }
          }
          if (a < 0) a = knock && knock[i] ? 0 : base;
          sum += a;
        }
      }
      out[py * ICON_PX + px] = Math.round((sum / n) * 255);
    }
  }
  return out;
}

const newGrid = () => new Uint8Array(GRID * GRID);

export function rasterizeShape(logo: AlphaMask, shape: TubeShape): AlphaMask {
  const knock = newGrid();
  markDiscs(knock, shape.discs, shape.gap);
  const fill = newGrid();
  markDiscs(fill, shape.discs, 0);
  return composite(logo, knock, [{ grid: fill, alpha: 1 }]);
}

/** Download progress: full-size logo, gap cut around the bar, track + fill. */
export function rasterizeBar(logo: AlphaMask, percent: number): AlphaMask {
  const p = clamp01(percent / 100);
  const bar = barShape();
  const knock = newGrid();
  markDiscs(knock, bar.discs, bar.gap);
  const track = newGrid();
  markDiscs(track, bar.discs, 0);
  // Fill width is max(h, w * p) on the 30px bar, i.e. a centreline of
  // max(0, 30p - 7.5) from the bar's left end.
  const fillLen = Math.max(0, 30 * p - BAR_RADIUS * 2);
  const fillShape = tubeAlong(alongBar, 0, fillLen, BAR_RADIUS, BAR_RADIUS, 0);
  const fill = newGrid();
  markDiscs(fill, fillShape.discs, 0);
  return composite(logo, knock, [
    { grid: track, alpha: TRACK_ALPHA },
    { grid: fill, alpha: 1 },
  ]);
}

export function rasterizeFailed(logo: AlphaMask): AlphaMask {
  const knock = newGrid();
  markDiscs(knock, [[DOT[0], DOT[1], 7]], 0);
  const ring = newGrid();
  const rIn = FAILED_RING_RADIUS - FAILED_RING_STROKE / 2;
  const rOut = FAILED_RING_RADIUS + FAILED_RING_STROKE / 2;
  for (let gy = 0; gy < GRID; gy++) {
    for (let gx = 0; gx < GRID; gx++) {
      const d = Math.hypot((gx + 0.5) / SS - DOT[0], (gy + 0.5) / SS - DOT[1]);
      if (d >= rIn && d <= rOut) ring[gy * GRID + gx] = 1;
    }
  }
  return composite(logo, knock, [{ grid: ring, alpha: 1 }]);
}

/** The whole logo rotated about its centre, bilinear-sampled per supersample. */
export function rasterizeRotated(logo: AlphaMask, degrees: number): AlphaMask {
  const out = new Uint8Array(ICON_PX * ICON_PX);
  const rad = (-degrees * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const c = ICON_PX / 2;
  const sample = (x: number, y: number) => {
    // pixel centres sit at i + 0.5
    const fx = x - 0.5;
    const fy = y - 0.5;
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const tx = fx - x0;
    const ty = fy - y0;
    const v = (ix: number, iy: number) =>
      ix < 0 || iy < 0 || ix >= ICON_PX || iy >= ICON_PX
        ? 0
        : logo[iy * ICON_PX + ix];
    return (
      v(x0, y0) * (1 - tx) * (1 - ty) +
      v(x0 + 1, y0) * tx * (1 - ty) +
      v(x0, y0 + 1) * (1 - tx) * ty +
      v(x0 + 1, y0 + 1) * tx * ty
    );
  };
  for (let py = 0; py < ICON_PX; py++) {
    for (let px = 0; px < ICON_PX; px++) {
      let sum = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const dx = px + (sx + 0.5) / SS - c;
          const dy = py + (sy + 0.5) / SS - c;
          sum += sample(c + dx * cos - dy * sin, c + dx * sin + dy * cos);
        }
      }
      out[py * ICON_PX + px] = Math.round(sum / (SS * SS));
    }
  }
  return out;
}

export function spinAngles(): number[] {
  return Array.from({ length: SPIN_FRAMES }, (_, i) => (i * 360) / SPIN_FRAMES);
}

/** BGRA bitmap (black, alpha from the mask) for nativeImage.createFromBitmap. */
export function maskToBGRA(mask: AlphaMask): Buffer {
  const buf = Buffer.alloc(mask.length * 4);
  for (let i = 0; i < mask.length; i++) buf[i * 4 + 3] = mask[i];
  return buf;
}

/** Alpha channel of a 32x32 BGRA bitmap (as returned by nativeImage.toBitmap). */
export function alphaFromBGRA(bitmap: Uint8Array): AlphaMask {
  const out = new Uint8Array(ICON_PX * ICON_PX);
  for (let i = 0; i < out.length; i++) out[i] = bitmap[i * 4 + 3];
  return out;
}
