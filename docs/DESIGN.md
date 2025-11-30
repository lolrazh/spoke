# Design Philosophy

Sonic Flow's design is built on one core principle: **the pill becomes whatever you need**. It's a fluid interface that morphs and adapts—showing transcription history when you need it, notifications when they matter, settings when you want control. The UI only appears when necessary and disappears when it's done.

**Related:** `docs/TRANSCRIPTION.md`, `docs/PERMISSIONS.md`

---

## Core Principles

Sonic Flow is designed around a fundamental understanding: **dictation ≠ transcription**.

Dictation is what you do with a stenographer, a human scribe who *understands* what you mean, not just what you say. They infer context, fix obvious mistakes, and produce clean output without you specifying every punctuation mark. That's the standard we're building toward.

<core_principles>
  <principle name="dictation_not_transcription">
    Dictation ≠ Transcription. Sonic Flow always writes what the user *meant* to write,
    not what the user dictated verbatim.

    Transcription is mechanical—it converts audio to text word-for-word.
    Dictation is intelligent—it understands intent, applies context, fixes obvious errors,
    and produces clean output without you specifying every punctuation mark.

    Sonic Flow uses LLM post-processing to bridge this gap. The STT gives us raw transcription,
    the LLM gives us intelligent dictation. This is why we don't just pipe Whisper output directly—
    we want the experience of dictating to a smart assistant, not a dumb recorder.
  </principle>

  <principle name="sub_400ms_responses">
    Responses, no matter to what, shall always be <400ms.

    This isn't just about technical performance—it's about making the interface feel instant
    and direct. When you interact with the pill (double-click, hover, notification action),
    the response must be immediate. No loading states, no perceived delay.

    This drives architecture decisions: pre-spawned native helper daemon (saves ~25ms),
    client-side caching (instant reads), spring animations (feel faster than linear),
    optimistic UI updates (don't wait for server confirmation).

    Anything that breaks this 400ms barrier needs aggressive optimization or rethinking.
  </principle>

  <principle name="fluid_interfaces">
    We use fluid interfaces to always only show what is necessary.

    Voice is inherently fluid—you speak, pause, continue, change your mind.
    The interface must match this fluidity.

    The pill doesn't have rigid states—it *flows* between them. Panels don't toggle—they morph.
    Settings don't clutter the screen—they appear when needed, disappear when done.
    Permissions panel only exists when permissions are missing.

    This is possible because voice is different from mouse/keyboard. With voice, you're never
    "in" the UI—you're always focused on your work. The UI should respect that by staying
    out of the way until the moment you need it.
  </principle>

  <principle name="voice_first_interface">
    Voice is the most natural human interface. We're not building "speech-to-text with a UI"—
    we're building THE voice interface for macOS. The goal is to move away from the keyboard
    wherever voice makes more sense.

    This means the UI must be fluid, invisible, and adaptive. Traditional UIs are designed for
    mouse/keyboard interaction. Voice interfaces need to morph and adapt—showing only what's
    needed, when it's needed.
  </principle>

  <principle name="no_settings_bloat">
    A human stenographer doesn't come with a dashboard of 50 configuration options.
    They just work. They adapt to your voice, your style, your context.

    Sonic Flow should be the same. Most things should auto-configure, auto-adapt, and just work.
    Settings exist for what truly requires user choice (which microphone, privacy preferences),
    not for every possible knob we could expose.

    When in doubt: default it, don't expose it.
  </principle>

  <principle name="well_designed_everything">
    Every detail matters. From the subtle glow of the pill to the timing of animations to
    the way errors are communicated—everything should feel intentional and polished.

    Good design isn't just aesthetics. It's how the system *feels*. Sub-2s latency isn't
    a technical metric—it's a design choice that makes dictation feel instant and magical.
    Frequency bars during listening isn't decoration—it's feedback that tells you "I hear you."

    We're not building features—we're crafting an experience.
  </principle>
</core_principles>

These principles guide every decision—from architecture to UX to which features we build. When something doesn't align with these principles, it's wrong for Sonic Flow, even if it's "normal" for other apps.

---

## Philosophy: Fluid UI

The pill isn't just a widget—it's THE voice interface. Everything flows through this single, adaptive element. This is the foundation we're building for Sonic Flow to scale into much larger, more complex interactions.

<philosophy>
  <principle name="contextual_presence">
    UI elements only appear when needed. Permissions panel shows when permissions are missing, then vanishes when resolved. Transcription history appears on demand, then collapses. No persistent chrome, no always-visible controls.
  </principle>

  <principle name="morphing_interface">
    The pill transforms into whatever you need: notification, settings panel, transcription history, processing indicator. One interface, infinite forms.
  </principle>

  <principle name="minimal_control">
    Essential settings only. No configuration bloat. The app should "just work" with minimal user intervention. When you do need settings, they're right there—double-click the pill.
  </principle>

  <principle name="responsive_by_nature">
    Adapts to display characteristics (notched screens, different scales), user state (missing permissions), and context (recording, processing, idle).
  </principle>
</philosophy>

---

## Visual Language

### The Pill

The pill is the primary interface element. Its visual states communicate system status through subtle, elegant changes.

<pill_states>
  <state name="IDLE">
    <visual>Compact horizontal bar, subtle glow</visual>
    <trigger>Default state, no active dictation</trigger>
  </state>

  <state name="LISTENING">
    <visual>Frequency bars animating in real-time</visual>
    <description>
      Real-time audio visualization with 7 vertical bars (5px wide, 1px gap).
      Bars animate based on actual microphone input frequency data,
      creating organic, responsive movement that reflects voice dynamics.
    </description>
    <trigger>Push-to-talk active, capturing audio</trigger>
  </state>

  <state name="PROCESSING">
    <visual>Smooth sine wave animation</visual>
    <description>
      3-bar sine wave (5px wide bars) using CSS keyframe animation.
      Gentle, continuous motion indicating server-side transcription.
      Slower, more meditative than the listening state.
    </description>
    <trigger>Audio captured, waiting for transcription result</trigger>
  </state>

  <state name="NOTIFICATION">
    <visual>Pill transforms to show notification content</visual>
    <description>
      Expands to show actionable message (e.g., "Double click to review permissions").
      Auto-appears on critical events, disappears after user action or timeout.
    </description>
    <trigger>System needs user attention (missing permissions, errors)</trigger>
  </state>

  <state name="EXPANDED">
    <visual>Pill morphs into full panel (settings or history)</visual>
    <description>
      Smooth height/width animation to panel dimensions.
      Settings: 520×600px. Permissions: 520×320px (more compact, focused).
      Panel content uses same visual language as pill—unified surface.
    </description>
    <trigger>Double-click pill, or notification action</trigger>
  </state>
</pill_states>

### Frequency Bars vs Sine Wave

These two visualizations serve different purposes in the pill's language:

**Frequency Bars (LISTENING)**: Active, reactive, energetic. 7 bars driven by live microphone FFT data. Each bar responds to different frequency buckets, creating organic visualization that mirrors your voice's pitch and volume. This tells you "I'm listening, I hear you."

**Sine Wave (PROCESSING)**: Calm, continuous, patient. 3 bars in a CSS-animated sine pattern. Smooth, predictable motion while the server transcribes your audio. This tells you "I'm thinking, give me a moment."

The contrast between active (bars) and passive (wave) states creates a natural rhythm that guides the user through the dictation flow without words.

---

## Adaptive Behavior

### Permissions Panel

The permissions panel embodies fluid UI—it only exists when needed.

<permissions_panel>
  <behavior>
    <auto_appear>
      When permissions are missing, pill automatically shows permissions panel.
      No manual navigation needed—the system adapts to what you need.
    </auto_appear>

    <notification_loop>
      While permissions missing, sends notification every 8 seconds:
      "Double click to review permissions"
      Clicking notification expands pill directly to permissions view.
    </notification_loop>

    <auto_dismiss>
      When all permissions granted, panel switches back to settings view.
      If panel was auto-opened (not manually), it auto-collapses after 240ms.
      User never sees resolved permissions—they just work.
    </auto_dismiss>
  </behavior>

  <dimensions>
    <width>520px</width>
    <height>320px (compact—only shows what you need to fix)</height>
  </dimensions>

  <philosophy>
    Permissions are a necessary evil. Show them only when broken, hide them when working.
    Don't waste screen space showing green checkmarks—that's the default state.
  </philosophy>
</permissions_panel>

### Settings Panel

Double-click the pill to access settings. Essential controls only—no bloat.

<settings_panel>
  <dimensions>
    <width>520px</width>
    <height>600px</height>
  </dimensions>

  <current_controls>
    - Microphone selection (device picker)
    - Share transcriptions (dataset consent)
    - Sign out
  </current_controls>

  <philosophy>
    Minimal control surface. Most things should auto-configure.
    Settings exist for what truly needs user choice, not every possible knob.
    This will expand carefully as features grow, but always favoring defaults over options.
  </philosophy>

  <architecture>
    Uses "screen in bezel" layout:
    - Top navbar (fixed, 6px bottom padding)
    - Scrollable content (the "screen")
    - Bottom band with version label and collapse chevron (fixed, z-20)
    - Fade gradients appear dynamically when content scrollable
  </architecture>
</settings_panel>

### Transcription History

The pill becomes your transcription history when you need it.

<history_view>
  <access>Settings panel → History tab</access>
  <storage>Local only (electron-store), max 1000 items, auto-pruned</storage>

  <display>
    - Grouped by time: Today, Yesterday, This Week, Older
    - Each item shows text snippet + copy button
    - Copy button has spring animation (Emil Kowalski style: fast exit 50ms, spring pop on enter)
    - Infinite scroll with loading indicator
  </display>

  <philosophy>
    Quick access to past transcriptions without disrupting flow.
    Stored locally for privacy—database only logs metadata, never text.
  </philosophy>
</history_view>

---

## Responsive Design

The pill adapts to your display, not the other way around.

<responsive_system>
  <display_scaling>
    <detection>Queries active display's scale factor via Electron</detection>
    <adjustment>UI scale = clamp(0.9, 1.0, displayScale)</adjustment>
    <result>Consistent visual weight across Retina and standard displays</result>
  </display_scaling>

  <notch_awareness>
    <detection>Detects MacBook Pro notch via display characteristics</detection>
    <adaptation>Adjusts pill base width to notchWidth when present</adaptation>
    <result>Pill width matches notch dimensions for visual harmony</result>
  </notch_awareness>

  <panel_heights>
    <mechanism>usePanelAutoHeight hook reports content height to parent</mechanism>
    <result>Window resizes smoothly to fit panel content (settings vs permissions)</result>
  </panel_heights>
</responsive_system>

---

## Visual Design System

### Surface Language

Everything uses a unified surface language—flat, solid, opaque.

<surfaces>
  <primary>
    <name>--surface-solid</name>
    <value>rgb(10, 10, 10)</value>
    <usage>Pill background, settings panel, all primary surfaces</usage>
    <rationale>Opaque for performance (83-85% faster than glassmorphic)</rationale>
  </primary>

  <borders>
    <standard>rgba(255, 255, 255, 0.08)</standard>
    <usage>All borders, strokes, dividers</usage>
  </borders>

  <shadows>
    <philosophy>Ambient shadows with minimal y-offset (1-3px), inspired by Dynamic Island</philosophy>
    <elevated>0 1px 4px rgba(0, 0, 0, 0.3)</elevated>
    <floating>0 1px 6px rgba(0, 0, 0, 0.35)</floating>
    <interactive>0 2px 12px rgba(0, 0, 0, 0.4)</interactive>
  </shadows>
</surfaces>

### Typography

<typography>
  <body>
    <family>Lexend Deca, -apple-system, sans-serif</family>
    <usage>All UI text, settings, buttons</usage>
  </body>

  <headings>
    <family>Instrument Serif, Georgia, serif</family>
    <usage>Section headings, onboarding titles</usage>
    <enhancement>Subtle webkit-text-stroke for crispness</enhancement>
  </headings>

  <text_colors>
    <primary>rgba(255, 255, 255, 1.0)</primary>
    <secondary>rgba(255, 255, 255, 0.6)</secondary>
    <tertiary>rgba(255, 255, 255, 0.4)</tertiary>
  </text_colors>
</typography>

### Motion

<motion>
  <philosophy>
    Motion guides attention and provides feedback. Every animation has purpose.
  </philosophy>

  <timing>
    <fast>200ms - Quick interactions (hover, click)</fast>
    <standard>300ms - Panel transitions, state changes</standard>
    <slow>500ms - Large morphing animations (pill expansion)</slow>
  </timing>

  <easing>
    <standard>cubic-bezier(0.25, 0.8, 0.25, 1)</standard>
    <emphasized>cubic-bezier(0.2, 0.8, 0.2, 1)</emphasized>
  </easing>

  <springs>
    Used for organic, physics-based motion (Framer Motion):
    <quick>stiffness: 400, damping: 30</quick>
    <lively>stiffness: 400, damping: 25, mass: 0.9</lively>
  </springs>

  <accessibility>
    All animations respect prefers-reduced-motion.
    Critical animations disable completely, non-critical degrade gracefully.
  </accessibility>
</motion>

### Animations

<key_animations>
  <frequency_bars file="src/components/FrequencyBars.tsx">
    7 bars (5px wide, 1px gap) driven by real-time FFT data from microphone.
    Each bar maps to frequency bucket, creating reactive audio visualization.
    Only visible in LISTENING state.
  </frequency_bars>

  <sine_wave file="src/components/SineWave.tsx">
    3 bars (5px wide) with CSS keyframe animation.
    Smooth, continuous wave motion during PROCESSING state.
    Slower, more meditative than frequency bars.
  </sine_wave>

  <pill_expansion>
    Height and width animate using spring physics (Framer Motion).
    Content fades in with opacity transition after expansion begins.
    Collapse reverses the sequence smoothly.
  </pill_expansion>

  <copy_button file="src/components/HistoryItem.tsx">
    Spring-animated checkmark micro-interaction.
    Fast exit (50ms), spring pop on enter (Emil Kowalski style).
    Visual feedback for successful copy action.
  </copy_button>
</key_animations>

---

## Design Tokens

All visual values come from CSS custom properties—never hardcoded. This ensures consistency and enables future theming.

<tokens file="src/index.css">
  <colors>
    --background, --foreground, --primary, --secondary, --muted,
    --accent, --destructive, --border, --ring
    (All HSL-based for easy manipulation)
  </colors>

  <surfaces>
    --surface-solid: rgb(10, 10, 10)
    --surface-base-rgb: 10, 10, 10
    --stroke-fg: rgba(255, 255, 255, 0.08)
  </surfaces>

  <spacing>
    --spacing-xs: 0.25rem (4px)
    --spacing-sm: 0.5rem (8px)
    --spacing-md: 1rem (16px)
    --spacing-lg: 1.5rem (24px)
    --spacing-xl: 2rem (32px)
  </spacing>

  <radius>
    --radius: 0.5rem (8px base)
    --radius-window: 12px
    --radius-pill: 8px
  </radius>

  <usage>
    Tailwind config extends these tokens.
    Components reference via Tailwind utilities (bg-background, rounded-lg, etc).
  </usage>
</tokens>

---

## Component Architecture

<components>
  <primitives>
    Uses Radix UI primitives for accessibility and behavior:
    - @radix-ui/react-select (dropdown menus)
    - @radix-ui/react-switch (toggle controls)
    - @radix-ui/react-dialog (modals, overlays)
  </primitives>

  <styling>
    <approach>CVA (class-variance-authority) pattern for variants</approach>
    <utilities>Tailwind for layout and spacing</utilities>
    <tokens>CSS custom properties for colors, surfaces, shadows</tokens>
    <composition>tailwind-merge (cn utility) to avoid conflicts</composition>
  </styling>

  <location>
    Base components in src/components/ui/
    Composite patterns in src/components/
    Layout components in src/components/layout/
  </location>

  <examples>
    <button>Variants: default, secondary, destructive. Sizes: sm, default, lg</button>
    <select>Opaque dropdown (not glass) for readability over varying backgrounds</select>
    <switch>Glass track, solid thumb with subtle gradient</switch>
  </examples>
</components>

---

## Accessibility

<accessibility>
  <keyboard_navigation>
    - Logical tab order throughout all panels
    - Visible focus rings on all interactive elements (focus-visible)
    - Escape key closes expanded panels, modals
  </keyboard_navigation>

  <screen_readers>
    - Semantic HTML (button, nav, main landmarks)
    - Proper ARIA labels on all controls
    - Live regions for dynamic content (notifications, processing states)
  </screen_readers>

  <color_contrast>
    - Text on surfaces maintains 4.5:1 minimum ratio (WCAG AA)
    - Focus indicators have 3:1 contrast against background
    - Error states use color + text + icons (not color alone)
  </color_contrast>

  <motion>
    - Respects prefers-reduced-motion (animations disabled/degraded)
    - Critical feedback (processing state) uses text + visual indicator
  </motion>

  <voiceover>
    - Proper heading hierarchy (h1, h2)
    - Landmark regions (navigation, main, complementary)
    - State announcements for switch/select changes
  </voiceover>
</accessibility>

---

## Native macOS Integration

<macos>
  <window_behavior>
    - Traffic light buttons (red/yellow/green) respected
    - Draggable region starts left: 80px (excludes traffic lights)
    - Window uses native rounded corners (--radius-window: 12px)
  </window_behavior>

  <display_awareness>
    - Queries display scale via Electron API
    - Detects notch presence on MacBook Pro
    - Adapts pill dimensions to display characteristics
  </display_awareness>

  <permissions>
    - Microphone: Required for dictation
    - Accessibility: Required for text insertion via native helper
    - Input Monitoring: Required for paste simulation
    (See docs/PERMISSIONS.md for flow details)
  </permissions>
</macos>

---

## Future Scaling

The fluid UI philosophy is designed to scale far beyond current features.

<future_vision>
  <principle>
    The pill becomes anything you need. As Sonic Flow grows into THE voice interface,
    the pill will morph to show:
    - Voice command results
    - Contextual actions
    - Multi-step workflows
    - AI assistant responses
    - System integrations
  </principle>

  <constraint>
    Always maintain contextual presence—show only what's needed, when it's needed.
    Never become a persistent UI cluttering the screen.
    The pill should feel invisible until the moment you need it.
  </constraint>

  <design_language>
    Unified surface language (solid, flat, ambient shadows) will scale.
    Motion language (frequency bars = active, sine wave = processing) will expand.
    New states will follow same morphing principle—one interface, infinite forms.
  </design_language>
</future_vision>

---

**Last Updated**: 2025-11-30
**Philosophy**: Fluid UI—the pill becomes what you need, when you need it
