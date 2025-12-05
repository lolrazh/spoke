# Design Philosophy

Sonic Flow's design is built on **Fluid UI** — a philosophy inspired by Apple's Dynamic Island where the interface becomes what you need, when you need it. The pill is not a widget, it's THE voice interface. It morphs between states: listening visualization, processing indicator, notification, settings panel, history view. Everything flows through this single, adaptive element that only appears when necessary and vanishes when done.

This is the foundation for Sonic Flow to scale into much larger, more complex voice-driven interactions. As voice becomes the primary interface, the UI must stay invisible until the moment you need it.

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
    <visual>Voice-reactive frequency bars with real-time audio response</visual>
    <description>
      18 vertical bars (2px wide, 2px gap) driven by RMS audio level calculation from PCM16 samples.
      Logarithmic curve ensures natural perception - bars remain responsive at low volumes
      without flat-topping at high volumes. Exponential moving average smoothing (0.3 factor)
      eliminates jitter while maintaining responsiveness. Spring physics (stiffness: 750,
      damping: 19, mass: 0.25) create snappy but smooth motion. Height range: 2-12px.

      Symmetric height distribution: center bars taller, edges shorter, creating balanced
      visual pattern. Bars react to actual voice input in real-time, creating organic
      visualization that mirrors pitch and volume dynamics.
    </description>
    <trigger>Push-to-talk active, capturing audio</trigger>
    <implementation>src/components/FrequencyBars.tsx</implementation>
  </state>

  <state name="PROCESSING">
    <visual>Flowing sine wave with layered variation</visual>
    <description>
      Same 18 bars transform into a smooth sine wave animation using ticker-based updates
      (33ms intervals). Three-layer sine wave variation creates organic, non-mechanical motion:
      - Slow variation (breathing): sin(ticker/6) * 0.12
      - Fast variation (texture): sin(ticker/3) * 0.08
      - Micro variation (shimmer): sin(ticker/2.5) * 0.05

      Smooth RAF-based blend animation (~300-400ms) transitions between listening and
      processing modes. Height range: 2-9px. Gentle, continuous motion indicates
      server-side transcription without demanding attention.
    </description>
    <trigger>Audio captured, waiting for transcription result</trigger>
    <implementation>src/components/FrequencyBars.tsx</implementation>
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

### Frequency Bars: A Unified Voice Visualization

The frequency bars system serves as the primary voice interface visualization, intelligently adapting between active listening and passive processing states:

**LISTENING Mode**: Voice-reactive, energetic, responsive. 18 bars (2px wide) driven by real-time RMS audio level calculation. Logarithmic audio compression ensures natural perception—bars stay responsive to quiet speech without maxing out during loud dictation. Spring physics (high stiffness, moderate damping, low mass) create snappy motion that feels alive. This tells you: **"I'm listening, I hear you."**

**PROCESSING Mode**: Calm, flowing, patient. The same 18 bars morph into a layered sine wave pattern with three frequencies creating organic motion (breathing + texture + shimmer). Ticker-based animation at 33ms intervals keeps the wave flowing smoothly. This tells you: **"I'm thinking, give me a moment."**

**State Transitions**: RAF-based interpolation (~300-400ms) smoothly blends between listening and processing modes. No jarring cuts—the bars naturally flow from reactive to meditative and back. The `transitionBlend` factor (0 = listening, 1 = processing) controls the morph.

The system uses a single component (`FrequencyBars.tsx`) that adapts its behavior based on state, creating a cohesive visual language that guides users through the dictation flow without words or explicit instruction.

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
    Uses "screen in bezel" layout pattern (inspired by phone design):
    - **Top bezel**: Fixed navbar with 6px bottom padding (non-scrolling)
    - **Screen**: Scrollable content area (settings cards, history items) with pb-14 to clear bottom band
    - **Bottom bezel**: Fixed bottom band (z-20) with solid background, containing version label and collapse chevron (z-30)
    - **Scroll indicators**: Dynamic fade gradients (h-12) that appear only when content is scrollable in that direction

    The bezel architecture ensures essential UI elements (navigation, actions) remain visible
    while content scrolls independently. This pattern scales to any panel height without
    manual adjustments thanks to the usePanelAutoHeight hook.
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

