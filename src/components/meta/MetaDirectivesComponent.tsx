import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";

interface CharacterState {
  char: string;
  status: 'typing' | 'stable' | 'strikethrough-start' | 'strikethrough-progress' | 'strikethrough-end' | 'fading' | 'sliding' | 'final';
  id: string; // Unique identifier for each character
  zone: 'stable-start' | 'strikethrough-zone' | 'stable-end' | 'all'; // Which zone this character belongs to
  originalIndex?: number; // Original position for sliding animations
  scratchProgress?: number; // 0-1 progress of scratch animation
}

interface AnimationStage {
  type: 'typing' | 'strikethrough' | 'fade-out' | 'slide-together' | 'pause';
  duration: number; // in milliseconds
  targetText?: string;
  startIndex?: number;
  endIndex?: number;
  params?: Record<string, unknown>; // Additional parameters for specific animations
}

interface Trick {
  id: string;
  title: string;
  description: string;
  inputText: string;
  zones: {
    'stable-start': { start: number; end: number };
    'strikethrough-zone': { start: number; end: number };
    'stable-end': { start: number; end: number };
  };
  stages: AnimationStage[];
}

const tricks: Trick[] = [
  {
    id: "correction",
    title: "Quick Correction",
    description: "Fix mistakes by saying what you actually meant",
    inputText: "I need it by 12pm Friday. Actually, scratch that. 11am Thursday.",
    zones: {
      'stable-start': { start: 0, end: 13 }, // "I need it by " (never moves)
      'strikethrough-zone': { start: 13, end: 46 }, // "12pm Friday. Actually, scratch that." (will be scratched)
      'stable-end': { start: 46, end: 63 } // " 11am Thursday." (never changes until final join)
    },
    stages: [
      { type: 'typing', duration: 2000, targetText: "I need it by 12pm Friday. Actually, scratch that. 11am Thursday." },
      { type: 'pause', duration: 500 },
      { type: 'strikethrough', duration: 1200, startIndex: 13, endIndex: 46 }, // Gradual scratch animation
      { type: 'pause', duration: 300 },
      { type: 'fade-out', duration: 600, startIndex: 13, endIndex: 46 },
      { type: 'pause', duration: 300 },
      { type: 'slide-together', duration: 500, startIndex: 0, endIndex: 13, joinIndex: 46 }, // Join stable parts
      { type: 'pause', duration: 1000 },
    ]
  },
  // Other tricks will be added later once we perfect the first one
];

