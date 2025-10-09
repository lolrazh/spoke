# Sonic Flow Text Editing Behavior - Complete Technical Documentation

## Overview

This document provides a comprehensive technical breakdown of the text editing behavior demonstrated in the "More Tricks to Try" section of Sonic Flow's onboarding flow. This system showcases the app's voice command capabilities through sophisticated real-time text animations that demonstrate how users can correct, modify, and enhance their dictated text using natural language commands.

The implementation demonstrates three fundamental text editing primitives:
1. **Removal** - Text gets struck through and disappears from the document flow
2. **Replacement** - Text gets struck through while new text simultaneously fades in 
3. **Insertion** - New text materializes from nothing and expands the document flow

## First Principles Approach

### Core Concept: Real-time Text Transformation

The system operates on the principle that voice commands should transform text in visually intuitive ways that mirror the user's mental model. When a user says "Actually, scratch that," they expect the incorrect text to visibly disappear with a clear indication of what was removed. When they say "spell that," they expect the incorrect characters to be visibly corrected.

### Animation Philosophy

1. **Simultaneous Multi-layered Animations** - All visual effects (strikethrough, opacity changes, width transitions) happen concurrently, not sequentially
2. **Document Flow Preservation** - Text reflows naturally using browser layout rather than manual positioning
3. **Pixel-Perfect Measurements** - All width transitions use actual measured pixel values for smooth animations
4. **Semantic State Management** - Each text segment tracks its animation state independently

### Technical Architecture

## Data Structures

### TextSegment Interface

```typescript
interface TextSegment {
  text: string;
  type: 'normal' | 'strikethrough' | 'insertion';
  replacementText?: string; // For character-level replacements
}
```

**Key Design Decisions:**
- `type` determines the animation pattern (removal, replacement, insertion)
- `replacementText` enables character-level corrections like spelling fixes
- Segments preserve exact whitespace using `whiteSpace: 'pre'`

### DisplayedSegment State Machine

```typescript
interface DisplayedSegment {
  segment: TextSegment;
  text: string;
  shouldStrike: boolean;        // Strikethrough animation active
  isDisappearing: boolean;      // Width collapsing to 0 (removal)
  isReplacing: boolean;         // Crossfading to new text (replacement)
  isInserting: boolean;         // Expanding from 0 (insertion)
  measuredWidth?: number;       // Current/target width
  replacementWidth?: number;    // Target width for replacement text
}
```

**State Flow:**
1. **Initial:** `shouldStrike: false, isDisappearing: false, isReplacing: false, isInserting: false`
2. **Strikethrough Trigger:** `shouldStrike: true`
3. **Animation Start:** Based on type → appropriate boolean becomes `true`
4. **Animation Complete:** Width transitions complete, success state triggered

## Component Architecture

### TricksComponent

The main container that manages:
- Auto-rotation through different trick examples (4-second intervals)
- Hover state management (pauses rotation, shows specific trick)
- Success glow animations
- Card transitions using Framer Motion's `layoutId`

### SegmentTypewriter

The core animation engine that:
- Types out text character-by-character (25ms per character)
- Manages segment state transitions
- Coordinates simultaneous animations
- Measures text widths for smooth transitions

**Key Implementation Details:**
- Uses `requestAnimationFrame` for browser synchronization
- Implements dual-RAF pattern for reliable style application
- Maintains timeout registry for cleanup
- Tracks completion state to prevent race conditions

## Animation Patterns

### 1. Removal Pattern ("Actually, scratch that")

**Example:** `"I need it by 12pm Friday. Actually, scratch that. 11am Thursday."`

**Animation Sequence:**
1. **Typewriter Phase (variable duration):** Characters appear one-by-one
2. **Strikethrough Phase (500ms delay):** "12pm Friday. Actually, scratch that." gets strikethrough line
3. **Collapse Phase (1000ms):** Struck text slides right-to-left while width collapses to 0
4. **Success Glow (1000ms):** Container glows to indicate successful transformation

