import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import SfIcon from "../icons/SfIcon";

interface MetaDirective {
  id: string;
  title: string;
  description: string;
  example: string;
}

const metaDirectives: MetaDirective[] = [
  {
    id: "spell",
    title: "Spell That",
    description: "Make Sonic Flow spell out the last word",
    example: "Can you spell that",
  },
  {
    id: "quotes",
    title: "Put in Quotes",
    description: "Wrap text in quotation marks",
    example: "Put hello world in quotes",
  },
  {
    id: "scratch",
    title: "Scratch That",
    description: "Delete the last thing you said",
    example: "Scratch that",
  },
  {
    id: "emphasis",
    title: "Add Emphasis",
    description: "Make text bold or add emphasis",
    example: "Add emphasis on important",
  },
  {
    id: "caps",
    title: "Write in Caps",
    description: "Convert text to uppercase",
    example: "Write hello in caps",
  },
  {
    id: "replace",
    title: "Replace Words",
    description: "Replace one word with another",
    example: "Replace hello with hi",
  },
  {
    id: "lowercase",
    title: "Make Lowercase",
    description: "Convert text to lowercase",
    example: "Make HELLO lowercase",
  },
  {
    id: "italics",
    title: "Add Italics",
    description: "Make text italic",
    example: "Add italics to this phrase",
  },
  {
    id: "comma",
    title: "Add Comma",
    description: "Insert a comma at the current position",
    example: "Add comma",
  },
  {
    id: "period",
    title: "Add Period",
    description: "Insert a period at the current position",
    example: "Add period",
  },
  {
    id: "newline",
    title: "New Line",
    description: "Move to the next line",
    example: "New line",
  },
  {
    id: "undo",
    title: "Undo Last",
    description: "Undo the last action",
    example: "Undo last",
  },
  {
    id: "redo",
    title: "Redo Last",
    description: "Redo the last undone action",
    example: "Redo last",
  },
  {
    id: "select-all",
    title: "Select All",
    description: "Select all text in the current field",
    example: "Select all",
  },
  {
    id: "delete",
    title: "Delete That",
    description: "Delete the selected text",
    example: "Delete that",
  },
  {
    id: "copy",
    title: "Copy That",
    description: "Copy the selected text to clipboard",
    example: "Copy that",
  },
  {
    id: "paste",
    title: "Paste That",
    description: "Paste from clipboard",
    example: "Paste that",
  },
];

const MetaDirectivesComponent: React.FC = () => {
  const [selectedDirective, setSelectedDirective] = useState<MetaDirective | null>(
    metaDirectives[0]
  );
  const [isAutoRotating, setIsAutoRotating] = useState(true);
  const [rotationIndex, setRotationIndex] = useState(0);

  // Auto-rotation through directives
  useEffect(() => {
    if (!isAutoRotating) return;

    const interval = setInterval(() => {
      setRotationIndex((prev) => {
        const nextIndex = (prev + 1) % metaDirectives.length;
        setSelectedDirective(metaDirectives[nextIndex]);
        return nextIndex;
      });
    }, 3000); // Rotate every 3 seconds

    return () => clearInterval(interval);
  }, [isAutoRotating]);

  const handleDirectiveClick = (directive: MetaDirective) => {
    setSelectedDirective(directive);
    setIsAutoRotating(false); // Stop auto-rotation when user interacts
    setRotationIndex(metaDirectives.findIndex(d => d.id === directive.id));
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
      className="text-center max-w-4xl mx-auto"
    >
      {/* Header */}
      <div className="heading-stack mb-8">
        <h2 className="text-heading-lg heading-gradient heading-crisp text-breathe">
          Discover Sonic Flow's Superpowers
        </h2>
        <p className="text-sm text-subtle leading-relaxed subheading">
          Click any command to learn more. These meta-directives make dictation incredibly powerful.
        </p>
      </div>

      {/* Tag Cloud - Marquee Style */}
      <div className="flex flex-wrap justify-center gap-1.5 mb-8 max-w-6xl mx-auto">
        {metaDirectives.map((directive, index) => (
          <motion.button
            key={directive.id}
            variants={tagVariants}
            className={`meta-directive-tag ${
              selectedDirective?.id === directive.id
                ? "meta-directive-tag-active"
                : "meta-directive-tag-inactive"
            }`}
            onClick={() => handleDirectiveClick(directive)}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.98 }}
            layoutId={`tag-${directive.id}`}
          >
            <span className="font-medium text-xs">{directive.title}</span>
          </motion.button>
        ))}
      </div>

      {/* Detail Panel */}
      <AnimatePresence mode="wait">
        {selectedDirective && (
          <motion.div
            key={selectedDirective.id}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            transition={{ duration: 0.3, ease: [0.25, 0.8, 0.25, 1] as const }}
            layoutId={`detail-${selectedDirective.id}`}
            className="onboarding-permission-row rounded-lg p-3 transition-opacity duration-300 max-w-2xl mx-auto"
          >
            <div className="flex items-center justify-between w-full">
              <div className="flex items-center space-x-3 min-w-0 flex-1">
                <div className="w-8 h-8 rounded-md card-floating flex items-center justify-center flex-shrink-0">
                  <SfIcon name="mic.fill" size={16} className="text-primary/70" />
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="text-[13px] font-medium text-foreground">
                    {selectedDirective.title}
                  </h3>
                  <p className="text-[11px] text-subtle">
                    {selectedDirective.description}
                  </p>
                </div>
              </div>
            </div>
            {/* Example Section */}
            <div className="mt-3 bg-white/5 rounded p-3 border border-white/10">
              <div className="flex items-center gap-2 mb-1">
                <SfIcon name="mic.fill" size={12} className="text-white/60" />
                <span className="text-[10px] font-medium text-white/60 uppercase tracking-wide">
                  Example
                </span>
              </div>
              <p className="text-[11px] text-white/90 font-mono bg-black/20 rounded px-2 py-1 border-l-2 border-primary">
                "{selectedDirective.example}"
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Auto-rotation Toggle */}
      <div className="mt-6 flex justify-center">
        {!isAutoRotating && (
          <motion.button
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            onClick={handleResumeRotation}
            className="flex items-center gap-2 text-xs text-white/60 hover:text-white/80 transition-colors"
          >
            <SfIcon name="play.circle.fill" size={16} />
            Auto-play examples
          </motion.button>
        )}
      </div>
    </motion.div>
  );
};

export default MetaDirectivesComponent;