const StreamingText: React.FC<{ trick: Trick }> = ({ trick }) => {
  const [characters, setCharacters] = useState<CharacterState[]>([]);
  const [isTyping, setIsTyping] = useState(false);

  // Initialize streaming when trick changes
  useEffect(() => {
    if (!trick) return;

    setCharacters([]);
    startStreaming(trick);
  }, [trick]);

  const getCharacterZone = (index: number): CharacterState['zone'] => {
    if (!trick) return 'all';

    if (index >= trick.zones['stable-start'].start && index < trick.zones['stable-start'].end) {
      return 'stable-start';
    }
    if (index >= trick.zones['strikethrough-zone'].start && index < trick.zones['strikethrough-zone'].end) {
      return 'strikethrough-zone';
    }
    if (index >= trick.zones['stable-end'].start && index < trick.zones['stable-end'].end) {
      return 'stable-end';
    }
    return 'all';
  };

  const startStreaming = (currentTrick: Trick) => {
    let stageIndex = 0;

    const executeStage = () => {
      if (stageIndex >= currentTrick.stages.length) {
        return;
      }

      const stage = currentTrick.stages[stageIndex];

      switch (stage.type) {
        case 'typing':
          if (stage.targetText) {
            typewriterEffect(stage.targetText, stage.duration, () => {
              stageIndex++;
              executeStage();
            });
          }
          break;

        case 'strikethrough':
          if (stage.startIndex !== undefined && stage.endIndex !== undefined) {
            directionalStrikethroughEffect(stage.startIndex, stage.endIndex, stage.duration, () => {
              stageIndex++;
              executeStage();
            });
          }
          break;

        case 'fade-out':
          if (stage.startIndex !== undefined && stage.endIndex !== undefined) {
            fadeOutEffect(stage.startIndex, stage.endIndex, () => {
              stageIndex++;
              executeStage();
            });
          }
          break;

        case 'slide-together':
          if (stage.startIndex !== undefined && stage.endIndex !== undefined && stage.joinIndex !== undefined) {
            slideTogetherEffect(stage.startIndex, stage.endIndex, stage.joinIndex, () => {
              stageIndex++;
              executeStage();
            });
          }
          break;

        case 'pause':
          setTimeout(() => {
            stageIndex++;
            executeStage();
          }, stage.duration);
          break;
      }
    };

    executeStage();
  };

  const typewriterEffect = (targetText: string, duration: number, onComplete: () => void) => {
    setIsTyping(true);
    const charsPerSecond = targetText.length / (duration / 1000);
    const intervalMs = 1000 / charsPerSecond;
    let currentCharIndex = 0;

    const interval = setInterval(() => {
      if (currentCharIndex >= targetText.length) {
        clearInterval(interval);
        setIsTyping(false);
        setCharacters(prev => prev.map(char => ({ ...char, status: 'stable' as const })));
        onComplete();
        return;
      }

      const newChar: CharacterState = {
        char: targetText[currentCharIndex],
        status: 'typing',
        id: `${Date.now()}-${currentCharIndex}`,
        zone: getCharacterZone(currentCharIndex),
        originalIndex: currentCharIndex
      };

      setCharacters(prev => {
        const updated = [...prev, newChar];
        // Mark previous characters as stable (but preserve their zones)
        return updated.map((char, index) =>
          index < updated.length - 1 ? { ...char, status: 'stable' as const } : char
        );
      });

      currentCharIndex++;
    }, intervalMs);
  };

  const directionalStrikethroughEffect = (startIndex: number, endIndex: number, duration: number, onComplete: () => void) => {
    let progress = 0;
    const intervalMs = 50; // Update every 50ms for smooth animation

    const interval = setInterval(() => {
      progress += intervalMs / duration;

      if (progress >= 1) {
        clearInterval(interval);
        // Mark all strikethrough zone characters as fully striked
        setCharacters(prev =>
          prev.map(char =>
            char.zone === 'strikethrough-zone'
              ? { ...char, status: 'strikethrough-end' as const, scratchProgress: 1 }
              : char
          )
        );
        setTimeout(onComplete, 200);
        return;
      }

  
      // Gradually apply strikethrough based on progress
      setCharacters(prev =>
        prev.map(char => {
          if (char.zone !== 'strikethrough-zone') return char;

          const charPosition = char.originalIndex || 0;
          const zonePosition = charPosition - startIndex;
          const zoneWidth = endIndex - startIndex;
          const charProgress = zonePosition / zoneWidth;

          if (charProgress <= progress) {
            const scratchState = progress < 0.33 ? 'strikethrough-start' :
                               progress < 0.66 ? 'strikethrough-progress' :
                               'strikethrough-end';

            return { ...char, status: scratchState as const, scratchProgress: Math.min(1, progress * 1.5) };
          }

          return char;
        })
      );
    }, intervalMs);
  };

  const fadeOutEffect = (startIndex: number, endIndex: number, onComplete: () => void) => {
    // First mark for fading
    setCharacters(prev =>
      prev.map(char =>
        (char.originalIndex !== undefined && char.originalIndex >= startIndex && char.originalIndex < endIndex)
          ? { ...char, status: 'fading' as const }
          : char
      )
    );

    // Remove faded characters after animation
    setTimeout(() => {
      setCharacters(prev =>
        prev.filter(char =>
          char.originalIndex === undefined ||
          !(char.originalIndex >= startIndex && char.originalIndex < endIndex)
        ).map(char => ({ ...char, status: 'final' as const }))
      );
      onComplete();
    }, 600);
  };

  const slideTogetherEffect = (startIndex: number, endIndex: number, joinIndex: number, onComplete: () => void) => {
    // Only slide the stable-end characters towards stable-start
    setCharacters(prev =>
      prev.map(char => {
        if (char.zone === 'stable-end') {
          return { ...char, status: 'sliding' as const };
        }
        return char;
      })
    );

    setTimeout(() => {
      setCharacters(prev => prev.map(char => ({ ...char, status: 'final' as const })));
      onComplete();
    }, 500);
  };

  const renderCharacter = (char: CharacterState) => {
    const baseClasses = "transition-all duration-300 inline-block";

    // Stable zones should never change appearance
    if (char.zone === 'stable-start' || (char.zone === 'stable-end' && char.status !== 'sliding' && char.status !== 'final')) {
      return (
        <span
          key={char.id}
          className={`${baseClasses} text-white`}
          style={{ position: 'relative' }}
        >
          {char.char}
        </span>
      );
    }

    switch (char.status) {
      case 'typing':
        return (
          <span
            key={char.id}
            className={`${baseClasses} text-white opacity-70 animate-pulse`}
          >
            {char.char}
          </span>
        );

      case 'stable':
        return (
          <span
            key={char.id}
            className={`${baseClasses} text-white`}
          >
            {char.char}
          </span>
        );

      case 'strikethrough-start':
        return (
          <span
            key={char.id}
            className={`${baseClasses} text-white/80`}
            style={{ position: 'relative' }}
          >
            {char.char}
            <motion.div
              initial={{ width: "0%" }}
              animate={{ width: "100%" }}
              transition={{ duration: 0.3, ease: "easeOut" }}
              className="absolute bottom-0 left-0 h-0.5 bg-red-400"
            />
          </span>
        );

      case 'strikethrough-progress':
        return (
          <span
            key={char.id}
            className={`${baseClasses} text-white/60`}
            style={{ position: 'relative' }}
          >
            {char.char}
            <div
              className="absolute bottom-0 left-0 h-0.5 bg-red-400"
              style={{
                width: `${(char.scratchProgress || 0) * 100}%`,
                transition: 'width 0.1s ease-out'
              }}
            />
          </span>
        );

      case 'strikethrough-end':
        return (
          <span
            key={char.id}
            className={`${baseClasses} text-white/40 line-through decoration-red-400 decoration-2`}
            style={{ position: 'relative' }}
          >
            {char.char}
          </span>
        );

      case 'fading':
        return (
          <motion.span
            key={char.id}
            initial={{ opacity: 1, scale: 1 }}
            animate={{ opacity: 0, scale: 0.8 }}
            transition={{ duration: 0.6, ease: "easeOut" }}
            className={`${baseClasses} text-white/20`}
            style={{ position: 'absolute' }}
          >
            {char.char}
          </motion.span>
        );

      case 'sliding':
        if (char.zone === 'stable-end') {
          // Calculate how much to slide based on original position
          const charactersToRemove = trick.zones['strikethrough-zone'].end - trick.zones['strikethrough-zone'].start;
          const slideOffset = -charactersToRemove * 8; // Approximate character width

          return (
            <motion.span
              key={char.id}
              initial={{ x: 0 }}
              animate={{ x: slideOffset }}
              transition={{ duration: 0.5, ease: "easeInOut" }}
              className={`${baseClasses} text-white`}
              style={{ position: 'relative' }}
            >
              {char.char}
            </motion.span>
          );
        }
        return (
          <span
            key={char.id}
            className={`${baseClasses} text-white`}
          >
            {char.char}
          </span>
        );

      case 'final':
        return (
          <span
            key={char.id}
            className={`${baseClasses} text-white`}
            style={{ position: 'relative' }}
          >
            {char.char}
          </span>
        );

      default:
        return <span key={char.id}>{char.char}</span>;
    }
  };

  return (
    <div className="font-mono text-lg leading-relaxed">
      {characters.map((char) => renderCharacter(char))}
      {isTyping && <span className="animate-pulse text-white/60">|</span>}
    </div>
  );
};

