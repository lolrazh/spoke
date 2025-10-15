# Text Transition System Documentation

## Overview

This document provides a comprehensive technical breakdown of the sophisticated text transition system implemented in Sonic Flow's onboarding meta-directives page. The system creates smooth, typewriter-style text animations with intelligent strikethrough, replacement, and insertion effects that demonstrate the app's editing capabilities.

## Architecture

### Core Components

1. **MetaDirectivesComponent** (`src/components/meta/MetaDirectivesComponent.tsx`)
   - Main orchestrator managing trick selection and card transitions
   - Handles user interaction (hover) and automated cycling
   - Controls animation timing and state management

2. **SegmentTypewriter** (nested component)
   - Renders individual text segments with typewriter effect
   - Manages character-by-character typing animation
   - Handles strikethrough, replacement, and insertion animations

3. **CSS Animation System** (`src/index.css`)
   - Provides keyframe animations for all text effects
   - Handles smooth width transitions for layout changes
   - Manages container glow and visual feedback

## Data Structure

### Trick Definition

```typescript
interface Trick {
  id: string;
  title: string;
  description: string;
  segments: TextSegment[];
}

interface TextSegment {
  text: string;
  type: 'normal' | 'strikethrough' | 'insertion';
  replacementText?: string; // For character-level replacements
}
```

### Example Trick Data

```typescript
{
  id: "correction",
  title: "Quick Corrections",
  description: "Fix mistakes by saying what you actually meant",
  segments: [
    { text: "I need it by ", type: "normal" },
    { text: "12pm Friday. Actually, scratch that. ", type: "strikethrough" },
    { text: "11am Thursday.", type: "normal" }
  ]
}
```

## Animation Flow

### Phase 1: Card Entry Animation

**Duration**: 300ms (MOTION.durations.standard)
**Easing**: Cubic-bezier(0.25, 0.8, 0.25, 1)

1. Card enters with scale and opacity animation
2. Tag cloud appears with staggered animations
3. Container settles into "steady" state

```typescript
const tagVariants = {
  hidden: { opacity: 0, scale: 0.9 },
  visible: {
    opacity: 1,
    scale: 1,
    transition: {
      duration: MOTION.durations.standard,
      ease: TRANSITION_EASE,
    },
  },
};
```

### Phase 2: Typewriter Effect

**Character Timing**: 25ms per character
**Algorithm**:
1. Iterate through segments sequentially
2. For each segment, type characters one by one
3. Update React state to trigger re-renders
4. Show blinking cursor during typing

```typescript
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
  }, 25); // 25ms per character
}
```

### Phase 3: Post-Typing Animations (500ms delay)

After all text is typed, a 500ms pause creates dramatic tension before effects begin.

#### 3a: Strikethrough Animation (250ms)

- Applies `strikethrough-animate` class to strikethrough segments
- Background line expands from 0% to 100% width
- Text color fades from white to 60% opacity

```css
@keyframes strikethrough-sync {
  0% {
    color: rgba(255, 255, 255, 1);
    background-position: 0% 50%;
    background-size: 0% 2px;
  }
  100% {
    color: rgba(255, 255, 255, 0.6);
    background-position: 0% 50%;
    background-size: 100% 2px;
  }
}

.strikethrough-animate {
  background-repeat: no-repeat;
  background-image: linear-gradient(
    to right,
    rgba(255, 255, 255, 0.6) 0%,
    rgba(255, 255, 255, 0.6) 100%
  );
  background-position: 0% 50%;
  background-size: 0% 2px;
  animation: strikethrough-sync 0.25s ease-out forwards;
}
```

#### 3b: Width Measurement and Collapse

**Critical Technique**: Measure rendered text width before animation to ensure smooth layout transitions.

```typescript
// Measure widths and trigger disappearance/replacement
scheduleTimeout(() => {
  strikethroughIndices.forEach(index => {
    const element = segmentRefs.current[index];
    if (!element) return;

    const segment = displayedSegments[index].segment;
    const isReplacement = !!segment.replacementText;

    if (isReplacement) {
      // For replacement: measure both old and new widths
      const oldWidth = element.offsetWidth;

      // Temporarily measure replacement text width
      const tempSpan = document.createElement("span");
      tempSpan.style.cssText = window.getComputedStyle(element).cssText;
      tempSpan.style.visibility = "hidden";
      tempSpan.style.position = "absolute";
      tempSpan.textContent = segment.replacementText || "";
      document.body.appendChild(tempSpan);
      const newWidth = tempSpan.offsetWidth;
      document.body.removeChild(tempSpan);

      // Set widths and trigger replacement
      setDisplayedSegments(prev => {
        const updated = [...prev];
        updated[index].measuredWidth = oldWidth;
        updated[index].replacementWidth = newWidth;
        return updated;
      });
    }
  });
}, 1050); // 500ms delay + 250ms strikethrough + 300ms pause
```

