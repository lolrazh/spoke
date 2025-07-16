# Sonic Flow Pill Notification Debug Plan

## TL;DR (Working Hypothesis)

Between the **PROCESSING → NOTIFICATION** transition, Framer Motion is asked to animate the pill’s width from a *known numeric* value (207px) to **`width: auto`** while simultaneously swapping children (visualizer → notification text) and while CSS at `.pill-core` is also trying to control width via an *unset CSS var* (`var(--pill-width)`). This creates a layout measurement race: the element temporarily resolves to a collapsed intrinsic width (near 0) before Framer re-computes layout based on the new content, so you see the “implosion” in X just before the notification expands to the correct measured width.

**Primary fix:** Pre‑measure the notification text, then animate to a **numeric width** (pixel value) rather than `'auto'`, and remove/neutralize the conflicting `width: var(--pill-width)` in CSS (or give it a safe fallback).

Below I’ll walk through first‑principles debugging to validate this, show how to instrument, and then propose a concrete patch.

---

## 1. Symptom Restatement (From Your Description)

1. Dictation starts → pill expands to active/listening. ✅
2. Dictation stops → pill goes to loading/processing. ✅
3. After transcription & paste, pill should **return to resting**, *then* briefly show a notification whose width adapts to text, *then* shrink back to resting. ✅ (intended)
4. Actual: After processing completes, the pill **shrinks horizontally to almost zero** (implodes) *before* the notification correctly appears at its measured width, then it shrinks back to resting properly. ❌

Notably, the **final notification width** is correct — so the dynamic sizing code *can* compute the width; the glitch is the in‑between layout state.

---

## 2. State Machine Review

You’ve got a clean reducer‑based FSM in `App.tsx`:

```ts
IDLE → PTT_START → LISTENING
LISTENING → PTT_STOP → PROCESSING
PROCESSING → PROCESSING_COMPLETE → IDLE or NOTIFICATION (if pendingNotif)
NOTIFICATION → ANIM_DONE → IDLE
IDLE → NOTIFY → NOTIFICATION
```

Important reducer snippet (PROCESSING case):

```ts
case 'PROCESSING':
  if (event.type === 'PROCESSING_COMPLETE') {
    if (state.context.pendingNotif) {
      return { state: 'NOTIFICATION', context: { notifMsg: state.context.pendingNotif, pendingNotif: undefined } };
    }
    return { ...state, state: 'IDLE' };
  }
  return state;
```

And you enqueue the notification while still in PROCESSING:

* `useTranscription.stop()` does the network call.
* On success it calls `window.notifications.send("Text pasted")`.
* Your `App` hooks a listener: `pillDispatch({ type: 'NOTIFY', msg })`.
* In the reducer’s PROCESSING state, `NOTIFY` is *ignored* but the msg is saved in `pendingNotif`.
* When transcription finishes you dispatch `PROCESSING_COMPLETE`, which sees `pendingNotif` and transitions directly to `NOTIFICATION`.

➡️ **So the intended sequence is `PROCESSING` → `NOTIFICATION` (skipping `IDLE`).** That means the implosion you see is **not** caused by an intermediate reducer transition to `IDLE`. Good — we can focus on layout/animation issues.

---

## 3. Rendering Layers & Potential Conflicts

Let’s map all the places that influence pill **size**:

| Layer                  | Code                                                                   | Controls width?                                                                                         | Notes                                                                                 |
| ---------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| CSS                    | `.pill-core { width: var(--pill-width); height: var(--pill-height); }` | Yes (if vars resolve)                                                                                   | Vars never set → invalid → property ignored → falls back to auto. This is important.  |
| Framer Motion variants | `pillVariants`                                                         | Yes                                                                                                     | Each state sets numeric `width` **except** `NOTIFICATION` which sets `width: 'auto'`. |
| React content          | visualizer container (75% width) vs notification `<span>`              | Affects intrinsic content width                                                                         | When swapping children, intrinsic width changes drastically.                          |
| Layout animation       | `<motion.div layout ...>`                                              | Framer will measure layout before & after; with `width: auto` it must derive size from DOM measurement. |                                                                                       |
| App metrics callback   | `onMetrics(pillRect)`                                                  | Observational only (doesn’t drive layout).                                                              |                                                                                       |

**Key red flags:**

* **Mixed control of width** (CSS var + Framer inline style + layout prop).
* **`width: 'auto'`** in Framer variant combined with `<motion.div layout>` can produce one frame where size is measured at old child layout but new width style overrides/clears, yielding 0.
* **Child swap** (AnimatePresence) happens at the same transition.

---

## 4. Timeline Hypothesis (Frame‑By‑Frame)

**Frame A** – PROCESSING: width fixed at 207px; child = visualizer container (flex, 75% width of pill).

**Event** – `PROCESSING_COMPLETE` → reducer sets state NOTIFICATION; `pillContext.notifMsg` becomes defined → React rerender.

**Frame B (Pre‑layout commit)** – Framer receives variant change: `width: 'auto'`. It must drop the explicit numeric width it was animating and measure intrinsic size. At the same render, AnimatePresence switches key from `visualizer` to `notification` but the new span may not yet have text width measured (or we crossfade with `opacity` only).

