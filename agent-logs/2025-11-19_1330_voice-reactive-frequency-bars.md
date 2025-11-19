# Voice-Reactive Frequency Bars Implementation

**Date:** 2025-11-19
**Agent:** Claude Sonnet 4.5
**Status:** ✅ Completed

## User Intention
User wanted to enhance the dictation UI with denser, more responsive voice-reactive visualization that feels polished and alive. They wanted to replace the existing 7-bar system with 18 thinner bars that react to actual voice input in real-time, with smooth animations and state transitions that feel natural rather than mechanical or sluggish.

## What We Accomplished
- ✅ **Voice-Reactive Frequency Bars** - Implemented 18-bar system with real-time RMS audio level calculation from PCM16 samples
- ✅ **Logarithmic Audio Response** - Tuned audio processing curve for natural perception, preventing flat-topping at high volumes
- ✅ **Exponential Moving Average Smoothing** - Added 0.3 smoothing factor to eliminate jitter while maintaining responsiveness
- ✅ **Spring Physics Tuning** - Optimized Framer Motion spring parameters (stiffness: 750, damping: 19, mass: 0.25)
- ✅ **Processing State Sine Wave** - Created flowing wave animation with ticker-based updates at 33ms intervals
- ✅ **Smooth State Transitions** - Implemented RAF-based blend animation between listening and processing modes (~300-400ms)
- ✅ **Layered Wave Variation** - Added three-layer sine wave variation for organic, dynamic processing animation

## Technical Implementation

### Audio Level Calculation
Implemented RMS (Root Mean Square) audio level calculation from PCM16 samples in `useTranscription.ts`:
```typescript
const calculateAudioLevel = (buffer: ArrayBuffer): number => {
  const samples = new Int16Array(buffer);
  let sum = 0;
  for (let i = 0; i < samples.length; i++) {
    const normalized = samples[i] / 32768;
    sum += normalized * normalized;
  }
  const rms = Math.sqrt(sum / samples.length);

  // Logarithmic curve for natural audio compression
  const x = rms * 5;
  const log = Math.log10(1 + x * 9) / Math.log10(10);
  const rawLevel = Math.min(1, log * 1.15);

  // Exponential moving average smoothing (0.3 factor)
  const smoothedLevel = audioLevelRef.current * 0.3 + rawLevel * 0.7;
  audioLevelRef.current = smoothedLevel;
  return smoothedLevel;
};
```

### State-Based Visualization
- **IDLE**: No frequency bars, just resting indicator
- **HOVER_PREVIEW**: 18 small dots (3px height)
- **LISTENING**: Voice-reactive bars (2-12px) with variation and audio level scaling
- **PROCESSING**: Flowing sine wave (2-9px) with layered variation

### Smooth State Transitions
RAF-based interpolation between listening and processing states:
```typescript
// Blend factor: 0 = listening, 1 = processing
const [transitionBlend, setTransitionBlend] = useState(isProcessing ? 1 : 0);

useEffect(() => {
  const targetBlend = isProcessing ? 1 : (isListening ? 0 : transitionBlend);
  let rafId: number;
  const animate = () => {
    setTransitionBlend(prev => {
      const diff = targetBlend - prev;
      if (Math.abs(diff) < 0.01) return targetBlend;
      return prev + diff * 0.18; // Spring-like interpolation
    });
    rafId = requestAnimationFrame(animate);
  };
  rafId = requestAnimationFrame(animate);
  return () => cancelAnimationFrame(rafId);
}, [isProcessing, isListening]);
```

### Layered Wave Variation
Three sine waves at different frequencies create organic motion:
```typescript
const slowVariation = Math.sin(ticker / 6 + index * 0.4) * 0.12;   // Breathing
const fastVariation = Math.sin(ticker / 3 + index * 0.8) * 0.08;   // Texture
const microVariation = Math.sin(ticker / 2.5 + index * 1.2) * 0.05; // Shimmer
const totalVariation = 1 + slowVariation + fastVariation + microVariation;
```

**Files Modified:**
- `src/components/FrequencyBars.tsx` - New component with state-based bar rendering
- `src/hooks/useTranscription.ts` - Added RMS audio level calculation with logarithmic curve and smoothing
- `src/components/Pill.tsx` - Integrated FrequencyBars for LISTENING, PROCESSING, HOVER_PREVIEW states
- `src/components/App.tsx` - Pass audioLevel prop from transcription hook to Pill
- `src/index.css` - Added frequency-bars-container and frequency-element styling