#### 3c: Layout Transitions (1000ms)

**Width Animations**: Using CSS transitions with cubic-bezier easing

```css
.segment-collapsing {
  transition: width 1s cubic-bezier(0.4, 0.0, 0.2, 1) !important;
}

.segment-replacing {
  transition: width 1s cubic-bezier(0.4, 0.0, 0.2, 1) !important;
}

.segment-inserting {
  transition: width 1s cubic-bezier(0.4, 0.0, 0.2, 1) !important;
}
```

### Phase 4: Success Feedback (2050ms total)

**Container Glow Animation**:
```css
@keyframes success-container-glow {
  0% {
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.5);
  }
  50% {
    box-shadow: 
      0 1px 3px rgba(0, 0, 0, 0.5),
      0 0 0 2px rgba(255, 255, 255, 0.12),
      0 0 12px 2px rgba(255, 255, 255, 0.25), 
      0 0 24px 2px rgba(255, 255, 255, 0.12);
  }
  100% {
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.5);
  }
}
```

## Advanced Techniques

### Smart Strikethrough Splitting

The system intelligently splits text to handle leading/trailing spaces correctly:

```typescript
const splitTextForStrikethrough = (text: string) => {
  const leadingSpaces = text.match(/^(\s*)/)?.[1] || '';
  const trailingSpaces = text.match(/(\s*)$/)?.[1] || '';
  const middleContent = text.slice(leadingSpaces.length, text.length - trailingSpaces.length);

  return { leadingSpaces, middleContent, trailingSpaces };
};
```

This ensures spaces don't get strikethrough lines while maintaining proper layout.

### Character Replacement System

For single character replacements (like 'a' → 'e'):

1. Measure both old and new character widths
2. Apply crossfade animation during width transition
3. Maintain layout stability throughout

```css
@keyframes replacement-fade-out {
  0% {
    opacity: 1;
    color: rgba(255, 255, 255, 0.6);
  }
  100% {
    opacity: 0;
    color: rgba(255, 255, 255, 0.6);
  }
}

@keyframes replacement-fade-in {
  0% {
    opacity: 0;
  }
  100% {
    opacity: 1;
  }
}
```

### Insertion Animation

Inserted text materializes from nothing:

```css
@keyframes insertion-fade-in {
  0% {
    opacity: 0;
  }
  100% {
    opacity: 1;
  }
}

.insertion-fade-in {
  animation: insertion-fade-in 1s cubic-bezier(0.4, 0.0, 0.2, 1) forwards;
  display: inline-block;
}
```

## State Management

### Component State

```typescript
const [activeCardIndex, setActiveCardIndex] = useState(0);
const [highlightedIndex, setHighlightedIndex] = useState(0);
const [showCardGlow, setShowCardGlow] = useState(false);
const [cardPhase, setCardPhase] = useState<"entering" | "steady" | "exiting">("entering");
const [cycleId, setCycleId] = useState(0);
```

### Segment Display State

```typescript
type DisplayedSegment = {
  segment: TextSegment;
  text: string;
  shouldStrike: boolean;
  isDisappearing: boolean;
  isReplacing: boolean;
  isInserting: boolean;
  measuredWidth?: number;
  replacementWidth?: number;
};
```

## Interaction System

### Hover States

1. **Tag Hovering**: Immediately switches to highlighted trick
2. **Force Restart**: Replays current trick if hovering over active card
3. **State Tracking**: Uses `hoveredIndexRef` to prevent auto-cycling during interaction

```typescript
const handlePointerEnter = (index: number) => {
  hoveredIndexRef.current = index;
  const forceRestart = index === activeCardIndex;
  beginCardTransition(index, {
    delayBeforeExit: 0,
    forceRestart,
    immediateHighlight: true,
  });
};
```

### Auto-Cycling Logic

**Cycle Duration**: ~6 seconds total per trick
- Typing: Variable (depends on text length)
- Post-animation delay: 600ms
- Success glow: 1000ms