**Technical Implementation:**
```css
/* Strikethrough animation */
@keyframes strikethrough-sync {
  0% { background-size: 0% 2px; }
  100% { background-size: 100% 2px; }
}

/* Disappearance animation with strikethrough preservation */
@keyframes disappear-reverse {
  0% { 
    color: rgba(255, 255, 255, 0.6);
    clip-path: inset(0 0 0 0);
    background-size: 100% 2px;
  }
  100% { 
    color: rgba(255, 255, 255, 0.6);
    clip-path: inset(0 100% 0 0);
    background-size: 100% 2px;
  }
}
```

### 2. Replacement Pattern (Character-level Spelling)

**Example:** `"Have you seen Google's new Gamma model? Spell that G-E-M-M-A."` → `"Have you seen Google's new Gemma model?"`

**Animation Sequence:**
1. **Typewriter Phase:** Full sentence typed out
2. **Simultaneous Strikethrough (500ms delay):** Both "a" and "Spell that G-E-M-M-A." get strikethrough
3. **Dual Animation (1000ms):**
   - "Spell that..." collapses to 0 width (removal pattern)
   - "a" crossfades to "e" while width adjusts from ~8px to ~7px
4. **Success Glow:** Container glows to indicate successful correction

**Technical Implementation:**
```tsx
// Crossfade replacement rendering
{displayed.segment.replacementText && displayed.isReplacing ? (
  <span className="relative inline-block">
    <span className="replacement-fade-out">{displayed.text}</span>
    <span className="replacement-fade-in absolute top-0 left-0">
      {displayed.segment.replacementText}
    </span>
  </span>
) : /* regular strikethrough */}
```

```css
@keyframes replacement-fade-out {
  0% { opacity: 1; background-size: 100% 2px; }
  100% { opacity: 0; background-size: 100% 2px; }
}

@keyframes replacement-fade-in {
  0% { opacity: 0; }
  100% { opacity: 1; }
}
```

### 3. Insertion Pattern (Add Quotes)

**Example:** `"They said I was quote-unquote lucky."` → `"They said I was "lucky"."`

**Animation Sequence:**
1. **Typewriter Phase:** Full sentence typed out
2. **Strikethrough Phase (500ms delay):** "quote-unquote " gets strikethrough
3. **Dual Animation (1000ms):**
   - "quote-unquote " crossfades to `"` and width collapses ~120px → ~8px
   - Closing `"` materializes from 0 width to measured width with fade-in
4. **Success Glow:** Container glows to indicate successful transformation

**Technical Implementation:**
```tsx
// Insertion rendering - starts invisible, expands to measured width
{displayed.segment.type === 'insertion' ? (
  <span className={displayed.isInserting ? 'insertion-fade-in' : ''} 
        style={{ opacity: displayed.isInserting ? undefined : 0 }}>
    {displayed.text}
  </span>
) : /* other types */}
```

```css
@keyframes insertion-fade-in {
  0% { opacity: 0; }
  100% { opacity: 1; }
}

.segment-inserting {
  transition: width 1s cubic-bezier(0.4, 0.0, 0.2, 1);
}
```

## Width Measurement System

### The Measurement Challenge

Text that hasn't been rendered yet (replacement text, insertion text) needs pixel measurements for smooth width transitions. Hardcoded widths are brittle and don't account for font changes, kerning, or subpixel positioning.

### Temporary DOM Measurement Solution

```typescript
const measureTextWidth = (text: string, referenceElement: HTMLElement) => {
  const tempSpan = document.createElement('span');
  tempSpan.style.cssText = window.getComputedStyle(referenceElement).cssText;
  tempSpan.style.visibility = 'hidden';
  tempSpan.style.position = 'absolute';
  tempSpan.textContent = text;
  document.body.appendChild(tempSpan);
  const width = tempSpan.offsetWidth;
  document.body.removeChild(tempSpan);
  return width;
};
```

**Process:**
1. Create invisible span with exact computed styles from reference element
2. Set target text content
3. Measure actual pixel width
4. Clean up temporary element
5. Use measurement for animation endpoints

### Width Transition Implementation