const TricksComponent: React.FC = () => {
  const [selectedTrick, setSelectedTrick] = useState<Trick | null>(tricks[0]);
  const [isAutoRotating, setIsAutoRotating] = useState(true);

  // Auto-rotation through tricks
  useEffect(() => {
    if (!isAutoRotating) return;

    const interval = setInterval(() => {
      const nextIndex = (Math.floor(Date.now() / 8000) % tricks.length);
      setSelectedTrick(tricks[nextIndex]);
    }, 8000); // Rotate every 8 seconds (increased for full animation cycle)

    return () => clearInterval(interval);
  }, [isAutoRotating]);

  const handleTrickClick = (trick: Trick) => {
    setSelectedTrick(trick);
    setIsAutoRotating(false); // Stop auto-rotation when user interacts
  };

  const containerVariants = {
    hidden: { opacity: 0, y: 20 },
    visible: {
      opacity: 1,
      y: 0,
      transition: {
        duration: 0.5,
        ease: [0.25, 0.8, 0.25, 1] as const,
        staggerChildren: 0.1,
      },
    },
  };

  const tagVariants = {
    hidden: { opacity: 0, scale: 0.9 },
    visible: {
      opacity: 1,
      scale: 1,
      transition: {
        duration: 0.3,
        ease: [0.25, 0.8, 0.25, 1] as const,
      },
    },
  };

  return (
    <motion.div
      variants={containerVariants}
      initial="hidden"
      animate="visible"
      className="text-center max-w-6xl mx-auto"
    >
      {/* Header */}
      <div className="heading-stack">
        <h2 className="text-heading-lg heading-gradient heading-crisp text-breathe">
          Voice Tricks & Shortcuts
        </h2>
        <p className="text-sm text-subtle leading-relaxed subheading">
          Click any trick to see it in action. These commands make dictation incredibly powerful.
        </p>
      </div>

      {/* Compact Tag Cloud */}
      <div className="flex flex-wrap justify-center gap-2 mb-8 max-w-5xl mx-auto">
        {tricks.map((trick) => (
          <motion.button
            key={trick.id}
            variants={tagVariants}
            className={`meta-directive-tag px-3 py-1.5 ${
              selectedTrick?.id === trick.id
                ? "meta-directive-tag-active"
                : "meta-directive-tag-inactive"
            }`}
            onClick={() => handleTrickClick(trick)}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.98 }}
            layoutId={`tag-${trick.id}`}
          >
            <span className="font-medium text-xs leading-tight">{trick.title}</span>
          </motion.button>
        ))}
      </div>

      {/* Single Streaming Card */}
      <AnimatePresence mode="wait">
        {selectedTrick && (
          <motion.div
            key={selectedTrick.id}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            transition={{ duration: 0.3, ease: [0.25, 0.8, 0.25, 1] as const }}
            layoutId={`detail-${selectedTrick.id}`}
            className="max-w-5xl mx-auto"
          >
            {/* Streaming Text Card */}
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.2 }}
              className="w-full"
            >
              <div className="card-floating rounded-2xl p-8 border border-white/10 bg-black/20 backdrop-blur-xl w-full h-32 flex items-center justify-center">
                <div className="text-left w-full overflow-hidden">
                  <StreamingText trick={selectedTrick} />
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

          </motion.div>
  );
};

export default TricksComponent;