```typescript
const handleTypewriterComplete = React.useCallback(() => {
  if (hoveredIndexRef.current !== null) return;
  const nextIndex = (highlightedIndex + 1) % tricks.length;
  const willLoopSameIndex = nextIndex === highlightedIndex;
  beginCardTransition(nextIndex, {
    delayBeforeExit: POST_ANIMATION_DELAY_MS,
    forceRestart: willLoopSameIndex,
  });
}, [beginCardTransition, highlightedIndex]);
```

## Performance Optimizations

### Memory Management

1. **Timeout Cleanup**: All scheduled timeouts are tracked and cleaned up
2. **Ref Management**: DOM refs are properly cleared on unmount
3. **Animation Frame Cancellation**: RAF callbacks are cancelled when needed

```typescript
const clearScheduledTimeouts = React.useCallback(() => {
  timeoutsRef.current.forEach(timeoutId => window.clearTimeout(timeoutId));
  timeoutsRef.current = [];
}, []);
```

### Rendering Optimizations

1. **will-change CSS**: GPU acceleration for animated elements
2. **transform3d**: Hardware acceleration hints
3. **Containment**: CSS contain properties for layout isolation

```css
.segment-collapsing,
.segment-replacing,
.segment-inserting {
  will-change: width;
  contain: layout;
}
```

## Responsive Design

### Container Sizing

```css
.meta-directive-tag {
  padding: 4px 8px;
  height: auto;
  min-height: 24px;
  font-size: 12px;
  font-weight: 500;
}
```

### Text Overflow

```css
.text-left.overflow-x-auto.whitespace-nowrap {
  /* Handles long text gracefully */
}
```

## Accessibility

### Focus Management

- Tags are focusable and respond to keyboard navigation
- Focus states mirror hover states
- Screen reader support through proper ARIA attributes

### Reduced Motion Support

```css
@media (prefers-reduced-motion: reduce) {
  .segment-collapsing,
  .segment-replacing,
  .segment-inserting {
    transition: none !important;
  }
  
  .success-container-glow {
    animation: none !important;
  }
}
```

## Implementation Guide for Replication

### Step 1: Set up Data Structure

Create the trick data structure with segments and types.

### Step 2: Implement Typewriter Component

Build the SegmentTypewriter component with character-by-character rendering.

### Step 3: Add CSS Animations

Implement the keyframe animations for strikethrough, replacement, and insertion effects.

### Step 4: Handle Width Measurement

Implement the critical width measurement technique for smooth layout transitions.

### Step 5: Add State Management

Set up proper state management for segments, animations, and user interactions.

### Step 6: Implement Card Transitions

Add the card switching logic with Framer Motion or similar.

### Step 7: Add Interaction Handlers

Implement hover states and auto-cycling logic.

## Common Pitfalls and Solutions

### Pitfall 1: Layout Shift During Animations

**Solution**: Always measure text width before starting width transitions. Use temporary DOM elements for measurement.

### Pitfall 2: Animation Timing Issues

**Solution**: Use a centralized timeout management system with proper cleanup. Consider using a state machine for complex animation sequences.

### Pitfall 3: Performance Issues

**Solution**: Use CSS transforms instead of layout properties where possible. Implement proper cleanup in useEffect hooks.

### Pitfall 4: Text Rendering Inconsistencies

**Solution**: Use consistent font metrics and ensure all text elements have the same styling properties during measurement.

## Debugging Tools

### Development Flags

```typescript
const devFlags = {
  fastAnimations: isDevelopment,
  showDebugOverlay: isDevelopment,
};
```

### Performance Monitoring

- Use React DevTools Profiler for component performance
- Monitor Chrome DevTools Performance panel for animation smoothness
- Check CSS Triggers for layout thrashing

## Future Enhancements

### Potential Improvements

1. **Variable Typing Speed**: Dynamic timing based on content complexity
2. **Enhanced Replacement Effects**: More sophisticated character morphing
3. **Sound Integration**: Typing sounds and completion chimes
4. **Custom Easing**: Content-specific animation curves
5. **Performance Budgeting**: Automatic quality adjustments based on device capabilities

### Extensibility

The system is designed to be easily extended with new text effects and animation types while maintaining the core timing and state management architecture.

---

This documentation provides a complete technical foundation for understanding and replicating the sophisticated text transition system used in Sonic Flow's onboarding experience.