```tsx
<span
  className={`inline-block overflow-hidden ${
    displayed.isDisappearing ? 'segment-collapsing' : ''
  } ${
    displayed.isReplacing ? 'segment-replacing' : ''
  } ${
    displayed.isInserting ? 'segment-inserting' : ''
  }`}
  style={{
    width: displayed.measuredWidth !== undefined 
      ? (displayed.isDisappearing 
          ? '0px' 
          : displayed.isReplacing && displayed.replacementWidth !== undefined
            ? `${displayed.replacementWidth}px`
            : displayed.isInserting
              ? `${displayed.measuredWidth}px`
              : `${displayed.measuredWidth}px`)
      : displayed.segment.type === 'insertion' && !displayed.isInserting
        ? '0px'
        : 'auto',
  }}
>
```

## Rectangle Behavior and Positioning

### Container Layout

The text container uses `inline-flex` to enable natural document reflow as segment widths change:

```tsx
<div className="text-sm leading-relaxed text-white font-sans">
  <span className="inline-flex items-baseline">
    {/* Segments rendered here */}
  </span>
</div>
```

**Key Properties:**
- `inline-flex`: Allows horizontal layout while maintaining inline behavior
- `items-baseline`: Ensures text alignment remains consistent during animations
- `font-sans`: Consistent font rendering across all segments

### Segment Positioning Strategy

Each segment is an `inline-block` with explicit width control:

1. **Normal State:** `width: auto` (natural text width)
2. **Measured State:** `width: [measured]px` (after width calculation)
3. **Animating State:** `width: [target]px` with CSS transition
4. **Final State:** `width: 0px` (removal) or new width (replacement/insertion)

**Overflow Management:**
```css
.segment-collapsing,
.segment-replacing,
.segment-inserting {
  overflow: hidden; /* Prevent text spill during width transitions */
}
```

### Smart Strikethrough Splitting

Spaces are handled intelligently to maintain natural text flow:

```typescript
const splitTextForStrikethrough = (text: string) => {
  const leadingSpaces = text.match(/^(\s*)/)?.[1] || '';
  const trailingSpaces = text.match(/(\s*)$/)?.[1] || '';
  const middleContent = text.slice(leadingSpaces.length, text.length - trailingSpaces.length);

  return { leadingSpaces, middleContent, trailingSpaces };
};
```

**Why This Matters:**
- Preserves leading spaces (prevents text from collapsing to left)
- Preserves trailing spaces (maintains gap with following text)
- Only the middle content gets strikethrough animation
- Spaces remain visible during collapse animation

## Text Streaming and Real-time Updates

### Typewriter Implementation

```typescript
useEffect(() => {
  if (currentSegmentIndex >= segments.length) {
    setIsTyping(false);
    return;
  }

  const currentSegment = segments[currentSegmentIndex];
  const segmentText = currentSegment.text;

  if (currentCharIndex < segmentText.length) {
    const timeout = setTimeout(() => {
      const newChar = segmentText[currentCharIndex];

      setDisplayedSegments(prev => {
        const updated = [...prev];
        if (updated.length <= currentSegmentIndex) {
          updated.push({ 
            segment: currentSegment, 
            text: newChar, 
            shouldStrike: false, 
            isDisappearing: false,
            isReplacing: false,
            isInserting: false
          });
        } else {
          updated[currentSegmentIndex].text += newChar;
        }
        return updated;
      });

      setCurrentCharIndex(prev => prev + 1);
    }, 25); // 25ms per character for faster typing

    return () => clearTimeout(timeout);
  } else {
    setCurrentSegmentIndex(prev => prev + 1);
    setCurrentCharIndex(0);
  }
}, [currentSegmentIndex, currentCharIndex, segments]);
```

**Character Timing:** 25ms per character (40 characters per second) - fast enough to be engaging but slow enough to follow

### Animation Triggering Logic

Animations are triggered only after ALL text is completely typed:

```typescript
useEffect(() => {
  if (isTyping || displayedSegments.length !== segments.length || triggeredAnimationsRef.current) {
    return;
  }

  triggeredAnimationsRef.current = true;

  // Calculate which segments need animation
  const strikethroughIndices = displayedSegments
    .map((displayed, index) => (displayed.segment.type === "strikethrough" && !displayed.shouldStrike ? index : -1))
    .filter(index => index !== -1);

  // Schedule animations with precise timing
  scheduleTimeout(() => {
    setDisplayedSegments(prev => {
      const updated = [...prev];
      strikethroughIndices.forEach(index => {
        updated[index].shouldStrike = true;
      });
      return updated;
    });
  }, 500); // 500ms delay after typing complete
}, [isTyping, displayedSegments.length, segments.length]);
```

