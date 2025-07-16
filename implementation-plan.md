# Sonic Flow Dynamic Pill — Production Implementation Plan

**Date:** July 16, 2025 (Asia/Kolkata)
**Author:** ChatGPT collaborating with Sandheep

---

## 0. Why This Plan Exists

Your adaptive “pill” (Dynamic‑Island‑style dictation UI) must resize to notification text, stay perfectly aligned below the MacBook notch, never block underlying app clicks, and scale toward richer panel modes—all without jank or off‑by‑one Retina glitches. The current behavior fails to auto‑size reliably because measurement, animation, and native window geometry are out of sync; transparent window hit‑testing further degrades UX. This plan consolidates the best insights from our prior deep dives and ranks, and turns them into a **sequenced set of small, reviewable commits** you can ship safely.

---

## 1. Executive TL;DR (Decision Snapshot)

**Do first:**

1. Add instrumentation (see real widths, heights, window bounds, scaleFactor).
2. Measure notification text **outside** the animated pill using a ghost span + `ResizeObserver`; clamp width.
3. Debounced IPC to resize native window *after* measurement; round to integer DIPs.
4. Toggle `setIgnoreMouseEvents(true,{forward:true})` when pill is resting to restore click‑through transparency.
5. Recenter & notch‑safe vertical placement using `screen.getPrimaryDisplay().workArea` delta.
6. Add overflow handling (fade / marquee) beyond max width.
7. Prepare mode machine so pill can later expand into panel without redesign.

---

## 2. Architecture Overview

Below is the steady‑state data flow we are building toward.

```
Main Process ──IPC→ Renderer(App) ──state→ Pill
   ▲                                   │
   │        measured width/height ◀────┘ (ghost measurer + ResizeObserver)
   │
Native Window geometry sync (debounced)
   │
Hit‑testing mode (ignore or interactive)
```

Key rules:

* **Renderer is source of truth for visible content size.** Measure DOM, clamp, then notify main.
* **Main repositions & resizes native window using integer DIPs + animate=true.** Recenter each time.
* **Hit‑testing toggled from renderer (hover/active) to let clicks fall through when idle.** Transparent windows still intercept events unless ignored. citeturn0search7turn0search0turn0search14
* **No measuring inside a constrained element.** Use an off‑layout ghost element (see §5). This avoids self‑limiting width reads that plagued the current pill.
* **Listen to layout changes via `ResizeObserver` (fonts, DPI, CSS changes) not just state transitions.** citeturn0search3turn0search29
* **Use layout‑aware animation primitives (Framer Motion `layout` or CSS transitions) to reduce DOM/OS desync and layout jumpiness.** citeturn0search4turn0search18

---

## 3. Versioning & Compatibility Assumptions

* Electron ≥ **28.x** (adjust if your project differs; confirm API signatures before merge).
* macOS Sonoma / Ventura baseline; test on Intel + Apple Silicon.
* High DPI (Retina) primary display; at least one 1× external display for QA.
* You currently build via Vite → Electron preload bridging.
* Renderer: React 18 + Framer Motion.

**Why we care about DPI & transparent window behavior:** Transparent frameless windows have historical quirks—size rounding, resizability limits, and hit‑test oddities vary by platform; integer rounding and ignore‑mouse‑events are recommended mitigations. citeturn0search7turn0search34

---

## 4. Milestone Roadmap (Git Commit Series)

Each milestone is intentionally small, testable, and reversible. Ship one PR per milestone.

| Milestone | Title                           | Core Change                                                  | Primary Risk                      | Gate to Merge                               |
| --------- | ------------------------------- | ------------------------------------------------------------ | --------------------------------- | ------------------------------------------- |
| A         | Instrument Everything           | Log DOM + window geometry, scaleFactor, safe‑area delta      | None                              | Logs show correct numbers & update on notif |
| B         | Tokenized Pill Dimensions       | Shared TS tokens + CSS var validation                        | Breaking CSS if mismatch          | Console warns & values match ±2px           |
| C         | Ghost Measurer + ResizeObserver | Measure text outside pill; live updates                      | Over‑measure hidden el            | Resize matches text across font loads       |
| D         | Declarative Layout Sync         | Framer Motion `layout` (or CSS transitions) + measured state | Animation regressions             | Visual smoothness; no jumps                 |
| E         | Native Window Resize Debounced  | IPC width+height; integer DIPs; animate                      | Flicker on fast bursts            | Max 1 IPC/frame; no half‑cut                |
| F         | Click‑Through Idle              | setIgnoreMouseEvents toggle & hover gating                   | Pill becomes unclickable if wrong | Manual QA passes click‑through              |
| G         | Notch‑Aware Positioning         | Use workArea delta; user offset pref                         | Multi‑display mismatch            | Pill stays visible below notch              |
| H         | Overflow Handling               | Clamp + fade or marquee long text                            | Motion perf                       | Long messages readable; no growth past max  |
| I         | Mode Machine (Panel)            | Extend state machine; panel prototype                        | Complexity creep                  | Feature flag; no regressions                |
| J         | QA Harness & Regression Tests   | Automated sequences & screenshot diff                        | Test flake                        | CI artifact baseline                        |

