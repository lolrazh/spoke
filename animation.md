## 0. TL;DR – The 80/20 Fixes

If you do nothing else, try these in order:

1. **Remove CSS `transition-*` / `transition-all` utilities from any element (incl. `.pill-wrapper`) whose size/opacity/transform Framer Motion is animating.** Double animation controllers = flicker. Let Motion own the props; put plain styles in CSS. Tailwind’s `transition` utilities animate multiple properties and *will* interfere. ([buildui.com](https://buildui.com/courses/framer-motion-recipes/carousel-part-1), [framer.community](https://www.framer.community/c/support/animation-flickering?utm_source=chatgpt.com), [tailwindcss.com](https://tailwindcss.com/docs/transition-property?utm_source=chatgpt.com))
2. **Stop toggling layout-affecting CSS classes *and* Motion layout animation in the same frame.** Prefer a single declarative Motion animation driven by state; avoid mid‑animation class changes (like adding `resting-state` that itself changes height). Mixed layout + CSS can cause layout snap + flash. ([motion.dev](https://motion.dev/docs/react-animate-presence), [stackoverflow.com](https://stackoverflow.com/questions/76664336/why-is-there-a-slight-stutter-when-an-animatepresence-framer-div-is-removed))
3. **Consolidate all pill mode transitions in a finite state machine (FSM) that serializes events (dictation start/stop, notification show, hover, processing).** Predictable transitions remove race conditions & out‑of‑sync timers that produce ghost frames. XState (or a light reducer) is ideal here. ([blog.logrocket.com](https://blog.logrocket.com/using-state-machines-with-xstate-and-react/), [motion.dev](https://motion.dev/docs/react-animate-presence))
4. **Don’t resize the Electron BrowserWindow at high frequency during UI animations; animate inside the renderer, then commit a single resize if needed.** Frequent `setBounds` on a transparent, always‑on‑top window can cause compositor flashes on macOS. Use the “show gracefully / avoid flash” guidance in Electron docs & elevated always‑on‑top patterns. ([electronjs.org](https://electronjs.org/docs/latest/api/browser-window), [syobochim.medium.com](https://syobochim.medium.com/electron-keep-apps-on-top-whether-in-full-screen-mode-or-on-other-desktops-d7d914579fce))
5. **Normalize measured notification width (ghost measure) with a single measurement pass and lock animation targets before starting the transition.** Re‑measuring during animation can cause width jumping & re‑layout thrash (esp. with ResizeObserver). ([web.dev](https://web.dev/articles/resize-observer), [trackjs.com](https://trackjs.com/javascript-errors/resizeobserver-loop-completed-with-undelivered-notifications/))

Do the above, then re‑test. The remainder of this doc digs into *why* you’re seeing the double flicker, what to instrument, and how to engineer a clean “brain” for the pill.

---

## 1. Symptoms You Reported → What They Suggest

| #  | User‑Observed Symptom                                                             | Likely Technical Cause(s)                                                                                                                                 | Supporting Evidence / Notes                                                                                                                                                                                                                                                                                                                                                             |
| -- | --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S1 | "Double flicker" when starting dictation; a ghost pill pops then actual animation | CSS transition + Framer layout animation both firing; class swap triggers reflow; BrowserWindow Y slide concurrently                                      | Conflicts noted when CSS `transition` clashes w/ Framer Motion; Tailwind `transition-all` broad. ([buildui.com](https://buildui.com/courses/framer-motion-recipes/carousel-part-1), [framer.community](https://www.framer.community/c/support/animation-flickering?utm_source=chatgpt.com), [tailwindcss.com](https://tailwindcss.com/docs/transition-property?utm_source=chatgpt.com)) |
| S2 | Ghost pill at old width when switching to notification state                      | Width recalculated asynchronously (ResizeObserver) between shrink/show phases; also rest class adjusting height before width measured                     | ResizeObserver timing between layout & paint; loops if size changed in callback. ([web.dev](https://web.dev/articles/resize-observer), [trackjs.com](https://trackjs.com/javascript-errors/resizeobserver-loop-completed-with-undelivered-notifications/))                                                                                                                              |
| S3 | Flicker when notification ends & pill returns to resting                          | Simultaneous CSS & Motion exit; element keys & mode interplay in AnimatePresence; padding/margin effects causing momentary mis‑calc                       | AnimatePresence troubleshooting; layout + exit require care; margins/padding can produce stutter. ([motion.dev](https://motion.dev/docs/react-animate-presence), [stackoverflow.com](https://stackoverflow.com/questions/76664336/why-is-there-a-slight-stutter-when-an-animatepresence-framer-div-is-removed))                                                                         |
| S4 | Animations degrade after interruption (notification while listening)              | Competing state updates racing: timer‑driven notification shrink/show vs real‑time listening -> inconsistent height/width targets                         | Use FSM to serialize / guard transitions; XState patterns for complex UI flows. ([blog.logrocket.com](https://blog.logrocket.com/using-state-machines-with-xstate-and-react/), [motion.dev](https://motion.dev/docs/react-animate-presence))                                                                                                                                            |
| S5 | General jank w/ transparent always‑on‑top floating window                         | Frequent `setBounds` & `setAlwaysOnTop` interactions can cause macOS compositor flashes; show gracefully docs advise deferring visual updates until ready | Electron window mgmt notes; top‑of‑screen overlay patterns. ([electronjs.org](https://electronjs.org/docs/latest/api/browser-window), [syobochim.medium.com](https://syobochim.medium.com/electron-keep-apps-on-top-whether-in-full-screen-mode-or-on-other-desktops-d7d914579fce))                                                                                                     |

---

## 2. What Your Current Code Is Doing (Walkthrough)

Below is a simplified timeline derived from your snippet.

### 2.1 Actors

* **App.tsx** – owns high‑level pill visibility booleans (`isListening`, `isProcessing`, `notificationPlay`, `isHovered`). It also drives island slide IPC, notification timers, and debug HUD.
* **Pill.tsx** – derives `pillHeight` and `targetWidth` from props + ghost measurement; uses `motion.div layout` to animate; also adds Tailwind `transition-all` via class.
* **index.css** – defines `.pill-wrapper.transition-all` (via Tailwind) and `.resting-state` class that directly manipulates height & border radius.
* **Electron main** – on `island-slide` IPC, directly `setBounds` the BrowserWindow; on `pill-resize` (if used), also changes width/height natively.

### 2.2 Notification Flow (current)

1. Notification arrives -> `setNotificationPlay({phase:"shrinking"})`.
2. After `PILL_ANIMATION_DURATION` (300ms) we set `{phase:"showing"}`.
3. Ghost measure sees new text, updates span; ResizeObserver fires; width recomputed; Pill re‑renders; Framer Motion layout animates width & height.
4. After duration computed from word count, we `setNotificationPlay(null)`; Pill collapses if not listening.

During each step CSS classes and inline Motion styles both change layout properties.

---

## 3. Specific Collision Points

### 3.1 CSS `transition-all` + Motion Layout

Your `.pill-wrapper` (and other elements via Tailwind) include a utility like `transition-all duration-300`. Motion is already animating `width`/`height` via spring/ease. When the underlying DOM node also has a CSS transition on those props, the browser must reconcile two animation timelines. This frequently manifests as a “flash” at start/end or mid‑animation jank, exactly what you’re seeing. Build UI explicitly calls this out when adding Motion to Tailwind components: remove competing CSS transitions or isolate them to non‑animated props. ([buildui.com](https://buildui.com/courses/framer-motion-recipes/carousel-part-1), [framer.community](https://www.framer.community/c/support/animation-flickering?utm_source=chatgpt.com), [tailwindcss.com](https://tailwindcss.com/docs/transition-property?utm_source=chatgpt.com))

### 3.2 Layout Snap From Class Swaps

You toggle a `resting-state` class that directly alters height (CSS var) *while* simultaneously animating height in Motion. When these hit in the same frame, the browser may commit the class change instantly, then Motion animates from the new measured box causing a visible snap/flicker. AnimatePresence docs warn that mixing layout changes and exit/enter animations requires careful ordering; elements w/ margins/padding can introduce mis‑measurement & stutter. ([motion.dev](https://motion.dev/docs/react-animate-presence), [stackoverflow.com](https://stackoverflow.com/questions/76664336/why-is-there-a-slight-stutter-when-an-animatepresence-framer-div-is-removed))

### 3.3 Re‑measurement Jitter (ResizeObserver + ghost element)

`useGhostMeasure` writes new text into a hidden span, then a `ResizeObserver` callback updates width state, which re‑renders Pill and changes target width mid‑transition. Because ResizeObserver fires *between layout and paint* you can re‑enter layout if you mutate geometry in the callback (like calling setState that affects layout), producing cascaded reflows and occasional loops (observed as flicker). TrackJS and web.dev docs discuss this pattern and advise avoiding heavy writes in observer callbacks. ([web.dev](https://web.dev/articles/resize-observer), [trackjs.com](https://trackjs.com/javascript-errors/resizeobserver-loop-completed-with-undelivered-notifications/))

### 3.4 Racey Timers & Event Interleaving

Notification shrink/show is timer‑driven; listening state is event‑driven (PTT key). If a notification kicks off while the pill is expanding for listening (or vice‑versa), you get two conflicting layout targets within \~300ms. AnimatePresence supports sequencing (`mode="wait"`) or serialization of exit/enter; XState patterns show how to model mutually exclusive states so only one animation runs at a time. ([motion.dev](https://motion.dev/docs/react-animate-presence), [blog.logrocket.com](https://blog.logrocket.com/using-state-machines-with-xstate-and-react/))

### 3.5 Electron Window Bounds Jank

Every time `isPillVisible` changes you call `window.island.slideTo(targetY)` which IPCs to main, which calls `BrowserWindow.setBounds(...)`. Rapid bound changes on a transparent, always‑on‑top window can produce momentary OS compositor artifacts (ghost rectangle) until the GPU surface catches up—seen as a “ghost pill.” Electron docs recommend deferring visual updates until the webContents is ready and using show/hide/opacity strategies to avoid flash. Overlay apps often elevate to `screen-saver` level for reliability but still batch bound updates. ([electronjs.org](https://electronjs.org/docs/latest/api/browser-window), [syobochim.medium.com](https://syobochim.medium.com/electron-keep-apps-on-top-whether-in-full-screen-mode-or-on-other-desktops-d7d914579fce))

---

## 4. Target State Model (Proposed Pill FSM)

Let’s define crisp, mutually‑exclusive top‑level visual states:

```
IDLE (resting thin bar)
LISTENING (active waveform)
PROCESSING (animated dots)
NOTIF_SHRINK (compress to thin before showing text)
NOTIF_SHOW (expand to text‑width, show message)
HOVER_PREVIEW (static dots when hovered but idle)
```

Transitions (events):

* `PTT_DOWN` –> LISTENING (if allowed) else queue.
* `PTT_UP` –> PROCESSING (short) then IDLE or NOTIF\_SHRINK if notification queued.
* `TRANSCRIPTION_ERROR` –> NOTIF\_SHRINK → NOTIF\_SHOW(error text).
* `NOTIFY(text)` – if current LISTENING/PROCESSING then queue; else NOTIF\_SHRINK.
* `NOTIF_TIMEOUT` – from NOTIF\_SHOW → IDLE.
* `HOVER_ENTER`/`LEAVE` – toggles HOVER\_PREVIEW substate when in IDLE only.

This machine serializes transitions so you *never* animate width+height to two conflicting targets in the same frame. Use XState or a tiny reducer w/ `useMachine` shim. See LogRocket intro to XState for React integration & benefits (predictability, visualizer). ([blog.logrocket.com](https://blog.logrocket.com/using-state-machines-with-xstate-and-react/))

> Why not parallel states? Because we care about *rendered geometry*, which must be single‑source; we can still track orthogonal data (recording, processing, pendingNotif) in context but drive geometry from machine state.

---

## 5. Animation Specification Per State

Below are recommended geometry + Motion props; all numeric values easily tuned.

| State         | Width                                   | Height    | Content                   | Motion Transition             | Notes                                  |
| ------------- | --------------------------------------- | --------- | ------------------------- | ----------------------------- | -------------------------------------- |
| IDLE          | baseWidth (CSS var)                     | restingH  | empty / resting indicator | spring stiff 400 / damping 30 | No CSS transitions.                    |
| LISTENING     | baseWidth                               | expandedH | waveform bars             | spring (bouncy)               | Bars via `scaleY` transforms for perf. |
| PROCESSING    | baseWidth                               | expandedH | animated dots             | keyframes opacity/translateY  | Owned by Motion only.                  |
| NOTIF\_SHRINK | baseWidth                               | restingH  | (content hidden)          | timing ease-in 0.15s          | Fire `onComplete` -> measure text.     |
| NOTIF\_SHOW   | clamp(measuredWidth + pad, \[MIN, MAX]) | expandedH | text                      | timing ease-out 0.20s         | Pre‑measure width before entering.     |

Use Motion’s `animate` prop to drive width/height; no `layout` necessary if you’re fully specifying geometry numerically. If you *do* rely on layout = true, remove CSS layout transitions and avoid padding/margins on the animating node (StackOverflow stutter example). ([stackoverflow.com](https://stackoverflow.com/questions/76664336/why-is-there-a-slight-stutter-when-an-animatepresence-framer-div-is-removed), [buildui.com](https://buildui.com/courses/framer-motion-recipes/carousel-part-1))

---

## 6. Implementation Sketch (Reducer‑Style)

Below is an outline. (Pseudocode; we’ll refine when you’re ready.)

```ts
// pillMachine.ts
export type PillState =
  | {type:"IDLE"}
  | {type:"LISTENING"}
  | {type:"PROCESSING"}
  | {type:"NOTIF_SHRINK"; msg:string}
  | {type:"NOTIF_SHOW"; msg:string; w:number}
  | {type:"HOVER_PREVIEW"};

export type PillEvent =
  | {type:"PTT_START"}
  | {type:"PTT_STOP"}
  | {type:"NOTIFY"; msg:string}
  | {type:"MEASURED"; w:number}
  | {type:"ANIM_DONE"}
  | {type:"HOVER_ENTER"}|{type:"HOVER_LEAVE"};

// state + context {pendingNotif?:string}
// transitions enforce serialization: e.g., NOTIFY while LISTENING => ctx.pendingNotif = msg; wait until PROCESSING complete.
```

Use the machine as the *only* source passed to `Pill` (instead of separate boolean props). Motion variants keyed by `state.type` ensure deterministic transitions; see AnimatePresence guidance on using keys & variants. ([motion.dev](https://motion.dev/docs/react-animate-presence))

For machine authoring and visualization, see XState article (LogRocket) for pattern of sending events and deriving UI; great fit for multi‑phase animations. ([blog.logrocket.com](https://blog.logrocket.com/using-state-machines-with-xstate-and-react/))

---

## 7. Measuring Notification Width Safely

Current `useGhostMeasure` triggers a ResizeObserver that *immediately* sets width on change; this can fire multiple times as fonts load. Instead:

**Approach:**

1. On NOTIFY event, write text into ghost span *synchronously* (no animation yet).
2. In next animation frame (`requestAnimationFrame`), read `offsetWidth` once; store in machine context; dispatch `MEASURED` -> NOTIF\_SHOW.
3. During NOTIF\_SHOW you animate from baseWidth to measuredWidth; you *do not* update measured width again while animating.

This aligns with web.dev guidance to perform layout reads/writes in discrete phases & avoid thrashing; TrackJS article highlights how repeated ResizeObserver notifications can spiral when layout writes occur within callback loops. ([web.dev](https://web.dev/articles/resize-observer), [trackjs.com](https://trackjs.com/javascript-errors/resizeobserver-loop-completed-with-undelivered-notifications/))

---

## 8. Electron Window Movement Strategy

Instead of calling `slideTo` (IPC → `setBounds`) on every state change, try:

* Keep the BrowserWindow pinned at full expanded height; animate the pill’s Y *within* the renderer using CSS transform translateY (GPU accelerated, no OS compositor bounce).
* Or, debounce `setBounds` to run after a short idle (e.g., 200ms) when target state is stable.
* Use `ready-to-show` / show‑gracefully pattern from Electron docs to avoid flash when showing after hide. ([electronjs.org](https://electronjs.org/docs/latest/api/browser-window), [syobochim.medium.com](https://syobochim.medium.com/electron-keep-apps-on-top-whether-in-full-screen-mode-or-on-other-desktops-d7d914579fce))

---

## 9. Detailed Fix Checklist

Follow this sequence so you can isolate improvements.

### Phase A – Remove Conflicts

* [ ] Remove Tailwind `transition-*`, `duration-*`, `ease-*` classes from `.pill-wrapper`, `.pill-core`, and children animated by Motion. (Keep purely visual non‑animated properties.) ([buildui.com](https://buildui.com/courses/framer-motion-recipes/carousel-part-1), [tailwindcss.com](https://tailwindcss.com/docs/transition-property?utm_source=chatgpt.com))
* [ ] Remove `.resting-state .pill-core {height:...}` height mutation; let Motion drive height.
* [ ] Ensure animating node has stable `display:flex` (helps width animation flash issues seen in Motion Q\&A). ([stackoverflow.com](https://stackoverflow.com/questions/76664336/why-is-there-a-slight-stutter-when-an-animatepresence-framer-div-is-removed))

### Phase B – Introduce Pill Machine

* [ ] Implement pillMachine reducer.
* [ ] Replace scattered booleans w/ `state.type`.
* [ ] Use Motion variants per state (width, height, opacity for visuals/text).
* [ ] Use `mode="wait"` in AnimatePresence around notification text so shrink completes before show (sequenced). ([motion.dev](https://motion.dev/docs/react-animate-presence))

### Phase C – Safe Measurement

* [ ] Ghost measure once on NOTIFY; store width; do *not* re‑measure until next notification. ([web.dev](https://web.dev/articles/resize-observer), [trackjs.com](https://trackjs.com/javascript-errors/resizeobserver-loop-completed-with-undelivered-notifications/))

### Phase D – Electron Window Hygiene

* [ ] Debounce / drop intermediate `slideTo` calls if multiple state changes within 100ms.
* [ ] Consider rendering pill in a taller window and just translateY; rely less on `setBounds`. ([electronjs.org](https://electronjs.org/docs/latest/api/browser-window), [syobochim.medium.com](https://syobochim.medium.com/electron-keep-apps-on-top-whether-in-full-screen-mode-or-on-other-desktops-d7d914579fce))

---

## 10. Instrumentation & Debugging

Add a lightweight visual trace overlay:

```tsx
// inside App
const [trace, setTrace] = useState<string[]>([]);
const push = (msg:string)=>setTrace(t=>[`${performance.now().toFixed(0)}: ${msg}`,...t.slice(0,15)]);

// call push("PTT_START"), push("NOTIFY text") etc.
```

Render the last N events in your existing debug HUD to correlate with flickers.

Also log the geometry values Motion is animating (`onUpdate` prop) to confirm no mid‑flight jumps.

Use DevTools performance record; watch layout thrash counts; TrackJS article shows how to inspect ResizeObserver spam. ([trackjs.com](https://trackjs.com/javascript-errors/resizeobserver-loop-completed-with-undelivered-notifications/))

---

## 11. Example Refactored Pill (Excerpt)

*(Minimal example – not complete; shows pattern of variant‑driven geometry & sequenced notification)*

```tsx
// variants.ts
export const pillVariants = {
  IDLE: ({wBase, hRest}) => ({ width:wBase, height:hRest }),
  LISTENING: ({wBase, hExp}) => ({ width:wBase, height:hExp }),
  PROCESSING: ({wBase, hExp}) => ({ width:wBase, height:hExp }),
  NOTIF_SHRINK: ({wBase, hRest}) => ({ width:wBase, height:hRest }),
  NOTIF_SHOW: ({wNotif, hExp}) => ({ width:wNotif, height:hExp }),
};
```

```tsx
<motion.div
  key={state.type === 'NOTIF_SHOW' ? 'notif' : 'pill'}
  variants={pillVariants}
  custom={{wBase, hRest, hExp, wNotif}}
  animate={state.type}
  initial={false}
  transition={{duration:0.2, ease:[0.32,0.72,0,1]}}
>
  {state.type === 'NOTIF_SHOW' ? (
    <motion.span
      initial={{opacity:0}}
      animate={{opacity:1}}
      exit={{opacity:0}}
    >{state.msg}</motion.span>
  ) : (
    <Visualizer state={state.type} />
  )}
</motion.div>
```

Note: `initial={false}` prevents initial mount animation if you don’t want the first render flicker; recommended when children present at mount per AnimatePresence docs. ([motion.dev](https://motion.dev/docs/react-animate-presence))

---

## 12. Testing Interruption Scenarios

Test matrix after refactor:

| Case                       | Steps                                                                  | Expected                                                                                                  |
| -------------------------- | ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Dictation → Notification   | Hold Fn (start) → Release (stop) → Server returns text triggers NOTIFY | Pill: LISTENING -> PROCESSING -> NOTIF\_SHRINK -> NOTIF\_SHOW -> IDLE. No double width flicker.           |
| Hover Idle                 | Idle → Hover                                                           | Expand once; static dots; leaving hover returns to IDLE w/out flicker.                                    |
| Notification During Listen | Start LISTENING, trigger NOTIFY                                        | Add to queue; continue LISTENING; when stop -> PROCESSING -> NOTIF\_SHRINK queued message -> NOTIF\_SHOW. |
| Rapid Notifications        | Fire 3 NOTIFY in 1s                                                    | Queue, show sequentially; width measured for each before showing.                                         |

---

## 13. Appendix: Source Highlights

### CSS / Motion transition conflicts -> flicker

Build UI course shows Tailwind `transition` classes causing “jankiness”; removing them resolved flicker when Framer Motion animates same properties. ([buildui.com](https://buildui.com/courses/framer-motion-recipes/carousel-part-1))

Framer Community thread: user fixed animation flickering by removing `transition: all` CSS that interfered with Motion. ([framer.community](https://www.framer.community/c/support/animation-flickering?utm_source=chatgpt.com))

Tailwind docs: `transition` utility applies property transitions (or `all`), so if you leave it you’re asking CSS to animate width/height/opacity alongside Motion. ([tailwindcss.com](https://tailwindcss.com/docs/transition-property?utm_source=chatgpt.com))

### Layout + Exit animation sequencing / keys / mode

AnimatePresence docs: ensure unique keys, choose `mode` (sync/wait/popLayout), wrap layout groups properly, avoid unmounting AnimatePresence itself; `mode="wait"` sequences entry after exit to prevent overlap. ([motion.dev](https://motion.dev/docs/react-animate-presence))

### Margins/padding affecting measurement & stutter

SO discussion: stutter due to Motion measuring height without padding/margins; move spacing to inner wrapper to smooth animation. Relevant when animating pill height. ([stackoverflow.com](https://stackoverflow.com/questions/76664336/why-is-there-a-slight-stutter-when-an-animatepresence-framer-div-is-removed))

### ResizeObserver timing & layout loops

web.dev article explains RO fires between layout & paint; writing layout in callback triggers more notifications; handle carefully to avoid thrash. ([web.dev](https://web.dev/articles/resize-observer))

TrackJS guide: diagnosing RO loop errors; flags layout thrashing in callbacks—relevant to ghost measurement jitter. ([trackjs.com](https://trackjs.com/javascript-errors/resizeobserver-loop-completed-with-undelivered-notifications/))

### State machine benefits for complex UI flows

LogRocket XState guide: finite state machines make UI predictable & easier to debug; great for complex interaction flows like yours. ([blog.logrocket.com](https://blog.logrocket.com/using-state-machines-with-xstate-and-react/))

### Electron overlay window best practices

Electron BrowserWindow docs: show window gracefully to avoid visual flash when loading; manage visibility updates carefully. ([electronjs.org](https://electronjs.org/docs/latest/api/browser-window))

Medium overlay article: using `setAlwaysOnTop(true, "screen-saver")` & `setVisibleOnAllWorkspaces` for reliable Mac overlays; suggests sequencing window operations. ([syobochim.medium.com](https://syobochim.medium.com/electron-keep-apps-on-top-whether-in-full-screen-mode-or-on-other-desktops-d7d914579fce))

---