### State Synchronization

The system uses multiple safeguards to prevent race conditions:

1. **`triggeredAnimationsRef.current`** - Prevents multiple animation triggers
2. **`completionSignalledRef.current`** - Prevents multiple completion callbacks
3. **`timeout registries`** - Clean up pending timeouts on unmount
4. **`isMountedRef.current`** - Prevents state updates on unmounted components

## CSS Classes and Styling Approach

### Core Animation Classes

```css
/* Base segment transition classes */
.segment-collapsing {
  transition: width 1s cubic-bezier(0.4, 0.0, 0.2, 1) !important;
}

.segment-replacing {
  transition: width 1s cubic-bezier(0.4, 0.0, 0.2, 1) !important;
}

.segment-inserting {
  transition: width 1s cubic-bezier(0.4, 0.0, 0.2, 1) !important;
}

/* Strikethrough animation */
.strikethrough-animate {
  background-repeat: no-repeat;
  background-image: linear-gradient(to right, rgba(255, 255, 255, 0.6) 0%, rgba(255, 255, 255, 0.6) 100%);
  background-position: 0% 50%;
  background-size: 0% 2px;
  animation: strikethrough-sync 0.25s ease-out forwards;
}

/* Disappearance with strikethrough preservation */
.disappear-reverse {
  animation: disappear-reverse 1s cubic-bezier(0.4, 0.0, 0.2, 1) forwards;
}
```

### Easing Curves and Timing

All animations use consistent timing for visual cohesion:

- **Duration:** 1000ms (1 second) for all width transitions
- **Easing:** `cubic-bezier(0.4, 0.0, 0.2, 1)` - Material Design's "decelerate" curve
- **Strikethrough:** 250ms with `ease-out`
- **Success Glow:** 1000ms with `ease-out`

### Container Styling

```css
/* Main container with glassmorphic styling */
.card-floating {
  background-color: rgba(var(--surface-base-rgb), var(--surface-alpha-sm));
  background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 250 250' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.75' numOctaves='2' stitchTiles='/%3E%3C/filter%3E%3Crect width='100%' height='100%' filter='url(%23noiseFilter)' opacity='0.04'/%3E%3C/svg%3E");
  border: 1px solid var(--stroke-fg);
  box-shadow: var(--shadow-floating);
}

/* Success glow animation */
@keyframes success-container-glow {
  0% { box-shadow: 0 1px 3px rgba(0, 0, 0, 0.5); }
  50% { 
    box-shadow: 
      0 1px 3px rgba(0, 0, 0, 0.5),
      0 0 0 2px rgba(255, 255, 255, 0.12),
      0 0 12px 2px rgba(255, 255, 255, 0.25), 
      0 0 24px 2px rgba(255, 255, 255, 0.12);
  }
  100% { box-shadow: 0 1px 3px rgba(0, 0, 0, 0.5); }
}

.success-container-glow {
  animation: success-container-glow 1s ease-out forwards;
}
```

## Space and Character Handling

### Whitespace Preservation

All text segments use `whiteSpace: 'pre'` to preserve exact spacing:

```tsx
<span style={{ whiteSpace: 'pre' }}>
  {text}
</span>
```

**Critical Importance:**
- Preserves multiple spaces between words
- Maintains leading/trailing spaces in segments
- Ensures consistent text flow during animations
- Prevents HTML whitespace collapsing

### Character-Level Splitting

For spelling corrections, text is split at exact character boundaries:

```typescript
// Gamma → Gemma correction
segments: [
  { text: "Have you seen Google's new G", type: "normal" },
  { text: "a", type: "strikethrough", replacementText: "e" }, // Single character
  { text: "mma model? ", type: "normal" },
  { text: "Spell that G-E-M-M-A.", type: "strikethrough" }
]
```

**Splitting Strategy:**
- Identify exact character to replace within word
- Create segments before, target, and after
- Use single characters for precise corrections
- Handle multi-character replacements similarly