The pill adapts to your display, content, and context automatically. Responsive behavior is built into the architecture, not applied as afterthought.

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

  <panel_auto_height>
    <hook>usePanelAutoHeight (src/hooks/usePanelAutoHeight.ts)</hook>
    <mechanism>
      ResizeObserver (with fallbacks) measures natural scrollHeight of panel content.
      App component stores latest heights per panel and passes callbacks to Pill,
      which forwards them to SettingsPanel/PermissionsPanel. Pill's EXPANDED_H
      is driven by measured content, not hardcoded values.
    </mechanism>
    <benefits>
      - Window resizes automatically to fit content (settings: 600px, permissions: 320px)
      - Adding/removing cards requires no manual envelope adjustments
      - Works across different Macs and display scales without tweaking
      - Chevron and bottom band never overlap content regardless of changes
    </benefits>
    <implementation>
      Settings/Permissions panels call usePanelAutoHeight, which batches updates via
      requestAnimationFrame to avoid layout thrash. Height changes trigger smooth
      spring animations via Framer Motion.
    </implementation>
  </panel_auto_height>

  <spacing_tokens>
    <purpose>Consistent vertical rhythm across panels prevents overlap and drift</purpose>
    <tokens>
      --panel-section-offset: var(--spacing-md) (16px) - Spacing between sections
      --panel-heading-gap: var(--spacing-md) (16px) - Gap between headings and cards
    </tokens>
    <usage>
      Sections use token-driven inline styles instead of ad-hoc Tailwind gaps.
      SectionSeparator respects --panel-heading-gap. This ensures headings + cards
      align with identical rhythm across Settings, Permissions, and History panels.
    </usage>
    <rationale>
      Tokenizing contextual spacing (not just generic gaps) prevents panels from
      drifting when Tailwind utilities stack or content changes. Future panels
      can reuse these tokens without manual alignment.
    </rationale>
  </spacing_tokens>

  <bezel_architecture>
    <pattern>"Screen in bezel" layout (phone-inspired)</pattern>
    <structure>
      Top bezel (navbar) + Scrollable screen (content) + Bottom bezel (band + chevron)
    </structure>
    <benefits>
      - Essential UI (navigation, actions) always visible
      - Content scrolls independently without obscuring controls
      - Scales to any panel height without breaking layout
      - Dynamic fade gradients indicate scrollability direction
    </benefits>
    <reference>See Settings Panel architecture documentation above for details</reference>
  </bezel_architecture>
</responsive_system>

---

## Visual Design System

### Surface Language

Sonic Flow uses **flat design** with solid, opaque surfaces. This is a deliberate move away from glassmorphic effects (semi-transparent, backdrop-filter, layered pseudo-elements) toward simplicity, performance, and visual clarity.

