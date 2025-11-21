# Sonic Flow App - Design System - docs/DESIGN.md

A comprehensive adaptive design system for Electron applications, featuring flat solid surfaces, ambient shadows, and responsive interfaces optimized for performance and native macOS integration.

## Table of Contents
1. [Introduction & Principles](#introduction--principles)
2. [Design Tokens](#design-tokens)
3. [Foundation Elements](#foundation-elements)
4. [Component Library](#component-library)
5. [Patterns](#patterns)
6. [Surface System](#surface-system)
7. [Adaptive Interface](#adaptive-interface)
8. [Motion Design](#motion-design)
9. [Accessibility Guidelines](#accessibility-guidelines)
10. [Implementation Guide](#implementation-guide)

---

## Introduction & Principles

### Design Philosophy
Sonic Flow employs a **flat solid design system** optimized for performance, clarity, and native macOS integration. The system moved away from glassmorphic effects to deliver faster rendering and better readability through opaque surfaces, ambient shadows, and adaptive interfaces. The system prioritizes:

- **Performance First**: Flat solid surfaces with single-layer shadows (83-85% faster than glassmorphic)
- **Adaptive Interface**: Responsive panels that adjust to display scale and context
- **Native Integration**: Leverages macOS window behaviors and notch-aware sizing
- **Accessibility First**: WCAG 2.1 AA compliant with comprehensive keyboard navigation
- **Consistency**: Unified token system across all components and surfaces

### Core Principles
1. **Solid over Glass**: Opaque surfaces for performance and readability
2. **Ambient Shadows**: Single-layer, minimal y-offset shadows for floating aesthetic
3. **Adaptive Context**: UI adapts to permissions state, display characteristics, and user actions
4. **Motion with Meaning**: Animations guide user attention and provide feedback
5. **Token Consistency**: All values from CSS custom properties, never hardcoded

---

## Design Tokens

### CSS Variables Structure
All design tokens are defined as CSS custom properties in `:root` for easy maintenance and theming:

#### Color System (HSL)
```css
/* Primary semantic colors */
--background: 0 0% 3.9%;       /* Deep charcoal base */
--foreground: 0 0% 98%;        /* Pure white text */
--primary: 0 0% 98%;           /* Primary action color */
--secondary: 0 0% 14.9%;       /* Secondary elements */
--muted: 0 0% 14.9%;           /* Muted backgrounds */
--accent: 0 0% 14.9%;          /* Accent highlights */
--destructive: 0 62.8% 30.6%;  /* Error/danger states */
--border: 0 0% 14.9%;          /* Border elements */
--ring: 0 0% 83.1%;            /* Focus rings */
```

#### Surface System
```css
/* Primary solid surface */
--surface-solid: rgb(10, 10, 10);          /* Main opaque background */

/* Base surface RGB for alpha variations */
--surface-base-rgb: 10, 10, 10;

/* Alpha transparency levels (for legacy/special cases) */
--surface-alpha-xxs: 0.2;      /* Very light */
--surface-alpha-xs: 0.25;      /* Light */
--surface-alpha-sm: 0.3;       /* Subtle */
--surface-alpha-md: 0.35;      /* Medium */
--surface-alpha-lg: 0.4;       /* Strong */

/* Border strokes (standardized to 8% opacity) */
--stroke-fg: rgba(255, 255, 255, 0.08);      /* Default - use for all borders */
--stroke-fg-mid: rgba(255, 255, 255, 0.1);   /* Medium */
--stroke-fg-strong: rgba(255, 255, 255, 0.12); /* Strong */
--stroke-fg-xstrong: rgba(255, 255, 255, 0.15); /* Extra strong */
```

**Note**: The standard border is `rgba(255, 255, 255, 0.08)` or `border-white/[0.08]` in Tailwind.

#### Opaque Surface Tokens
For solid, non-glass surfaces that should visually unify with the pill, use the opaque surface token:

```css
/* Solid surface for opaque UIs (e.g., onboarding window, pill background) */
--surface-solid: rgba(20, 20, 20, 0.95);
```

Usage examples:

```css
/* Pill */
.pill-wrapper { --pill-background: var(--surface-solid); }

/* Onboarding window */
.onboarding-window { background: var(--surface-solid); }
```

#### Surface Context Tokens
Use semantic surface tokens to keep component surfaces consistent while allowing contextual overrides.

```css
/* Defaults (glass on top of any base) */
--surface-card: rgba(var(--surface-base-rgb), var(--surface-alpha-sm));

/* In solid contexts (e.g., pill expanded/settings), override locally */
.pill-core.expanded {
  --surface-card: var(--pill-background);            /* aligns cards with pill */
}

/* Card components read from the token */
.onboarding-permission-row { background-color: var(--surface-card); }
```

Note on background utilities: Settings uses Tailwind’s `bg-background` (HSL token). In the pill-expanded context we map it to the pill color to avoid mismatches with RGBA solids:

```css
.pill-core.expanded .bg-background { background-color: var(--pill-background) !important; }
```

This addresses a token space mismatch (HSL semantic tokens vs RGBA glass/solid tokens). Prefer semantic tokens (e.g., `--surface-card`) for component surfaces and scope overrides at container boundaries.

#### Typography Tokens
```css
/* Font families */
--font-family-body: "Lexend Deca", -apple-system, BlinkMacSystemFont, sans-serif;
--font-family-heading: "Instrument Serif", Georgia, serif;

/* Heading scale */
--font-weight-heading: 400;
--font-size-heading-xl: 2.8125rem; /* 45px */
--font-size-heading-lg: 2.25rem;   /* 36px */
--line-height-heading: 1.3;
--letter-spacing-heading: 0;
```

#### Spacing System
```css
--spacing-xs: 0.25rem;  /* 4px */
--spacing-sm: 0.5rem;   /* 8px */
--spacing-md: 1rem;     /* 16px */
--spacing-lg: 1.5rem;   /* 24px */
--spacing-xl: 2rem;     /* 32px */
--onboarding-section-gap: clamp(calc(var(--spacing-lg) * 0.75), 4vh, var(--spacing-xl));
--panel-section-offset: var(--spacing-md); /* Vertical offset before each pill/settings section */
--panel-heading-gap: var(--spacing-md);    /* Space between section headers and their cards */
```

#### Border Radius Scale
```css
--radius: 0.5rem;                    /* Base radius (8px) */
--radius-sm: calc(var(--radius) - 4px); /* 4px */
--radius-md: calc(var(--radius) - 2px); /* 6px */
--radius-lg: var(--radius);              /* 8px */
--radius-window: 12px;               /* Window corners */
--radius-pill: var(--radius-lg);     /* Pill elements */
```

#### Blur Effects
```css
--blur-md: 16px;  /* Standard glassmorphic blur */
--blur-lg: 32px;  /* Heavy blur for overlays */
```

### Usage in Tailwind
Access tokens through Tailwind utilities:
```tsx
<div className="bg-background text-foreground">
<div className="rounded-lg">        // Uses --radius
<div className="space-y-md">        // Uses --spacing-md
```

---

## Foundation Elements

### Typography Hierarchy

#### Heading Styles
```css
.text-heading-xl {
  font-family: var(--font-family-heading);
  font-size: var(--font-size-heading-xl);
  font-weight: var(--font-weight-heading);
  line-height: var(--line-height-heading);
}

.text-heading-lg {
  font-family: var(--font-family-heading);
  font-size: var(--font-size-heading-lg);
  /* ... similar properties */
}
```

#### Body Text Utilities
```css
.text-subtle {
  color: rgba(255, 255, 255, 0.6);
}

.text-dimmed {
  color: rgba(255, 255, 255, 0.4);
}
```

#### Typography Enhancements
```css
/* Gradient text effect */
.heading-gradient {
  background: linear-gradient(135deg, rgba(255, 255, 255, 1) 0%, rgba(255, 255, 255, 0.8) 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
}

/* Enhanced rendering for serif headings */
.heading-crisp {
  -webkit-font-smoothing: auto;
  -moz-osx-font-smoothing: auto;
  text-rendering: optimizeLegibility;
  -webkit-text-stroke: 0.15px rgba(255, 255, 255, 0.25);
}
```

### Color Palette

#### Text Colors
- **Primary Text**: `rgba(255, 255, 255, 1)` - Main content
- **Secondary Text**: `rgba(255, 255, 255, 0.6)` - Supporting information  
- **Tertiary Text**: `rgba(255, 255, 255, 0.4)` - Placeholder, disabled states

#### Interactive States
- **Default**: Based on surface alpha levels
- **Hover**: Increased opacity and stronger borders
- **Active**: Slight scale transform with enhanced shadows
- **Focus**: Ring outline with appropriate contrast
- **Disabled**: 50% opacity with pointer-events disabled

### Shadow System

The shadow system uses **single-layer ambient shadows** inspired by Dynamic Island - minimal y-offsets (1-3px) create a floating effect without grounding elements directionally. This provides 83-85% better performance than dual-layer glassmorphic shadows.

```css
/* Ambient elevation levels - single layer, minimal y-offset */
--shadow-elevated: 0 1px 4px rgba(0, 0, 0, 0.3);
--shadow-floating: 0 1px 6px rgba(0, 0, 0, 0.35);
--shadow-interactive: 0 2px 12px rgba(0, 0, 0, 0.4);
--shadow-interactive-hover: 0 3px 16px rgba(0, 0, 0, 0.45);
```

**Design Rationale**: Small y-offsets (1-3px) and moderate blur (4-16px) create ambient glow rather than directional shadows. This matches the floating pill aesthetic.

### Iconography
- **Icon Library**: Lucide React for consistency and accessibility
- **Sizes**: 16px (sm), 20px (default), 24px (lg)
- **Color**: Inherits from parent with appropriate opacity
- **Usage**: Always include descriptive alt text or aria-labels

---

## Component Library

### Button Component

#### Anatomy
The Button component uses the `class-variance-authority` pattern with glassmorphic styling:

```tsx
import { Button } from "@/components/ui/button";

// Usage examples
<Button variant="default" size="default">Primary Action</Button>
<Button variant="secondary" size="sm">Secondary</Button>
<Button variant="destructive" size="lg">Delete</Button>
```

#### Variants
- **`default`**: Uses `.btn-primary` class for primary actions
- **`secondary`**: Uses `.btn-secondary` class for secondary actions
- **`destructive`**: Red gradient for dangerous actions

#### Sizes
- **`sm`**: `h-9 px-3` - Compact buttons
- **`default`**: `h-10 px-4 py-2` - Standard size
- **`lg`**: `h-11 px-8` - Prominent calls-to-action

#### CSS Implementation
```css
.btn-primary {
  background-color: rgba(var(--surface-base-rgb), var(--surface-alpha-lg));
  background-image: url("data:image/svg+xml..."); /* Noise texture */
  border: 1px solid var(--stroke-fg);
  color: rgba(255, 255, 255, 0.9);
  transition: all 0.2s cubic-bezier(0.25, 0.8, 0.25, 1);
  isolation: isolate;
  transform: translateZ(0);
}

.btn-primary:hover {
  background-color: rgba(var(--surface-base-rgb), 0.5);
  border: 1px solid var(--stroke-fg-strong);
}
```

#### Accessibility
- Includes focus-visible ring with proper contrast
- Disabled state with reduced opacity and pointer-events: none
- Supports keyboard navigation
- Uses semantic button element with proper ARIA attributes

### Select Component

#### Anatomy
Built on Radix UI primitives with glassmorphic styling:

```tsx
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

<Select>
  <SelectTrigger className="w-[200px]">
    <SelectValue placeholder="Choose option..." />
  </SelectTrigger>
  <SelectContent>
    <SelectItem value="option1">Option 1</SelectItem>
    <SelectItem value="option2">Option 2</SelectItem>
  </SelectContent>
</Select>
```

#### Key Features
- **Trigger**: Uses `card-floating` class for glassmorphic appearance
- **Content**: Portal-rendered dropdown with backdrop blur
- **Items**: Hover states with subtle background changes
- **Indicators**: Check icon for selected items

#### States
- **Default**: Transparent background with subtle border
- **Hover**: Enhanced background opacity
- **Open**: Animated dropdown with spring physics
- **Focus**: Visible ring for keyboard navigation

### Switch Component

#### Anatomy
Toggle control using Radix Switch primitives:

```tsx
import { Switch } from "@/components/ui/switch";

<Switch />
<Switch defaultChecked />
<Switch disabled />
```

#### CSS Implementation
```css
.switch-track {
  background-color: rgba(var(--surface-base-rgb), var(--surface-alpha-xxs));
  border: 1px solid var(--stroke-fg);
  backdrop-filter: blur(var(--blur-md));
  transition: all var(--duration-fast) var(--ease-standard);
}

.switch-thumb {
  background-color: rgba(255, 255, 255, 0.6);
  background-image: linear-gradient(to bottom, rgba(255, 255, 255, 0.06), rgba(255, 255, 255, 0));
  border: 1px solid var(--stroke-fg);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.22);
}
```

#### States
- **Unchecked**: Thumb positioned left with subtle styling
- **Checked**: Thumb slides right with enhanced appearance
- **Hover**: Increased opacity and border contrast
- **Focus**: Ring outline for accessibility

---

## Patterns

### Interactive Patterns

#### Hover Effects
All interactive elements follow a consistent hover pattern:
1. **Background**: Increased alpha transparency
2. **Border**: Stronger stroke weight
3. **Shadow**: Enhanced elevation (where applicable)
4. **Transition**: 200ms cubic-bezier easing

#### Focus Management
- **Ring**: 2px outline with appropriate contrast
- **Offset**: 2px spacing from element edge  
- **Visibility**: Only shown on keyboard focus (focus-visible)
- **Color**: White with opacity based on background contrast

#### Loading States
- **Shimmer**: Animated gradient overlay for loading content
- **Spinners**: Hardware-accelerated rotation with reduced motion support
- **Skeleton**: Glass surfaces with pulsing opacity

### State Management Patterns

#### Disabled States
```css
.disabled {
  pointer-events: none;
  opacity: 0.5;
  cursor: not-allowed;
}
```

#### Error States
- **Color**: Red tint applied to relevant elements
- **Border**: Error color with increased weight
- **Icons**: Error indicators with proper semantics

### Layout Patterns

#### Stacking Context
Glass elements use proper z-indexing:
- **Base Layer**: 0-10 (backgrounds, containers)
- **Content Layer**: 10-100 (buttons, form elements)  
- **Overlay Layer**: 100-1000 (dropdowns, modals)
- **System Layer**: 1000+ (tooltips, notifications)

#### Spacing Relationships
- **Related Elements**: `--spacing-sm` (8px)
- **Component Internal**: `--spacing-md` (16px)
- **Section Separation**: `--spacing-lg` (24px)
- **Major Layout**: `--spacing-xl` (32px)

---

## Surface System

### Surface Hierarchy

The design system defines four primary surface types, each with specific use cases. Note that dropdowns and floating elements now use **opaque backgrounds** for better readability:

#### `.card-elevated`
**Purpose**: Subtle elevation for content containers
```css
.card-elevated {
  background-color: rgba(var(--surface-base-rgb), var(--surface-alpha-xs));
  background-image: url("data:image/svg+xml..."); /* Subtle noise */
  border: 1px solid var(--stroke-fg);
  box-shadow: var(--shadow-elevated);
}
```
**Usage**: Content panels, information cards, subtle containers

#### `.card-primary`
**Purpose**: Primary content surfaces with medium prominence
```css
.card-primary {
  background-color: rgba(var(--surface-base-rgb), var(--surface-alpha-md));
  backdrop-filter: blur(var(--blur-md));
  border: 1px solid var(--stroke-fg-mid);
  transition: all 0.3s cubic-bezier(0.25, 0.8, 0.25, 1);
}

.card-primary:hover {
  background-color: rgba(var(--surface-base-rgb), var(--surface-alpha-lg));
  border: 1px solid var(--stroke-fg-xstrong);
}
```
**Usage**: Main content cards, form containers, primary panels

#### `.card-floating`
**Purpose**: Floating elements like dropdowns and popovers
```css
.card-floating {
  background-color: var(--surface-solid);  /* Opaque for readability */
  border: 1px solid var(--stroke-fg);
  box-shadow: var(--shadow-floating);
}
```
**Usage**: Select dropdowns, context menus, floating panels

**Note**: Dropdowns use opaque backgrounds (not transparent) to fix z-index stacking issues and improve text readability over varying content.

#### `.card-interactive`
**Purpose**: Interactive surfaces with mouse tracking
```css
.card-interactive {
  background-color: rgba(var(--surface-base-rgb), var(--surface-alpha-xxs));
  backdrop-filter: blur(var(--blur-md));
  border: 1px solid var(--stroke-fg);
  box-shadow: var(--shadow-interactive);
  position: relative;
}

/* Mouse tracking spotlight effect */
.card-interactive::before {
  content: "";
  position: absolute;
  inset: 0;
  pointer-events: none;
  background-image: radial-gradient(
    400px circle at var(--mouse-x) var(--mouse-y),
    rgba(255, 255, 255, 0.04),
    transparent 70%
  );
  opacity: 0;
  transition: opacity 0.3s ease;
}

.card-interactive:hover::before {
  opacity: 1;
}
```
**Usage**: Click-through cards, interactive panels, hover-sensitive areas

### Native macOS Integration

#### Window Background
```css
.onboarding-window {
  background: var(--surface-solid);
  border: 1px solid var(--stroke-fg);
  border-radius: var(--radius-window);
}
```

#### Traffic Light Integration
```css
/* Draggable header that respects native traffic lights */
.onboarding-header {
  -webkit-app-region: drag;
  position: absolute;
  top: 0;
  left: 80px; /* Exclude traffic light area */
  right: 0;
  height: 32px;
}
```

---

## Adaptive Interface

Sonic Flow implements an **adaptive interface** that responds to display characteristics, permission states, and user context.

### Responsive Panel System

#### Display-Aware Scaling
The UI automatically adjusts to display characteristics:

```typescript
// Scale derived from active display, clamped for consistency
const uiScale = Math.min(1.0, Math.max(0.9, displayScale || 1));

// Notch-aware width on notched displays
const baseWidth = notchWidth ?? TOKENS.PILL_BASE_W;
```

#### Window Constants
```typescript
// src/constants/window.ts
CONTENT_WIDTH = 520           // Panel content width
CONTENT_HEIGHT = 600          // Settings panel height
PERMISSIONS_CONTENT_HEIGHT = 320  // Permissions panel height
SHADOW_PAD = 60               // Padding for shadow clipping
```

#### Dynamic Panel Heights
Panels use `usePanelAutoHeight` hook to report their content height, allowing smooth resizing:

```typescript
const { ref, reportedHeight } = usePanelAutoHeight();
// Parent receives height and adjusts window accordingly
```

### Adaptive Permissions Panel

The permissions panel appears automatically when permissions are missing and disappears when resolved.

#### Behavior
1. **Auto-Appear**: When `missingPermissions.length > 0`, panel switches to permissions view
2. **Notification Loop**: Sends actionable notifications every 8 seconds while permissions missing
3. **Double-Click Action**: Notification action expands pill directly to permissions panel
4. **Auto-Collapse**: When permissions resolved, returns to settings view and collapses if auto-opened

#### Implementation
```typescript
// App.tsx - Permission state change handling
useEffect(() => {
  if (currentCount > 0) {
    setPanelView("permissions");
    // Start notification loop
  } else if (prevCount > 0) {
    setPanelView("settings");
    // Auto-collapse if opened automatically
    if (autoPermissionsRef.current) {
      setTimeout(() => pillDispatch({ type: "COLLAPSE" }), 240);
    }
  }
}, [missingPermissions]);
```

#### Panel Dimensions
- **Settings Panel**: 520 × 600px
- **Permissions Panel**: 520 × 320px (compact for focused task)

### Bezel Architecture

Settings panel uses a "screen in bezel" architecture with fixed top/bottom bands:

```
+---------------------+
|  Navbar (top bezel) | <- Fixed, 6px bottom padding
+---------------------+
|                     |
|  Scrollable Content | <- pb-14, scrolls behind band
|  (the "screen")     |
|                     |
+---------------------+
|   Fade gradient     | <- pointer-events-none
|  Bottom band/bezel  | <- z-20, solid bg-background
|  [chevron] [version]| <- Both z-30
+---------------------+
```

#### Z-Index Hierarchy
- **Band**: z-20
- **Fade gradient**: pointer-events-none (visual only)
- **Interactive elements** (chevron, version): z-30

#### Scroll Indicators
Dynamic fade gradients appear only when content is scrollable in that direction:
- Top fade when scrolled down
- Bottom fade when more content below

---

## Motion Design

### Animation Tokens

#### Duration System
```css
--duration-instant: 0s;
--duration-fast: 0.2s;
--duration-standard: 0.3s;
--duration-slow: 0.5s;
```

#### Easing Functions
```css
--ease-standard: cubic-bezier(0.25, 0.8, 0.25, 1);
--ease-emphasized: cubic-bezier(0.2, 0.8, 0.2, 1);
```

#### Spring Physics (Framer Motion)
```typescript
export const MOTION = {
  springs: {
    quick: { stiffness: 400, damping: 30 },
    lively: { stiffness: 400, damping: 25, mass: 0.9 },
    heavy: { stiffness: 200, damping: 25, mass: 1.2 },
  },
};
```

### Animation Patterns

#### Fade Transitions
```css
.fade-enter {
  opacity: 0;
}

.fade-enter-active {
  opacity: 1;
  transition: opacity 300ms;
}
```

#### Scale Animations
```css
/* Onboarding window entrance */
@keyframes fadeInOnboarding {
  from {
    opacity: 0;
    transform: scale(0.98);
  }
  to {
    opacity: 1;
    transform: scale(1);
  }
}
```

#### Micro-interactions

**Wave Animation** (Processing states):
```css
@keyframes wave {
  0%, 100% {
    transform: translateY(0) scaleY(1);
    opacity: 0.8;
  }
  50% {
    transform: translateY(-4px) scaleY(1.2);
    opacity: 1;
  }
}
```

**Pill Wave Animation** (Active states):
```css
@keyframes pill-wave {
  0%, 100% {
    height: 5px;
    opacity: 0.7;
  }
  50% {
    height: 10px;
    opacity: 1;
  }
}
```

### Performance Optimizations

#### Hardware Acceleration
```css
.will-change-transform {
  will-change: transform;
  backface-visibility: hidden;
  transform: translateZ(0);
}
```

#### Reduced Motion Support
```css
@media (prefers-reduced-motion: reduce) {
  .dot.animated,
  .waveform-bar,
  .spinner,
  .animate-spin {
    animation: none !important;
    transition: none !important;
  }
}
```

---

## Accessibility Guidelines

### WCAG 2.1 AA Compliance

#### Color Contrast
- **Text on Glass**: All text maintains minimum 4.5:1 contrast ratio
- **Interactive Elements**: Focus states provide 3:1 contrast minimum
- **Error States**: Color is not the only indicator of state

#### Keyboard Navigation
- **Tab Order**: Logical sequential navigation
- **Focus Visibility**: Clear focus indicators on all interactive elements
- **Escape Routes**: All modals/overlays can be closed with Escape key

#### Screen Reader Support
```tsx
// Proper semantic markup
<button aria-label="Close dialog" aria-describedby="dialog-description">
  <X className="h-4 w-4" />
</button>

// State announcements
<Switch aria-label="Enable notifications" />
<Select aria-label="Choose audio device">
  <SelectTrigger aria-expanded={false} aria-haspopup="listbox">
    <SelectValue />
  </SelectTrigger>
</Select>
```

#### Motion Preferences
- **Reduced Motion**: Respects `prefers-reduced-motion` setting
- **Animation Toggles**: Critical animations can be disabled
- **Performance**: Animations degrade gracefully on lower-end devices

### Native macOS Accessibility

#### VoiceOver Integration
- Proper heading hierarchy with `h1`, `h2` structure
- Landmark regions (`main`, `navigation`, `complementary`)
- Live regions for dynamic content updates

#### Keyboard Shortcuts
- **System Integration**: Respects macOS keyboard navigation preferences
- **Custom Shortcuts**: Documented and non-conflicting
- **Full Keyboard Access**: All functionality available without mouse

---

## Implementation Guide

### Getting Started

#### 1. Install Dependencies
```bash
npm install clsx tailwind-merge class-variance-authority
npm install @radix-ui/react-primitives framer-motion
```

#### 2. Configure Tailwind
Ensure your `tailwind.config.js` includes the extended theme:
```javascript
module.exports = {
  content: ["./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        // ... other semantic colors
      },
      fontFamily: {
        sans: ["Lexend Deca", "-apple-system", "BlinkMacSystemFont", "sans-serif"],
        serif: ["Instrument Serif", "Georgia", "serif"],
      },
    },
  },
};
```

#### 3. Include Design System CSS
Import the complete design system styles in your main CSS file:
```css
@import url('./path-to/index.css');
```

### Component Usage Patterns

#### Creating New Components
```tsx
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const cardVariants = cva("card-primary", {
  variants: {
    size: {
      sm: "p-4",
      md: "p-6",
      lg: "p-8",
    },
  },
  defaultVariants: {
    size: "md",
  },
});

interface CardProps extends VariantProps<typeof cardVariants> {
  className?: string;
  children: React.ReactNode;
}

export function Card({ className, size, children, ...props }: CardProps) {
  return (
    <div
      className={cn(cardVariants({ size }), className)}
      {...props}
    >
      {children}
    </div>
  );
}
```

#### Surface Application
```tsx
// Choose the appropriate surface level
<div className="card-elevated">      {/* Subtle containers */}
<div className="card-primary">       {/* Main content */}
<div className="card-floating">      {/* Dropdowns, popovers - uses opaque bg */}
<div className="card-interactive">   {/* Mouse-tracking surfaces */}
```

#### Typography Implementation
```tsx
<h1 className="text-heading-xl heading-gradient heading-crisp">
  Primary Heading
</h1>
<h2 className="text-heading-lg">
  Secondary Heading  
</h2>
<p className="text-foreground">Main content</p>
<p className="text-subtle">Supporting information</p>
<p className="text-dimmed">Tertiary content</p>
```

### Best Practices

#### Performance
1. **Prefer Solid Surfaces**: Use opaque backgrounds for better rendering performance
2. **Single-Layer Shadows**: Avoid dual-layer shadows (use ambient shadow tokens)
3. **Optimize Animations**: Prefer `transform` and `opacity` changes
4. **Hardware Acceleration**: Apply `will-change` judiciously
5. **Reduced Motion**: Always provide alternatives

#### Accessibility
1. **Color Independence**: Don't rely solely on color for meaning
2. **Focus Management**: Maintain logical tab order
3. **Screen Readers**: Test with VoiceOver regularly
4. **Semantic HTML**: Use appropriate elements and ARIA attributes

#### Code Organization
```
src/
├── components/
│   ├── ui/           # Base components
│   ├── patterns/     # Composite patterns
│   └── layout/       # Layout components
├── styles/
│   ├── globals.css   # Design system tokens
│   └── components/   # Component-specific styles
└── lib/
    └── utils.ts      # Utility functions
```

#### Design Token Updates
1. **Central Definition**: All tokens in CSS custom properties
2. **Semantic Names**: Use purpose-based naming (not values)
3. **Cascade Support**: Test changes across all components
4. **Documentation**: Update this guide when tokens change

#### Component Authoring Rules
- Prefer Radix primitives for accessibility and behavior (e.g., `@radix-ui/react-select`, `.../switch`).
- Author base components in `src/components/ui/` using the CVA pattern (class-variance-authority) and Tailwind utilities.
- Consume tokens (CSS variables) for color, radius, spacing; do not hard-code values.
- Compose classes with `tailwind-merge` to avoid conflicts; avoid inline styles unless unavoidable.
- Preserve keyboard navigation and visible focus states; ensure ARIA roles/labels are set.

### Troubleshooting

#### Common Issues
1. **Blurry Text**: Check for fractional transforms or improper hardware acceleration
2. **Performance**: Ensure using solid surfaces and single-layer shadows
3. **Contrast**: Validate text readability on all surfaces
4. **Animation Jank**: Verify proper `will-change` usage
5. **Z-Index Issues**: Follow bezel architecture hierarchy (band z-20, interactive z-30)

#### Debugging Tools
- **Browser DevTools**: Inspect glass effect rendering
- **React DevTools**: Monitor component re-renders
- **Accessibility Inspector**: Validate contrast and structure
- **Performance Monitor**: Profile animation frame rates

---

## Settings Panel Guidelines

### Version Label
- Format: `Sonic Flow Beta <version>` (e.g., `Sonic Flow Beta 0.0.3`).
- Embedded (pill expanded): bottom-right, normal orientation, subdued styling (`text-[10px] text-muted-foreground opacity-70`), offsets `right-3 bottom-2`.
- Standalone Settings: footer shows the same label next to the app icon for consistency.
- Channel: Prefer env-driven channel (e.g., `beta`, `stable`) when available; consider a `VITE_RELEASE_CHANNEL` flag to avoid hardcoding copy.

### Radius and Surface Hierarchy
- Cards: Settings cards (permission rows) use `border-radius: var(--radius)` to stay consistent with standard surface corners.
- Panel (embedded): Expanded settings container uses `border-radius: calc(var(--radius-window) + 2px)` for a slightly softer, nested feel relative to the window.
- Surfaces: Cards consume `--surface-card`. In expanded settings, `.pill-core.expanded` sets `--surface-card: var(--pill-background)` to unify surfaces with the pill.

### Accessibility & Visual Hierarchy
- Keep the version label low-emphasis while maintaining sufficient contrast.
- Ensure all controls within settings cards retain focus styles and keyboard navigation.

---

## Maintenance & Updates

This design system is a living document. When making changes:

1. **Update Tokens First**: Modify CSS variables before components
2. **Test Across Components**: Verify changes don't break existing patterns
3. **Document Changes**: Update this guide with new patterns or breaking changes
4. **Validate Accessibility**: Re-test compliance after major updates

### Change Checklist (For Agents)
- Update tokens in `src/index.css` (and `src/config/uiTokens.ts` / motion in `src/config/motionTokens.ts`) instead of hard-coding.
- Update or create components under `src/components/ui/` following CVA and Radix usage.
- Reflect changes here in `docs/DESIGN.md` (tokens table, examples, and any affected guidance).
- Run `npm run lint && npm test`; visually verify focus states and contrast.
- Add an `agent-logs/YYYY-MM-DD_HHMM_*.md` entry summarizing design changes and rationale.

**Last Updated**: 2025-11-21
**Version**: 2.0.0
**Maintainers**: Sonic Flow Team

### Version History
- **2.0.0** (2025-11-21): Major rewrite - moved from glassmorphic to flat solid design, added adaptive interface documentation, responsive panel system, bezel architecture
- **1.0.0** (2025-09-15): Initial design system documentation