### Space Optimization in Examples

Examples are carefully crafted to avoid spacing issues:

```typescript
// GOOD: No double spaces when middle disappears
segments: [
  { text: "I need it by ", type: "normal" },           // Ends with space
  { text: "12pm Friday. Actually, scratch that. ", type: "strikethrough" }, // Ends with space
  { text: "11am Thursday.", type: "normal" }          // No leading space
]

// AVOID: Double spaces when middle disappears
segments: [
  { text: "I need it by ", type: "normal" },
  { text: "12pm Friday. Actually, scratch that.", type: "strikethrough" }, // No trailing space
  { text: " 11am Thursday.", type: "normal" }          // Double space result
]
```

## Example Implementations and Patterns

### Current Trick Examples

```typescript
const tricks: Trick[] = [
  {
    id: "correction",
    title: "Quick Corrections",
    description: "Fix mistakes by saying what you actually meant",
    segments: [
      { text: "I need it by ", type: "normal" },
      { text: "12pm Friday. Actually, scratch that. ", type: "strikethrough" },
      { text: "11am Thursday.", type: "normal" }
    ]
  },
  {
    id: "spelling",
    title: "Spelling Words",
    description: "Spell out words exactly as you want them",
    segments: [
      { text: "Have you seen Google's new G", type: "normal" },
      { text: "a", type: "strikethrough", replacementText: "e" },
      { text: "mma model? ", type: "normal" },
      { text: "Spell that G-E-M-M-A.", type: "strikethrough" }
    ]
  },
  {
    id: "quotes",
    title: "Add Quotes",
    description: "Transform verbose phrases into clean punctuation",
    segments: [
      { text: "They said I was ", type: "normal" },
      { text: "quote-unquote ", type: "strikethrough", replacementText: '"' },
      { text: "lucky.", type: "normal" },
      { text: '"', type: "insertion" }
    ]
  },
  {
    id: "replace",
    title: "Replace Words",
    description: "Change specific words or phrases instantly",
    segments: [
      { text: "Now we're dictating on ", type: "normal" },
      { text: "Windows. Wait, replace Windows with ", type: "strikethrough" },
      { text: "MacOS", type: "normal" }
    ]
  },
  {
    id: "emphasis",
    title: "Emphasize Words",
    description: "Add emphasis to specific words or phrases",
    segments: [
      { text: "Okay that was like", type: "normal" },
      { text: " really ", type: "strikethrough", replacementText: " **really** " },
      { text: "good.", type: "normal" },
      { text: " Emphasize really ", type: "strikethrough" }
    ]
  }
];
```

### Pattern Library

The system supports these voice command patterns:

**Removal Patterns:**
- "Actually, scratch that" - Remove previous phrase
- "Never mind" - Cancel last statement
- "Delete that" - Remove specific text
- "Go back" - Undo last dictation

**Replacement Patterns:**
- "Spell that [letters]" - Character-level spelling correction
- "I meant [word]" - Replace with different word
- "Change [word] to [word]" - Specific word replacement
- "[word]. Fix that." - Implicit correction

**Insertion Patterns:**
- "Add quotes" - Wrap text in quotation marks
- "Add emphasis" - Add bold/markup to text
- "Add comma" - Insert punctuation
- "Put [text] before/after [text]" - Contextual insertion

### Extending the System

Adding new tricks follows this pattern:

```typescript
{
  id: "unique-id",
  title: "Human-Readable Title",
  description: "Brief explanation of what it does",
  segments: [
    // Combine normal, strikethrough, and insertion segments
    // Use replacementText for character-level changes
  ]
}
```

**Best Practices:**
1. **Keep examples concise** - 10-15 words maximum
2. **Use realistic scenarios** - Common dictation corrections
3. **Demonstrate single concepts** - One voice command per trick
4. **Preserve natural spacing** - Avoid awkward text flow
5. **Test animations** - Ensure width transitions work smoothly

## Performance Considerations

### DOM Optimization

- **will-change properties** strategically applied for GPU acceleration
- **transform: translateZ(0)** for hardware acceleration
- **backface-visibility: hidden** to prevent flicker
- **contain: paint** for isolation