<surfaces>
  <primary>
    <name>--surface-solid</name>
    <value>rgb(10, 10, 10)</value>
    <usage>Pill background, settings panel, all primary surfaces</usage>
    <rationale>
      Opaque solid surfaces provide 83-85% performance improvement over glassmorphic dual-layer
      shadows and backdrop-filter effects. Simplifies rendering, eliminates stacking context
      issues, and creates cleaner visual hierarchy.
    </rationale>
  </primary>

  <borders>
    <philosophy>Consistent border opacity across all UI elements for visual harmony</philosophy>
    <standard>rgba(255, 255, 255, 0.08) - --stroke-fg</standard>
    <variants>
      --stroke-fg-mid: rgba(255, 255, 255, 0.1)
      --stroke-fg-strong: rgba(255, 255, 255, 0.12)
      --stroke-fg-xstrong: rgba(255, 255, 255, 0.15)
    </variants>
    <usage>All card outlines, separators, dividers use border-white/[0.08] for consistency</usage>
    <implementation>Tailwind arbitrary values (e.g., border-white/[0.08]) match design tokens exactly</implementation>
  </borders>

  <shadows>
    <philosophy>
      Ambient, centered shadows inspired by Apple's Dynamic Island. Minimal y-offsets (1-3px)
      create floating effect without "dropping down" appearance. Single-layer shadows (not
      dual-layer) optimize GPU performance while maintaining visual quality.
    </philosophy>
    <elevated>0 1px 4px rgba(0, 0, 0, 0.3) - --shadow-elevated</elevated>
    <floating>0 1px 6px rgba(0, 0, 0, 0.35) - --shadow-floating</floating>
    <interactive>0 2px 12px rgba(0, 0, 0, 0.4) - --shadow-interactive</interactive>
    <interactive_hover>0 3px 16px rgba(0, 0, 0, 0.45) - --shadow-interactive-hover</interactive_hover>
    <performance>
      Shadow redesign (November 2025) simplified from dual-layer shadows (36-82px blur) to
      single-layer (4-16px blur), reducing GPU cost by 83-85% and eliminating lag on
      hover/state transitions.
    </performance>
  </shadows>

  <colors>
    <flat_design>All gradients removed from frequency bars, loading dots, and UI elements</flat_design>
    <before>linear-gradient(to top, #a0a0a0, #cccccc)</before>
    <after>#c0c0c0 (flat, solid color matching --text-secondary design token)</after>
    <rationale>Flat colors simplify maintenance, reduce CSS complexity, align with modern design trends</rationale>
  </colors>
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
    <primary>rgba(255, 255, 255, 1.0) - --text-primary</primary>
    <secondary>rgba(255, 255, 255, 0.6)</secondary>
    <tertiary>rgba(255, 255, 255, 0.4)</tertiary>
    <token>--text-secondary: #c0c0c0 (used for flat UI elements like bars and dots)</token>
  </text_colors>
</typography>

### Icons

<icons>
  <system>Apple SF Symbols</system>
  <format>SVG files in src/assets/sf-symbols/</format>
  <usage>
    All system icons use SF Symbols for native macOS aesthetic:
    - microphone.fill.svg (recording state)
    - gearshape.fill.svg (settings)
    - rectangle.portrait.and.arrow.right.svg (sign out)
    - chevron.up.svg (collapse action)
    - dock.rectangle.svg (dock visibility)
    - document.on.document.svg (copy action)
    - speaker.wave.3.fill.svg / speaker.slash.fill.svg (audio state)
    - point.3.filled.connected.trianglepath.dotted.svg (processing)
  </usage>
  <philosophy>
    Using Apple's native icon system ensures visual consistency with macOS UI patterns
    and provides professional, recognizable iconography that users already understand.
  </philosophy>
</icons>

### Pro User Badge

<pro_badge>
  <design>Solid dark badge overlaid on top-right of avatar icon</design>
  <positioning>absolute -top-0.5 -right-0.5 on 32px avatar container</positioning>
  <styling>
    Background: #2A2A2A (solid, no transparency)
    Text: "PRO" in 6px bold font, white color
    Padding: px-1.5 py-0.5 (horizontal breathing room)
    Border radius: rounded (4px, subtle rectangle)
  </styling>
  <inspiration>
    Inspired by Perplexity, Notion, Figma, and GitHub's tier badge patterns.
    Avoids gaudy gold gradients or glassmorphic effects in favor of professional,
    understated solid badge that respects the app's flat design system.
  </inspiration>
  <hover_effect>
    Account card has shimmer effect on hover for premium feel, badge itself
    remains static for clarity.
  </hover_effect>
</pro_badge>

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
    **Voice-reactive visualization with dual-mode behavior:**

    LISTENING Mode (18 bars, 2px wide):
    - Real-time RMS audio level calculation from PCM16 samples
    - Logarithmic curve (log10) for natural audio compression
    - Exponential moving average smoothing (0.3 factor) eliminates jitter
    - Spring physics: stiffness 750, damping 19, mass 0.25 for snappy motion
    - Height range: 2-12px with symmetric distribution (center-high, edges-low)
    - Bars react to actual voice dynamics with <100ms latency

    PROCESSING Mode (same 18 bars):
    - Three-layer sine wave variation creates organic, non-mechanical motion:
      * Slow (breathing): sin(ticker/6 + index*0.4) * 0.12
      * Fast (texture): sin(ticker/3 + index*0.8) * 0.08
      * Micro (shimmer): sin(ticker/2.5 + index*1.2) * 0.05
    - Ticker-based animation at 33ms intervals
    - Height range: 2-9px for calmer appearance

    State Transitions:
    - RAF-based interpolation (~300-400ms duration)
    - transitionBlend factor (0=listening, 1=processing) with 0.18 spring interpolation
    - Smooth morph between reactive bars and flowing wave
  </frequency_bars>

  <pill_expansion>
    Height and width animate using spring physics (Framer Motion).
    Content fades in with opacity transition after expansion begins.
    Collapse reverses the sequence smoothly. Spring parameters:
    stiffness 400, damping 30 for panel expansion (lively feel).
  </pill_expansion>

  <copy_button file="src/components/HistoryItem.tsx">
    Spring-animated checkmark micro-interaction (Emil Kowalski style).
    Fast exit (50ms), spring pop on enter with stiffness 400, damping 25.
    Visual feedback for successful copy action in transcription history.
  </copy_button>

  <scroll_fade_gradients>
    Dynamic fade indicators (h-12, 48px) that appear only when content is
    scrollable in that direction. Top gradient: linear-gradient(to bottom,
    hsl(var(--background)), transparent). Bottom gradient: linear-gradient(to top, ...).
    Updates on scroll events and tab changes using scroll state tracking.
  </scroll_fade_gradients>

  <shimmer_effect>
    Hover shimmer on Pro account card for premium feel. Applied to card container
    with overflow-hidden, not badge itself (badge remains static for clarity).
    CSS-based shimmer animation using ::before pseudo-element.
  </shimmer_effect>
</key_animations>

---

## Design Tokens

All visual values come from CSS custom properties—never hardcoded. This ensures consistency, enables future theming, and makes design system updates cascade automatically across all components.

<tokens file="src/index.css">
  <colors>
    --background, --foreground, --primary, --secondary, --muted,
    --accent, --destructive, --border, --ring
    (All HSL-based for easy manipulation)

    --text-primary: #ffffff
    --text-secondary: #c0c0c0 (used for flat UI elements)
  </colors>

  <surfaces>
    --surface-solid: rgb(10, 10, 10) - Opaque black for all primary surfaces
    --surface-base-rgb: 10, 10, 10 - RGB values for rgba() composition
    --surface-glass: rgba(10, 10, 10, 0.35) - Legacy glass effect (deprecated, not used in flat design)
  </surfaces>

  <strokes>
    --stroke-fg: rgba(255, 255, 255, 0.08) - Standard borders, dividers (8% opacity)
    --stroke-fg-mid: rgba(255, 255, 255, 0.1) - Mid-emphasis borders (10%)
    --stroke-fg-strong: rgba(255, 255, 255, 0.12) - Strong borders (12%)
    --stroke-fg-xstrong: rgba(255, 255, 255, 0.15) - Extra-strong borders (15%)

    All card outlines, separators, and dividers use border-white/[0.08] in Tailwind
    to match --stroke-fg exactly. Consistency is enforced via design token usage.
  </strokes>

  <shadows>
    --shadow-elevated: 0 1px 4px rgba(0, 0, 0, 0.3) - Subtle lift
    --shadow-floating: 0 1px 6px rgba(0, 0, 0, 0.35) - Floating elements (pill resting)
    --shadow-interactive: 0 2px 12px rgba(0, 0, 0, 0.4) - Interactive elements (expanded pill)
    --shadow-interactive-hover: 0 3px 16px rgba(0, 0, 0, 0.45) - Hover states

    Shadow redesign (November 2025): Simplified from dual-layer shadows (36-82px blur)
    to single-layer (4-16px blur), reducing GPU cost by 83-85%. Minimal y-offsets (1-3px)
    create Dynamic Island-inspired floating effect without "dropping down" appearance.
  </shadows>

  <spacing>
    --spacing-xs: 0.25rem (4px)
    --spacing-sm: 0.5rem (8px)
    --spacing-md: 1rem (16px)
    --spacing-lg: 1.5rem (24px)
    --spacing-xl: 2rem (32px)

    Panel-specific spacing tokens for consistent vertical rhythm:
    --panel-section-offset: var(--spacing-md) - Spacing between sections
    --panel-heading-gap: var(--spacing-md) - Gap between headings and cards
    --nav-bar-padding-top: var(--spacing-md)
    --nav-bar-padding-bottom: 0px

    These contextual tokens prevent layout drift when Tailwind utilities stack.
  </spacing>

  <typography>
    --font-family-body: "Lexend Deca", -apple-system, sans-serif
    --font-family-heading: "Instrument Serif", Georgia, serif
    --font-weight-heading: 400 (matches website hero)
    --font-size-heading-xl: 2.8125rem (45px)
    --font-size-heading-lg: 2.25rem (36px)
    --line-height-heading: 1.3
    --letter-spacing-heading: 0 (tracking-normal)
  </typography>

  <radius>
    --radius: 0.5rem (8px base)
    --radius-window: 12px (native macOS corner radius)
    --radius-pill: 8px
  </radius>

  <motion>
    --duration-instant: 0s
    --duration-fast: 0.2s (quick interactions, hover)
    --duration-standard: 0.3s (panel transitions, state changes)
    --duration-slow: 0.5s (large morphing animations)

    --delay-short: 0.1s
    --delay-medium: 0.2s
    --delay-long: 0.3s

    --ease-standard: cubic-bezier(0.25, 0.8, 0.25, 1)
    --ease-emphasized: cubic-bezier(0.2, 0.8, 0.2, 1)

    Framer Motion spring presets:
    - Quick: stiffness 400, damping 30 (pill expansion)
    - Lively: stiffness 400, damping 25, mass 0.9 (copy button)
    - Snappy: stiffness 750, damping 19, mass 0.25 (frequency bars)
  </motion>

  <usage>
    Tailwind config extends these tokens via theme.extend in tailwind.config.js.
    Components reference tokens via Tailwind utilities (bg-background, shadow-floating, etc).
    For precise opacity matching, use Tailwind arbitrary values: border-white/[0.08].
    Never hardcode visual values—always use tokens for maintainability and consistency.
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

## Design Evolution: From Glassmorphic to Flat

In November 2025, Sonic Flow transitioned from glassmorphic design to flat design. This was a deliberate architectural decision driven by performance, maintainability, and visual clarity.

<design_transition>
  <glassmorphic_era before="2025-11-13">
    - Semi-transparent surfaces with backdrop-filter blur effects
    - Dual-layer shadows (36-82px blur radius) for depth + glow
    - Gradient effects on frequency bars and UI elements
    - Pseudo-element layers with negative z-index for glass effects
    - Portal rendering with complex stacking contexts

    **Issues encountered:**
    - Performance lag on hover/state transitions (GPU cost too high)
    - Stacking context artifacts when dropdowns overlapped panels
    - Visual inconsistency: some elements glassy, others opaque
    - Maintenance complexity: backdrop-filter + z-index + portals = unpredictable behavior
  </glassmorphic_era>

  <flat_design_era after="2025-11-13">
    - Opaque solid surfaces (--surface-solid: rgb(10, 10, 10))
    - Single-layer ambient shadows (4-16px blur, 1-3px y-offset)
    - Flat colors (#c0c0c0) matching design tokens, no gradients
    - Simple border hierarchy (8%, 10%, 12%, 15% white opacity)
    - Clean stacking without pseudo-element tricks

    **Benefits achieved:**
    - 83-85% performance improvement (shadow blur reduction)
    - Zero stacking context issues (no negative z-index, no backdrop-filter)
    - Visual consistency: all surfaces use same solid background
    - Simpler codebase: removed 100+ lines of glass-effect CSS
    - Easier to maintain: fewer CSS tricks, more predictable rendering
  </flat_design_era>

  <key_changes>
    - **Surfaces**: rgba(10,10,10,0.3) → rgb(10, 10, 10) (opaque)
    - **Shadows**: Dual-layer (0 0 12px, 0 2px 24px) → Single-layer (0 1px 6px)
    - **Frequency bars**: linear-gradient(#a0a0a0, #cccccc) → #c0c0c0 (flat)
    - **Dropdowns**: Removed .dropdown-glass class, added solid backgrounds
    - **Y-offsets**: 8-25px → 1-3px (Dynamic Island-inspired ambient shadows)
  </key_changes>

  <philosophy>
    The move to flat design isn't just aesthetic—it's architectural. Glassmorphic effects
    create complexity that doesn't scale. As Sonic Flow grows into THE voice interface with
    richer interactions, the design system needs to be performant, maintainable, and
    predictable. Flat design provides that foundation.

    This doesn't mean the UI is boring—voice-reactive frequency bars, smooth state transitions,
    spring animations, and Dynamic Island-inspired floating pill create a polished, engaging
    experience without glassmorphic complexity.
  </philosophy>
</design_transition>

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
    Flat design system (solid surfaces, single-layer ambient shadows, SF Symbols icons)
    establishes foundation that scales without complexity. Performance-optimized shadows
    (83-85% faster than glassmorphic) enable smooth animations at any scale.

    Voice visualization language (18-bar system with dual-mode behavior) will expand
    to represent new interaction types: frequency bars = active input, sine wave = processing,
    future states could include notification patterns, command confirmation, etc.

    Bezel architecture (screen-in-bezel pattern) scales to accommodate richer content:
    transcription history → voice command logs → multi-step workflow UI → AI responses.
    Fixed bezels always keep navigation visible while content scrolls independently.

    New states will follow same morphing principle—one interface, infinite forms. The pill
    remains the single, adaptive surface that becomes whatever you need, when you need it.
  </design_language>
</future_vision>

---

**Last Updated**: 2025-12-04
**Philosophy**: Fluid UI—inspired by Apple's Dynamic Island, the pill becomes what you need, when you need it
**Design System**: Flat design with solid surfaces, ambient shadows, SF Symbols icons, voice-reactive visualizations