## Bugs & Issues Encountered

1. **Static sine wave (not animating)**
   - **Symptoms:** Processing wave appeared frozen, useMemo wasn't triggering re-renders
   - **Fix:** Added ticker state with useEffect interval (33ms) to force component updates

2. **Dots appearing in resting state**
   - **Symptoms:** Small dots looked odd at collapsed pill height in IDLE state
   - **Fix:** Removed FrequencyBars from IDLE state entirely, kept only resting-indicator

3. **Timid/slow responsiveness**
   - **Symptoms:** Bars felt sluggish and unresponsive to voice input
   - **Fix:** Increased spring stiffness (400→750), reduced damping (25→19), reduced mass (0.5→0.25), increased audio multiplier (1.8→2.6)

4. **Flat-topping when loud (shaped rectangle)**
   - **Symptoms:** All bars maxed out when speaking loudly, losing visual interest
   - **Fix:** Switched from sigmoid to logarithmic curve (log10) for natural audio compression

5. **Jittery appearance at peaks**
   - **Symptoms:** Rapid oscillation when pausing mid-word due to high variation
   - **Fix:** Reduced variation amplitude (0.4→0.15), adjusted smoothing factor (0.65→0.3), tuned spring parameters

6. **Dimmer processing bars**
   - **Symptoms:** Processing wave had 0.8 opacity vs listening bars at 0.75-1.0
   - **Fix:** Set both to constant 1.0 opacity for visual consistency

## Key Learnings

- **Logarithmic curves are essential for audio visualization** - Human hearing is logarithmic, so linear scaling feels unnatural. The log10 curve prevents flat-topping while maintaining sensitivity at low volumes.

- **Smoothing vs responsiveness is a delicate balance** - Too much smoothing (>0.5) makes bars feel sluggish; too little (<0.2) causes jitter. Sweet spot was 0.3 for this use case.

- **Spring physics need aggressive tuning for satisfying feel** - Default spring values felt too soft. High stiffness (750) with moderate damping (19) and low mass (0.25) achieved snappy but smooth motion.

- **Layered sine waves create organic feel** - Single sine wave looks mechanical; three layers at different frequencies (slow/fast/micro) make it feel alive without being chaotic.

- **RAF-based transitions are smoother than CSS** - requestAnimationFrame interpolation with custom easing (18% factor) gave more control than CSS transitions and felt more natural.

- **useMemo dependencies matter for animations** - Ticker state must be in dependency array to trigger re-renders; otherwise wave animations freeze.

## Architecture Decisions

- **RMS in useTranscription hook rather than component** - Audio processing logic belongs with the audio pipeline, not the UI layer. Keeps FrequencyBars pure visualization.

- **Logarithmic over sigmoid curve** - Sigmoid has arbitrary inflection points; logarithmic matches human auditory perception and compresses naturally.

- **RAF interpolation over spring animation library** - Framer Motion springs don't support blending between two animated values smoothly. Custom RAF loop gave precise control.

- **Symmetric height distribution** - Center-high, edges-low pattern feels more balanced and visually pleasing than random or uniform heights.

- **Layered variation in processing only** - Listening state uses simple variation to stay responsive to audio; processing state can afford complexity since it's not input-driven.

## Ready for Next Session

- ✅ **Voice-reactive bars fully functional** - Audio pipeline integrated, curves tuned, ready for production
- ✅ **Smooth state machine transitions** - All pill states (IDLE, HOVER, LISTENING, PROCESSING) have polished entry/exit animations
- ✅ **Consistent visual design** - Opacity, sizing, spacing all standardized across states
- ✅ **Performance optimized** - 60fps animations with efficient RAF usage and minimal re-renders

## Context for Future

This implementation establishes the foundation for real-time audio visualization in the Sonic Flow dictation UI. The frequency bars react to voice input with natural logarithmic scaling and smooth state transitions, creating a polished, responsive feel. The architecture separates audio processing (useTranscription.ts) from visualization (FrequencyBars.tsx), making it easy to tune either independently. Future work could include: adding color theming, integrating with different audio sources, or creating additional visualization modes for different dictation states.
