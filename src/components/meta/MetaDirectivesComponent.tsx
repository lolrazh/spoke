import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import SfIcon from "../icons/SfIcon";

interface Trick {
  id: string;
  title: string;
  description: string;
  inputExample: string;
  outputExample: string;
}

const tricks: Trick[] = [
  {
    id: "correction",
    title: "Quick Correction",
    description: "Fix mistakes by saying what you actually meant",
    inputExample: "lets meet 12pm thursday, actually wait no, 11am friday",
    outputExample: "lets meet 11am friday",
  },
  {
    id: "scratch",
    title: "Scratch That",
    description: "Delete the last thing you said",
    inputExample: "Scratch that",
    outputExample: "[previous text removed]",
  },
  {
    id: "spell",
    title: "Spell That",
    description: "Make Sonic Flow spell out the last word",
    inputExample: "Can you spell that",
    outputExample: "h-e-l-l-o",
  },
  {
    id: "quotes",
    title: "Put in Quotes",
    description: "Wrap text in quotation marks",
    inputExample: "Put hello world in quotes",
    outputExample: '"hello world"',
  },
  {
    id: "caps",
    title: "Write in Caps",
    description: "Convert text to uppercase",
    inputExample: "Write hello in caps",
    outputExample: "HELLO",
  },
  {
    id: "replace",
    title: "Replace Words",
    description: "Replace one word with another",
    inputExample: "Replace hello with hi",
    outputExample: "hi",
  },
  {
    id: "emphasis",
    title: "Add Emphasis",
    description: "Make text bold or add emphasis",
    inputExample: "Add emphasis on important",
    outputExample: "**important**",
  },
];

const TricksComponent: React.FC = () => {
  const [selectedTrick, setSelectedTrick] = useState<Trick | null>(tricks[0]);
  const [isAutoRotating, setIsAutoRotating] = useState(true);
  const [rotationIndex, setRotationIndex] = useState(0);

  // Auto-rotation through tricks
  useEffect(() => {
    if (!isAutoRotating) return;

    const interval = setInterval(() => {
      setRotationIndex((prev) => {
        const nextIndex = (prev + 1) % tricks.length;
        setSelectedTrick(tricks[nextIndex]);
        return nextIndex;
      });
    }, 4000); // Rotate every 4 seconds

    return () => clearInterval(interval);
  }, [isAutoRotating]);

  const handleTrickClick = (trick: Trick) => {
    setSelectedTrick(trick);
    setIsAutoRotating(false); // Stop auto-rotation when user interacts
    setRotationIndex(tricks.findIndex(t => t.id === trick.id));
  };

  const handleResumeRotation = () => {
    setIsAutoRotating(true);
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
        {tricks.map((trick, index) => (
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

      {/* Input/Output Example Cards */}
      <AnimatePresence mode="wait">
        {selectedTrick && (
          <motion.div
            key={selectedTrick.id}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            transition={{ duration: 0.3, ease: [0.25, 0.8, 0.25, 1] as const }}
            layoutId={`detail-${selectedTrick.id}`}
            className="max-w-4xl mx-auto"
          >
            {/* Simple Input/Output with Arrow */}
            <div className="flex items-center justify-center gap-3 mb-6">
              {/* Input Card */}
              <motion.div
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.2 }}
                className="flex-1 max-w-md"
              >
                <div className="card-floating rounded-lg p-3 border border-white/10">
                  <p className="text-sm text-foreground leading-relaxed">
                    {selectedTrick.inputExample}
                  </p>
                </div>
              </motion.div>

              {/* Simple Arrow */}
              <motion.div
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: 0.3 }}
                className="flex-shrink-0 text-primary/70 text-2xl"
              >
                →
              </motion.div>

              {/* Output Card */}
              <motion.div
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.4 }}
                className="flex-1 max-w-md"
              >
                <div className="card-floating rounded-lg p-3 border border-white/10">
                  <p className="text-sm text-foreground leading-relaxed">
                    {selectedTrick.outputExample}
                  </p>
                </div>
              </motion.div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

          </motion.div>
  );
};

export default TricksComponent;