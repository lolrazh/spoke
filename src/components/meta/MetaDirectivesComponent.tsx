import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";

interface CharacterState {
  char: string;
  status: 'typing' | 'stable' | 'strikethrough' | 'fading' | 'sliding' | 'final';
  id: string; // Unique identifier for each character
  originalIndex?: number; // Original position for sliding animations
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
  stages: AnimationStage[];
}

const tricks: Trick[] = [
  {
    id: "correction",
    title: "Quick Correction",
    description: "Fix mistakes by saying what you actually meant",
    inputText: "I need it by 12pm Friday. Actually, scratch that. 11am Thursday.",
    stages: [
      { type: 'typing', duration: 2000, targetText: "I need it by 12pm Friday. Actually, scratch that. 11am Thursday." },
      { type: 'pause', duration: 500 },
      { type: 'strikethrough', duration: 800, startIndex: 14, endIndex: 46 }, // "12pm Friday. Actually, scratch that."
      { type: 'pause', duration: 300 },
      { type: 'fade-out', duration: 600, startIndex: 14, endIndex: 46 },
      { type: 'pause', duration: 300 },
      { type: 'slide-together', duration: 500, startIndex: 0, endIndex: 13, joinIndex: 47 }, // Join "I need it by " with "11am Thursday."
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
            strikethroughEffect(stage.startIndex, stage.endIndex, () => {
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
        originalIndex: currentCharIndex
      };

      setCharacters(prev => {
        const updated = [...prev, newChar];
        // Mark previous characters as stable
        return updated.map((char, index) =>
          index < updated.length - 1 ? { ...char, status: 'stable' as const } : char
        );
      });

      currentCharIndex++;
    }, intervalMs);
  };

  const strikethroughEffect = (startIndex: number, endIndex: number, onComplete: () => void) => {
    setCharacters(prev =>
      prev.map((char, index) =>
        index >= startIndex && index < endIndex
          ? { ...char, status: 'strikethrough' as const }
          : char
      )
    );

    setTimeout(onComplete, 100);
  };

  const fadeOutEffect = (startIndex: number, endIndex: number, onComplete: () => void) => {
    setCharacters(prev =>
      prev.map((char, index) =>
        index >= startIndex && index < endIndex
          ? { ...char, status: 'fading' as const }
          : char
      )
    );

    // Remove faded characters after animation
    setTimeout(() => {
      setCharacters(prev =>
        prev.filter((char, index) => !(index >= startIndex && index < endIndex))
          .map(char => ({ ...char, status: 'final' as const }))
      );
      onComplete();
    }, 600);
  };

  const slideTogetherEffect = (startIndex: number, endIndex: number, joinIndex: number, onComplete: () => void) => {
    // Mark characters that will slide
    setCharacters(prev =>
      prev.map((char, index) => {
        if (index >= startIndex && index < endIndex) {
          return { ...char, status: 'sliding' as const };
        }
        if (index >= joinIndex) {
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

  const renderCharacter = (char: CharacterState, index: number) => {
    const baseClasses = "transition-all duration-300 inline-block";

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

      case 'strikethrough':
        return (
          <span
            key={char.id}
            className={`${baseClasses} text-white/40 line-through decoration-2`}
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
          >
            {char.char}
          </motion.span>
        );

      case 'sliding': {
        const slideOffset = index >= 13 ? -100 : 0; // Slide right part left
        return (
          <motion.span
            key={char.id}
            initial={{ x: 0 }}
            animate={{ x: slideOffset }}
            transition={{ duration: 0.5, ease: "easeInOut" }}
            className={`${baseClasses} text-white`}
          >
            {char.char}
          </motion.span>
        );
      }

      case 'final':
        return (
          <span
            key={char.id}
            className={`${baseClasses} text-white`}
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
      {characters.map((char, index) => renderCharacter(char, index))}
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
              <div className="card-floating rounded-xl p-6 border border-white/10 bg-black/20 backdrop-blur-xl">
                <div className="text-left">
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