### Memory Management

- **Timeout cleanup** on component unmount prevents memory leaks
- **Ref-based DOM access** instead of repeated queries
- **State reset** when segments change
- **Temporary element cleanup** after width measurements

### Animation Performance

- **CSS transitions** over JavaScript animations where possible
- **requestAnimationFrame** for DOM synchronization
- **Debounced resize handlers** to prevent layout thrashing
- **Reduced motion support** for accessibility

## Accessibility Considerations

### Screen Reader Support

- **ARIA live regions** for animation state announcements
- **Semantic text structure** maintained throughout animations
- **Keyboard navigation** supported for trick selection
- **Focus management** during hover states

### Reduced Motion

```css
@media (prefers-reduced-motion: reduce) {
  .strikethrough-animate,
  .disappear-reverse,
  .replacement-fade-out,
  .replacement-fade-in,
  .insertion-fade-in,
  .segment-collapsing,
  .segment-replacing,
  .segment-inserting {
    animation: none !important;
    transition: none !important;
  }
}
```

### Color Contrast

- **Gray strikethrough color** (`rgba(255, 255, 255, 0.6)`) provides sufficient contrast
- **Success glow** uses white with appropriate opacity
- **Glassmorphic backgrounds** maintain text readability

## Browser Compatibility

### Critical Features Used

- **CSS custom properties** - Supported in all modern browsers
- **CSS Grid and Flexbox** - Layout management
- **CSS animations and transitions** - Core animation system
- **requestAnimationFrame** - Animation synchronization
- **offsetWidth measurement** - Width calculation
- **getComputedStyle** - Style inheritance

### Fallback Strategies

- **Inline styles** for critical width values
- **Feature detection** for animation support
- **Graceful degradation** if animations fail
- **Static text display** as ultimate fallback

## Implementation Checklist

### When Reimplementing This System

**Core Components:**
1. [ ] SegmentTypewriter component with character-by-character typing
2. [ ] TricksComponent container with auto-rotation
3. [ ] TextSegment and DisplayedSegment interfaces
4. [ ] Width measurement system using temporary DOM elements
5. [ ] Animation state machine with boolean flags

**CSS Classes:**
1. [ ] `.strikethrough-animate` for strikethrough line animation
2. [ ] `.disappear-reverse` for right-to-left wipe effect
3. [ ] `.segment-collapsing` for width transitions
4. [ ] `.replacement-fade-out/in` for crossfade replacement
5. [ ] `.insertion-fade-in` for text materialization
6. [ ] `.success-container-glow` for completion feedback

**Animation Patterns:**
1. [ ] Typewriter effect (25ms per character)
2. [ ] Strikethrough trigger (500ms delay)
3. [ ] Width measurement and transition (1000ms)
4. [ ] Success glow (1000ms)
5. [ ] Auto-rotation (4000ms cycle)

**State Management:**
1. [ ] Segment state tracking (shouldStrike, isDisappearing, etc.)
2. [ ] Timeout cleanup on unmount
3. [ ] Animation completion callbacks
4. [ ] Hover state interruption handling
5. [ ] Race condition prevention

**Accessibility:**
1. [ ] Reduced motion support
2. [ ] ARIA live regions
3. [ ] Keyboard navigation
4. [ ] Color contrast compliance
5. [ ] Focus management

## Conclusion

This text editing behavior system demonstrates a sophisticated approach to real-time text transformation that feels both magical and intuitive. The key innovations include:

1. **Unified Animation Architecture** - Three primitives (removal, replacement, insertion) cover all voice command patterns
2. **Pixel-Perfect Width Management** - Dynamic measurement system enables smooth transitions for any text
3. **Natural Document Flow** - Leverages browser layout instead of manual positioning
4. **Semantic State Machine** - Clear, maintainable state tracking for complex animations
5. **Performance-Optimized** - GPU-accelerated CSS animations with proper cleanup

The system is designed to be extensible - adding new voice command demonstrations is as simple as defining new segment arrays. The animation engine handles all the complexity of timing, measurement, and visual effects automatically.

This implementation serves as an excellent reference for building sophisticated text editing interfaces that need to show real-time transformations in an engaging, user-friendly way.