Because `.pill-core` CSS width var is invalid, underlying CSS width collapses to **auto**; but the element is a flex item inside `.pill-wrapper` which has `display:flex; align-items:center; justify-content:center;`. A flex item with `auto` width in a center-justified container whose contents are (for one frame) either exiting or at 0 opacity (but measured w=0) → computed width can go near *content min size*, i.e., very small. You perceive this as the pill imploding.

**Frame C** – Once browser measures the notification text, the intrinsic width increases; Framer animates to match and you see it pop/animate outwards to correct width.

---

## 5. Confirm by Instrumentation

Add the following *temporary* debug instrumentation inside `Pill.tsx`:

```ts
useLayoutEffect(() => {
  if (!pillCoreRef.current) return;
  const el = pillCoreRef.current;
  const rect = el.getBoundingClientRect();
  console.log(`[Pill Debug] ${pillState} width=${rect.width.toFixed(1)} height=${rect.height.toFixed(1)}`);
});
```

Also log content lifecycle:

```ts
useEffect(() => {
  console.log(`[Pill Debug] Render content: ${pillState} notifMsg="${pillContext.notifMsg}"`);
}, [pillState, pillContext.notifMsg]);
```

If you see a log sequence like:

```
PROCESSING width=207
NOTIFICATION width=0.3  <-- the implosion frame
NOTIFICATION width=184  <-- measured width after layout
```

that confirms the race.

---

## 6. Fix Strategy Overview

We want **one source of truth** for pill size per state, and no `'auto'` animations. Two main approaches:

### Option A (Recommended): Pre‑measure text → animate to number

1. Use a hidden off‑screen span (`#pill-ghost-measure`, which you already render!) to measure text width in pixels.
2. Add horizontal padding (same as notification padding: `0 20px`) to computed width.
3. Pass that numeric width down to `Pill` as `notifWidthPx`.
4. In `pillVariants.NOTIFICATION`, replace `width: 'auto'` with a *function variant* or override style prop using `custom={notifWidthPx}`.
5. Remove / override CSS `width: var(--pill-width);` on `.pill-core` or provide fallback that won’t interfere (e.g., `width: unset;`).

### Option B: Layout animation only (no explicit width variants)

Let Framer’s `layout` prop handle intrinsic width changes by not specifying width in variants at all. This can work, but because you also change height between states, and because the wrapper is flex‑centered, you may still see a 1‑frame collapse. Option A is more deterministic.

---

## 7. Concrete Patch (Option A)

Below is a minimal patch showing the core changes. (Pseudo‑diff; adapt to your project paths.)

```diff
--- a/src/index.css
+++ b/src/index.css
@@
-  .pill-core {
-    width: var(--pill-width);
-    height: var(--pill-height);
+  /* Let Framer Motion fully control size; provide safe defaults */
+  .pill-core {
+    width: auto; /* fallback; actual size driven by Framer */
+    height: auto; /* fallback */
     border-radius: var(--pill-border-radius);
     background: var(--pill-background);
     border: var(--pill-border);
     box-shadow: var(--pill-shadow);
     overflow: hidden;
   }
```

```diff
--- a/src/components/App.tsx
+++ b/src/components/App.tsx
@@
 const App: React.FC = () => {
   ...
+  // Width for notification (measured offscreen)
+  const [notifWidth, setNotifWidth] = useState<number | null>(null);
+  const ghostRef = useRef<HTMLSpanElement | null>(null);
@@
   const handlePillMetrics = useCallback((metrics: PillMetrics) => {
     setDebugInfo(metrics);
   }, []);
+
+  // Measure notification width whenever notif message changes
+  useLayoutEffect(() => {
+    if (!ghostRef.current) return;
+    const el = ghostRef.current;
+    const msg = pillContext.notifMsg ?? "";
+    el.textContent = msg;
+    // Force layout
+    const rect = el.getBoundingClientRect();
+    // Add same horizontal padding used in visible notification-text class (20px left/right)
+    const pad = 40; // px total
+    setNotifWidth(Math.ceil(rect.width + pad));
+  }, [pillContext.notifMsg]);
@@
   return (
     <div className="app-container w-full h-screen bg-transparent overflow-hidden relative">
       <Pill
         pillState={pillState}
         pillContext={pillContext}
+        notifWidth={notifWidth}
         onStartDictation={() => {
```

