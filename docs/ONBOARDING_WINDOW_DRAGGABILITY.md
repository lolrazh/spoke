# Frameless Onboarding Window & Drag Regions

This note captures how the Sonic Flow app keeps the onboarding window frameless while retaining native dragging, traffic lights, and window controls.

## Main-process window setup
- `createOnboardingWindow` builds a dedicated `BrowserWindow` with frameless styling (`frame: false`) and a solid background so vibrancy effects come from CSS instead of the OS surface (`transparent: false`, `backgroundColor: "#0f0f0f"`). See `src/main.ts:1567`.
- Key window flags: `hasShadow: false`, `resizable: false`, `show: false`, `paintWhenInitiallyHidden: true`, and minimal sizes (`minWidth`, `minHeight`) to guard against layout glitches. `titleBarStyle: "hiddenInset"` on macOS keeps the native traffic lights while removing the default title bar; `trafficLightPosition` repositions them (`src/main.ts:1594`).
- The window is only revealed after styles/fonts settle. The renderer sends `renderer-ready`, which calls `smoothShow(onboardingWindow)` to fade the window up from opacity 0, avoiding the flash that normally happens with frameless windows (`src/main.ts:1557`, `src/main.ts:1272`).
- IPC handlers exposed through the preload bridge allow the renderer to close/minimize/maximize the window without a native chrome (`src/main.ts:3129`, `src/preload.ts:166`).

## Renderer boot and reveal handshake
- `src/renderer.tsx:81-99` waits for `document.fonts.ready`, requests the next animation frame, notifies the main process via `window.electron.rendererReady()`, and then removes the `initial-fade` class from the body. This guarantees the first painted frame already has webfonts and CSS applied before `smoothShow` runs.
- `src/index.css` starts the body fully transparent (`body.initial-fade { opacity: 0; }`) and removes scrolling/user selection (`html, body` block around line 620) so dragging cannot select text or reveal scrollbars.

## Drag regions in the onboarding UI
- The onboarding root element adds the `onboarding-window` class, which applies the solid surface, border radius, and fade-in animation (`src/index.css:699`).
- An invisible absolutely positioned `div.onboarding-header` is rendered at the top of the onboarding React tree (`src/components/Onboarding.tsx:1163`). Its CSS marks the area as draggable while excluding the macOS traffic-light zone on the left and the control cluster on the right (`src/index.css:745-753`).
  - Left 80 px are reserved for the native window buttons; right 80 px are left free for app-level controls like the speaker toggle.
  - Because the draggable strip is separate from the UI content, interactive elements rendered underneath retain normal pointer behavior.
- A secondary `.onboarding-header-left` class (currently unused) is available to add more drag surface below the traffic lights if needed (`src/index.css:757-764`).
- Buttons or other controls that need to sit inside the drag strip can opt out by setting `style={{ WebkitAppRegion: "no-drag" }}` (see `SettingsCard` and custom selects for examples in `src/components/SettingsCard.tsx:42` and `src/components/ui/select.tsx:23`). The onboarding speaker toggle lives just outside the drag strip, so no override is necessary (`src/components/Onboarding.tsx:1136`).

## Window controls exposed to the renderer
- The preload bridge exposes `closeOnboarding`, `minimizeOnboarding`, and `maximizeOnboarding` helpers so React components can trigger native behavior without a title bar (`src/preload.ts:166-169`).
- The main process implements those handlers using the stored `onboardingWindow` reference (`src/main.ts:3129-3150`).
- When onboarding completes, the renderer calls `window.electron.onboardingComplete()` followed by `closeOnboarding()` so the main process can persist the onboarding flag and cleanly shut the window (`src/components/Onboarding.tsx:1030`).

## Adaptation tips
- Keep the drag strip in its own absolutely positioned element so it never competes with real UI controls; use padding offsets (like the 80 px gutters) when you need native traffic lights or app chrome in the corners.
- Pair a `rendererReady → smoothShow` handshake with `paintWhenInitiallyHidden` to avoid flashes on first render; this is especially important when you rely on custom fonts.
- If you introduce new controls inside the drag zone, give them `WebkitAppRegion: "no-drag"` or move them into one of the non-draggable gutters.
- Remember that setting `BrowserWindow` `transparent: false` while styling transparency via CSS simplifies input regions and avoids the macOS vibrancy clipping issues common with fully transparent frameless windows.