---

## 5. Milestone A — Instrument Everything

**Goal:** See what the system *thinks* its sizes are—DOM vs native window vs scaleFactor vs safe area.

### 5.1 Renderer Instrumentation

Add a dev toggle (`?debugPill=1` or keyboard chord) that overlays a small telemetry HUD:

* Text ghost width (px)
* Pill visual width/height (`getBoundingClientRect()`)
* Notification length (#chars, #words)
* devicePixelRatio
* Current hit‑test mode (interactive/pass‑through)

### 5.2 Main Process Logging

In `main.ts` centralize geometry calls and log before/after:

```ts
function logBounds(tag:string){
  if(!mainWindow) return;
  const b = mainWindow.getBounds();
  const [cw,ch] = mainWindow.getContentSize();
  console.log(`[${tag}] bounds=%o content=%o`, b, {w:cw,h:ch});
}
```

Emit logs after every `setBounds` or `setContentSize`. Electron surfaces both logical (DIP) bounds and content size; helpful when debugging DPI scaling. citeturn0search1turn0search2

### 5.3 Safe‑Area Delta Probe

Compare `display.bounds.y` with `display.workArea.y`; the delta approximates menu‑bar/notch inset on macOS. citeturn0search2turn0search28

**Exit Criteria:** Trigger three notifications (short/med/long). Logs show changing ghost width; native window logs reflect requested width; no crashes.

---

## 6. Milestone B — Tokenized Pill Dimensions & CSS Var Validation

Today you read CSS vars at module load; sometimes they parse as empty → 0.

### 6.1 Create `uiTokens.ts`

Export canonical numeric defaults:

```ts
export const TOKENS = {
  PILL_BASE_W: 207,
  PILL_BASE_H: 30,
  PILL_RESTING_H: 9,
  PILL_MAX_W: 560,
  NOTIF_PAD_X: 40,
};
```

### 6.2 Runtime CSS Validation

After first paint, read computed CSS vars; warn if mismatch >2px. This guards build regressions.

### 6.3 Fallback Use

Anywhere you previously used `getCssVar`, use tokens and *optionally* override with CSS var if parseable.

**Why:** Reading computed styles before Tailwind injects can return empty strings; robust fallback avoids 0‑width animation spikes. (General CSS runtime behavior; good practice; layout sync guidance echoed in Motion docs re: layout measurement order.) citeturn0search4

---

## 7. Milestone C — Ghost Measurer + ResizeObserver (Core Fix)

**Problem fixed here:** Measuring the notification span *inside* the pill which is currently width‑constrained returns a falsely small width; you then never grow. Move measurement out of flow and observe it.

### 7.1 Ghost Element

Place once at app root:

```tsx
<span id="pill-ghost-measure" className="notification-text fixed left-[-9999px] top-[-9999px] pointer-events-none whitespace-nowrap" />
```

### 7.2 Measurement Hook

```ts
function useGhostMeasure(text:string){
  const [w,setW]=useState(0);
  useLayoutEffect(()=>{
    const el=document.getElementById('pill-ghost-measure') as HTMLSpanElement | null;
    if(!el) return;
    el.textContent=text||'';
    const ro=new ResizeObserver(([entry])=>{
      setW(Math.ceil(entry.contentRect.width));
    });
    ro.observe(el);
    // Prime immediately
    setW(Math.ceil(el.offsetWidth));
    return()=>ro.disconnect();
  },[text]);
  return w;
}
```

`ResizeObserver` reliably reports element box changes triggered by font loads, style changes, and content edits—cases a one‑time read would miss. citeturn0search3turn0search29

### 7.3 Clamp Logic in Pill

```ts
const ghostW = useGhostMeasure(notificationPlay?.text ?? '');
const targetW = useMemo(()=>{
  const pad = TOKENS.NOTIF_PAD_X;
  const raw = ghostW + pad;
  return Math.max(TOKENS.PILL_BASE_W, Math.min(raw, TOKENS.PILL_MAX_W));
},[ghostW]);
```

**Exit Criteria:** With DevTools font overrides ON/OFF, pill resizes correctly; measurement updates without reload.

---

## 8. Milestone D — Declarative Layout Sync (Framer Motion or CSS)

You currently animate explicit width/height props. Framer Motion’s `layout` prop can interpolate between measured sizes based on actual layout delta—reducing jitter and manual state churn. Alternatively, pure‑CSS transitions on width/height work if you want to reduce Motion overhead; Motion gives richer choreography (frequency bars → notification fade) so we keep it.

### 8.1 Minimal Motion Update

```tsx
<motion.div layout className="pill-core" transition={{duration:0.3,ease:"easeInOut"}}>
  ...
</motion.div>
```

Setting `layout` instructs Motion to animate between layout measurements rather than guessing transforms; helps when content size changes after new text renders. citeturn0search4turn0search18

### 8.2 Guarded Direct Width Binding

Bind measured `targetW` via inline style or prop; Motion diffing + layout handles interpolation.

**Exit Criteria:** Width changes animate smoothly even when rapidly firing multiple notifications.

---

## 9. Milestone E — Native Window Resize Debounced & DPI‑Safe

Transparent windows + frequent `setBounds` calls can flicker; macOS emits `resized` after animated bounds updates; integer DIPs avoid half‑pixel crop. citeturn0search1turn0search7turn0search34

### 9.1 IPC Payload

Switch from width‑only to object:

```ts
window.electron.resizePill({width:targetW, height:targetH});
```

### 9.2 Debounce in Main

```ts
let resizeRaf:NodeJS.Timeout|undefined;
ipcMain.on('pill-resize',(_e,{width,height})=>{
  if(resizeRaf) cancelAnimationFrame(resizeRaf as any);
  resizeRaf = requestAnimationFrame(()=>{
    if(!mainWindow) return;
    const d = screen.getPrimaryDisplay();
    const x = Math.round((d.size.width - width)/2);
    const y = currentY(); // track elsewhere
    mainWindow.setBounds({x,y,width:Math.round(width),height:Math.round(height)}, true);
    if(process.platform==='darwin') mainWindow.invalidateShadow();
    logBounds('pill-resize');
  });
});
```

Electron’s BrowserWindow docs describe `setBounds` and `animate` on macOS, and window customization guidance recommends careful management of transparent window sizing. citeturn0search1turn0search7

### 9.3 DPI Consideration

If you mix logical sizes with device pixels, `screen` module returns display scale; in most cases use logical DIPs + rounding; rely on Chromium’s scaling. Use `display.scaleFactor` if doing advanced pixel math. citeturn0search2turn0search28

**Exit Criteria:** Rapid notification spam produces max 1 resize/animation frame; no visible flicker; logs show integer bounds.

---

## 10. Milestone F — Click‑Through Transparency (Idle / Resting)

Transparent BrowserWindows still intercept mouse events over invisible regions unless instructed to ignore them. Use `BrowserWindow.setIgnoreMouseEvents(ignore,{forward:true})` to allow underlying app interaction while still receiving move/enter events when needed. citeturn0search7turn0search0turn0search14

### 10.1 Preload Bridge

```ts
contextBridge.exposeInMainWorld('hitTest',{setInteractive:(v:boolean)=>ipcRenderer.send('pill-hit',v)});
```

### 10.2 Main Handler

```ts
ipcMain.on('pill-hit',(_e,interactive:boolean)=>{
  if(!mainWindow) return;
  if(interactive){
    mainWindow.setIgnoreMouseEvents(false);
  }else{
    mainWindow.setIgnoreMouseEvents(true,{forward:true});
  }
});
```

### 10.3 Renderer Toggle

In `Pill` hover handlers: interactive when hovered or listening; pass‑through when fully resting.

**Exit Criteria:** With pill resting, clicks on Safari tabs directly beneath succeed; hovering pill restores clickability for dictation.

---

## 11. Milestone G — Notch‑Aware Positioning

macOS notch + menu bar produce reduced usable top area. You can approximate safe inset by comparing `display.bounds` vs `display.workArea`, then subtract a margin. Electron `screen` and `Display` docs expose both metrics. citeturn0search2turn0search28

### 11.1 Compute Safe Top Once

```ts
function computeTopInset(){
  const d = screen.getPrimaryDisplay();
  return d.workArea.y - d.bounds.y; // px reserved by menu bar/notch
}
```

### 11.2 User Adjustable Offset

Persist user override (+/‑ px) if pill appears visually cramped or colliding with menu icons.

### 11.3 Recompute on Display Change

Listen to `screen.on('display-metrics-changed', …)`; reposition pill.

**Exit Criteria:** Pill always visible below notch on notched MacBook; consistent when external display active.

---

## 12. Milestone H — Overflow Handling (Clamp + Marquee / Fade)

After clamp to `PILL_MAX_W`, overflow text must remain readable without stretching pill.

### 12.1 Detect Overflow

```ts
const needsOverflow = ghostW + TOKENS.NOTIF_PAD_X > TOKENS.PILL_MAX_W;
```

### 12.2 Strategy Options

**A. Fade Mask + Hover Reveal** (preferred for subtlety).
**B. Continuous Marquee** duplicating content for seamless loop (Ben Nadel, Ryan Mulligan patterns). citeturn0search5turn0search12

### 12.3 CSS Marquee Example

```css
.pill-marquee{overflow:hidden;white-space:nowrap;position:relative;}
.pill-marquee-inner{display:inline-block;will-change:transform;animation:pill-marq 10s linear infinite;}
@keyframes pill-marq{to{transform:translateX(-50%);}}
```

Duplicate content inside `.pill-marquee-inner` for gapless loop per the modern marquee patterns. citeturn0search5turn0search12

**Exit Criteria:** 200‑char notification animates; pill width capped; CPU remains low.

---

## 13. Milestone I — Mode Machine (Toward Panel / ¼ Screen)

Extend pill state to support future expansion without re‑architecture.

### 13.1 State Enum

```ts
type PillMode = 'resting'|'listening'|'processing'|'notification'|'panel';
```

### 13.2 Geometry Contract

Renderer calculates *desired content rect* per mode:

* Resting: baseW × restingH.
* Listening: baseW × expandedH.
* Notification: measured clamp.
* Panel: min(screenW\*0.25, userPrefW) × autoHeight (capped).

### 13.3 Layout Animation

Use Motion layout transitions between modes; this preserves flow of child visuals. Motion docs outline animating width/height via layout to avoid distortion. citeturn0search4turn0search18

### 13.4 Hit‑Test Policy Table

| Mode         | Ignore Mouse?                  | Esc/Click Outside Behavior |
| ------------ | ------------------------------ | -------------------------- |
| Resting      | true                           | n/a                        |
| Listening    | false                          | stop dictation             |
| Notification | false during show, auto revert | dismiss                    |
| Panel        | false                          | collapse to resting        |

---

## 14. Milestone J — QA Harness & Regression Suite

Automate the flows we just stabilized.

### 14.1 Scripted Notification Burst

Fire sequence: 5‑char, 40‑char, 200‑char, empty error, back‑to‑back 3 short messages. Assert final pill width progression monotonic; no stuck states.

### 14.2 Multi‑Display Rotation

Simulate change primary display; ensure safe inset recomputed. Use `screen` module events for instrumentation. citeturn0search2

### 14.3 Transparency Hit Test

Robot‑click underlying window coordinates when resting; expect underlying app to focus. Use `setIgnoreMouseEvents` toggling per Electron customization docs. citeturn0search7turn0search14

---

## 15. Integration Points & Code Tree Touch Map

**Files touched:**

* `src/main.ts` — centralize geometry IPC, hit‑test toggle, notch offset, debounced resize.
* `src/preload.ts` — expose `resizePill({w,h})`, `hitTest.setInteractive(bool)`.
* `src/components/App.tsx` — debug HUD, mode wiring, safe top injection.
* `src/components/Pill.tsx` — ghost measure hook usage, layout animations, hover interactive toggle, overflow markup.
* `src/constants/uiTokens.ts` — dimension tokens.
* `src/styles/index.css` — pill transitions, marquee classes, debug outlines.

---

## 16. Risk Register & Mitigations

| Risk                              | Likelihood | Impact        | Mitigation                                      | Detected By          |
| --------------------------------- | ---------- | ------------- | ----------------------------------------------- | -------------------- |
| Resize storm spams IPC            | Med        | Perf hit      | RAF debounce; width diff guard                  | Log volume alarm     |
| Ghost measure wrong font metrics  | Low        | Bad width     | Use same class tokens; observe font load events | Visual QA            |
| Click‑through stuck interactive   | Low        | Users blocked | Force idle timeout to auto ignore               | Telemetry ping       |
| Notch calc wrong on some displays | Med        | Pill hidden   | User override UI; fallback to Y=0 + margin      | Metrics on Y changes |
| Marquee perf on long strings      | Low        | CPU           | Prefers fade; throttle char count               | Perf sample          |

---

## 17. Rollout Strategy

1. **Dev channel**: Enable debug HUD, verbose logs.
2. **Internal dogfood**: Engineers capture screen recordings across devices; file cut/flicker bugs.
3. **Gradual rollout flag**: Ship ghost measurement + clamp behind feature flag; fallback to old fixed width on failure.
4. **Metrics**: Count notifications > base width; measure IPC resize frequency; capture error rates from `hitTest` channel.

---

## 18. Implementation Checklists (Copy/Paste Friendly)

### Checklist A — After Milestone C (Ghost Measure) Should Pass

* [ ] Ghost element exists & hidden off‑screen.
* [ ] Sending 10, 50, 200 char strings yields growing targetW logs.
* [ ] Pill visually grows; no console NaNs.

### Checklist B — After Milestone F (Click‑Through)

* [ ] Hover pill → interactive.
* [ ] Move off pill (resting) → click Safari tab underneath works.
* [ ] Logging shows `setIgnoreMouseEvents(true,{forward:true})` fired.

### Checklist C — Regression Sweep Before Panel Work

* [ ] Notification appears during active listen mode (edge overlap) works.
* [ ] Rapid toggling Fn key doesn’t freeze width.
* [ ] Device scaleFactor switch stable.

---

## 19. Code Snippet Appendix

*(Representative excerpts; adjust paths per your repo.)*

### 19.1 Preload: Bridges

```ts
// preload.ts
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('pillElectron', {
  resize: (w:number,h:number)=>ipcRenderer.send('pill-resize',{width:w,height:h}),
  moveY: (y:number)=>ipcRenderer.send('pill-move-y',y),
});

contextBridge.exposeInMainWorld('hitTest', {
  setInteractive: (interactive:boolean)=>ipcRenderer.send('pill-hit',interactive),
});
```

### 19.2 Main: Geometry Handlers

```ts
ipcMain.on('pill-resize',(_e,{width,height})=>{
  scheduleResize(width,height);
});

function scheduleResize(width:number,height:number){
  cancelAnimationFrame(resizeRaf as any);
  resizeRaf=requestAnimationFrame(()=>applyResize(width,height));
}

function applyResize(width:number,height:number){
  if(!mainWindow) return;
  const d = screen.getPrimaryDisplay();
  const x = Math.round((d.size.width - width)/2);
  const y = currentPillY();
  mainWindow.setBounds({x,y,width:Math.round(width),height:Math.round(height)},true);
  if(process.platform==='darwin') mainWindow.invalidateShadow();
  logBounds('applyResize');
}
```

### 19.3 Main: Hit Testing

```ts
ipcMain.on('pill-hit',(_e,interactive:boolean)=>{
  if(!mainWindow) return;
  if(interactive){
    mainWindow.setIgnoreMouseEvents(false);
  }else{
    mainWindow.setIgnoreMouseEvents(true,{forward:true});
  }
});
```

Electron documents forwarding mouse events from ignore mode; community threads show this pattern for click‑through overlays. citeturn0search7turn0search14turn0search0

### 19.4 Renderer: Hover → Hit‑Test Toggle

```ts
const handleEnter=()=>window.hitTest.setInteractive(true);
const handleLeave=()=>window.hitTest.setInteractive(false);

return (
  <div className="pill-wrapper" onMouseEnter={handleEnter} onMouseLeave={handleLeave}>
    ...
  </div>
);
```

---

## 20. Visual QA Tips

* Enable outline debug: `.pill-core{outline:1px solid rgba(0,255,255,.6);}`; `.pill-wrapper{outline:1px dashed magenta;}` to see padding bleed.
* Use Chrome’s Rendering tools to paint flashing; check layout thrash.
* Record in slow‑mo (QuickTime 120fps) to catch 1‑frame crops near notch.

---

## 21. Open Follow‑Ups / Parking Lot

* **Accessibility:** VoiceOver focus? Should pill be ARIA live region when notification shows?
* **Reduced Motion Pref:** Honor macOS reduced motion by shortening animation distance or skipping shrink stage.
* **Theming:** Contrast check vs dark/light backgrounds; optional tinted translucency; see WCAG background contrast notes. (General CSS background/color guidance.) citeturn0search7turn0search5

---

## 22. Ready to Build

Pick Milestone A and ping me with logs; we’ll diff expected vs actual and march forward.

**Which milestone do you want to start coding now?**