```diff
--- a/src/components/Pill.tsx
+++ b/src/components/Pill.tsx
@@
-interface PillProps {
+interface PillProps {
   pillState: PillStateType;
   pillContext: PillMachineState['context'];
+  notifWidth: number | null;
   onStartDictation: () => void;
   ...
 }
@@
-  return (
+  // Build dynamic animation target
+  const notificationTargetWidth = notifWidth ?? TOKENS.PILL_BASE_W; // fallback
+
+  // We'll drive width/height via explicit animate prop (overrides variants.width)
+  const animateForState = (() => {
+    switch (pillState) {
+      case 'IDLE':
+        return { width: TOKENS.PILL_BASE_W, height: TOKENS.PILL_RESTING_H };
+      case 'HOVER_PREVIEW':
+      case 'LISTENING':
+      case 'PROCESSING':
+        return { width: TOKENS.PILL_BASE_W, height: TOKENS.PILL_BASE_H };
+      case 'NOTIFICATION':
+        return { width: notificationTargetWidth, height: TOKENS.PILL_BASE_H };
+      default:
+        return {};
+    }
+  })();
+
+  return (
     <div
       className="pill-wrapper"
       ...
     >
       <motion.div
         ref={pillCoreRef}
         className="pill-core"
-        layout
-        initial={false}
-        variants={pillVariants}
-        animate={pillState}
+        layout
+        initial={false}
+        animate={animateForState}
         onAnimationComplete={() => {
           if (pillState !== 'NOTIFICATION') {
             onAnimDone();
           }
         }}
       >
```

*(Because we’re now driving `animate` directly, you can drop the `pillVariants` import if unused.)*

In the render where you create the hidden ghost span, attach the ref:

```diff
- <span
-   id="pill-ghost-measure"
-   className="notification-text fixed left-[-9999px] top-[-9999px] pointer-events-none whitespace-nowrap"
- />
+ <span
+   id="pill-ghost-measure"
+   ref={ghostRef}
+   className="notification-text fixed left-[-9999px] top-[-9999px] pointer-events-none whitespace-nowrap"
+ />
```

That should eliminate the 0‑width transient.

---

## 8. Minimal Repro Sandbox (If You Want to Test in Isolation)

Create a tiny React + Framer Motion sandbox with:

* Parent flex‑centered container.
* `<motion.div layout variants={{A:{width:200},B:{width:'auto'}}}>` swapping children.
  You will likely reproduce the implosion flicker on at least some browsers (esp. WebKit / MacOS).

---

## 9. Alternate Micro‑Fixes / Quick Hacks

If you want a *very quick test* before refactoring:

**Hack 1:** Replace `width: 'auto'` in `pillVariants.NOTIFICATION` with `width: TOKENS.PILL_BASE_W` temporarily. If implosion disappears, the issue is 100% tied to `'auto'` + layout measurement.

**Hack 2:** Hardcode minWidth in CSS just to see if collapse stops:

```css
.pill-core { min-width: 60px; }
```

If the collapse now bottoms out at 60px instead of 0, you’ve confirmed the measured width is momentarily tiny.

**Hack 3:** Wrap text in a container with `display:inline-block;` and absolute positioning so the pill’s width never depends on the incoming child until after animation complete.

---

## 10. Race Condition Audit (Quick Checklist)

Below is a simple audit to ensure we don’t miss data flow races:

| Potential Race                                                      | Exists?           | Why / Notes                                                                                                                                                            |
| ------------------------------------------------------------------- | ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Multiple NOTIFY events stacking                                     | Low               | You replace listener & dispatch once per message. Even if multiple, reducer caches latest `pendingNotif`.                                                              |
| onAnimDone firing mid‑transition causing early IDLE                 | Safe              | In `Pill.tsx` we guard: only call `onAnimDone()` when state !== NOTIFICATION. Reducer in PROCESSING ignores `ANIM_DONE`, so no unwanted state change.                  |
| Notification cleared before measured                                | Low               | `calculateNotificationDuration` timer only starts when `pillState==='NOTIFICATION'` and `notifMsg` defined; measurement occurs in App effect before or on same render. |
| Cross‑process (IPC) delay causing NOTIFY after PROCESSING\_COMPLETE | Rare but possible | If so, you’d see `PROCESSING` → `IDLE` → `NOTIFICATION`, which could also produce a width snap. Logs will show this; not your main case per description.               |

---

## 11. Next Steps for You

1. **Add the layout logs** (Section 5) and reproduce the issue once.
2. **Test Hack 1 (remove `'auto'`)** — does implosion vanish? If yes, proceed with full patch.
3. Implement **Option A patch** (pre‑measure & numeric width).
4. Verify transitions across all states (LISTENING→PROCESSING→NOTIFICATION→IDLE; IDLE hover preview; manual notifications).
5. Remove debug logs.

---

## 12. Let Me Know

* Do you prefer to refactor variants globally (as in patch) or keep variants and override width per‑state with the `style` or `custom` prop? I can give a smaller diff if you want to keep the variants file.
* Do you want the pill to briefly *pause* in resting before notification (an intentional bounce)? We can insert a timed `IDLE_TRANSITION` state.
* Should long notifications wrap, scroll, or elide? We can add a width clamp + marquee.

---

**Your move:** Tell me whether you want the **smallest change** that fixes the glitch, or a **cleaner long‑term architecture** (single sizing system, measured text, consistent tokens). I’ll generate the exact code accordingly.

---

*PS:* Super cool project. The pill interaction + Fn PTT workflow is slick, and your reducer mental model is going to make future features way easier to reason about. Let’s squash this flicker and keep shipping. 🚀