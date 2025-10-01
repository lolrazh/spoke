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
    id: "scratch",
    title: "Scratch That",
    description: "Delete the last thing you said",
    inputExample: "Scratch that",
    outputExample: "[previous text removed]",
  },
  {
    id: "emphasis",
    title: "Add Emphasis",
    description: "Make text bold or add emphasis",
    inputExample: "Add emphasis on important",
    outputExample: "**important**",
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
    id: "lowercase",
    title: "Make Lowercase",
    description: "Convert text to lowercase",
    inputExample: "Make HELLO lowercase",
    outputExample: "hello",
  },
  {
    id: "italics",
    title: "Add Italics",
    description: "Make text italic",
    inputExample: "Add italics to this phrase",
    outputExample: "*this phrase*",
  },
  {
    id: "comma",
    title: "Add Comma",
    description: "Insert a comma at the current position",
    inputExample: "Add comma",
    outputExample: ",",
  },
  {
    id: "period",
    title: "Add Period",
    description: "Insert a period at the current position",
    inputExample: "Add period",
    outputExample: ".",
  },
  {
    id: "newline",
    title: "New Line",
    description: "Move to the next line",
    inputExample: "New line",
    outputExample: "\n",
  },
  {
    id: "undo",
    title: "Undo Last",
    description: "Undo the last action",
    inputExample: "Undo last",
    outputExample: "[action undone]",
  },
  {
    id: "redo",
    title: "Redo Last",
    description: "Redo the last undone action",
    inputExample: "Redo last",
    outputExample: "[action redone]",
  },
  {
    id: "select-all",
    title: "Select All",
    description: "Select all text in the current field",
    inputExample: "Select all",
    outputExample: "[all text selected]",
  },
  {
    id: "delete",
    title: "Delete That",
    description: "Delete the selected text",
    inputExample: "Delete that",
    outputExample: "[text deleted]",
  },
  {
    id: "copy",
    title: "Copy That",
    description: "Copy the selected text to clipboard",
    inputExample: "Copy that",
    outputExample: "[text copied]",
  },
  {
    id: "paste",
    title: "Paste That",
    description: "Paste from clipboard",
    inputExample: "Paste that",
    outputExample: "[clipboard content pasted]",
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
      <div className="heading-stack mb-8">
        <h2 className="text-heading-lg heading-gradient heading-crisp text-breathe">
          Voice Tricks & Shortcuts
        </h2>
        <p className="text-sm text-subtle leading-relaxed subheading">
          Click any trick to see it in action. These commands make dictation incredibly powerful.
        </p>
      </div>

      {/* Compact Tag Cloud */}
      <div className="flex flex-wrap justify-center gap-2 mb-10 max-w-5xl mx-auto">
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
            {/* Title and Description */}
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
              className="mb-6"
            >
              <h3 className="text-[16px] font-semibold text-foreground mb-2">
                {selectedTrick.title}
              </h3>
              <p className="text-[13px] text-subtle">
                {selectedTrick.description}
              </p>
            </motion.div>

            {/* Input/Output Cards with Arrow */}
            <div className="flex items-center justify-center gap-4 mb-6">
              {/* Input Card */}
              <motion.div
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.2 }}
                className="flex-1 max-w-md"
              >
                <div className="card-floating rounded-lg p-4 border border-white/10">
                  <div className="flex items-center gap-2 mb-2">
                    <SfIcon name="mic.fill" size={14} className="text-primary/70" />
                    <span className="text-[11px] font-medium text-white/60 uppercase tracking-wide">
                      You Say
                    </span>
                  </div>
                  <p className="text-[13px] text-white/90 font-mono bg-black/20 rounded px-3 py-2 border-l-2 border-primary/50 leading-relaxed">
                    {selectedTrick.inputExample}
                  </p>
                </div>
              </motion.div>

              {/* Arrow */}
              <motion.div
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: 0.3 }}
                className="flex-shrink-0"
              >
                <div className="w-8 h-8 rounded-full card-floating flex items-center justify-center">
                  <SfIcon name="arrow.right" size={14} className="text-primary/70" />
                </div>
              </motion.div>

              {/* Output Card */}
              <motion.div
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.4 }}
                className="flex-1 max-w-md"
              >
                <div className="card-floating rounded-lg p-4 border border-white/10">
                  <div className="flex items-center gap-2 mb-2">
                    <SfIcon name="checkmark.circle.fill" size={14} className="text-green-500/70" />
                    <span className="text-[11px] font-medium text-white/60 uppercase tracking-wide">
                      Result
                    </span>
                  </div>
                  <p className="text-[13px] text-white/90 font-mono bg-black/20 rounded px-3 py-2 border-l-2 border-green-500/50 leading-relaxed">
                    {selectedTrick.outputExample}
                  </p>
                </div>
              </motion.div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Auto-rotation Toggle */}
      <div className="mt-8 flex justify-center">
        {!isAutoRotating && (
          <motion.button
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            onClick={handleResumeRotation}
            className="flex items-center gap-2 text-xs text-white/60 hover:text-white/80 transition-colors px-3 py-1.5 rounded-full card-floating border border-white/10"
          >
            <SfIcon name="play.circle.fill" size={16} />
            Auto-play examples
          </motion.button>
        )}
      </div>
    </motion.div>
  );
};

export default TricksComponent;