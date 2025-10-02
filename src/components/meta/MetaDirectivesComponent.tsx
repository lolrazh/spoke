import React, { useState, useEffect } from "react";
import { motion } from "framer-motion";

interface Trick {
  id: string;
  title: string;
  description: string;
  text: string;
}

const tricks: Trick[] = [
  {
    id: "correction",
    title: "Quick Correction",
    description: "Fix mistakes by saying what you actually meant",
    text: "I need it by 12pm Friday. Actually, scratch that. 11am Thursday."
  },
  // Other tricks will be added later once we perfect the first one
];

const SimpleTypewriter: React.FC<{ text: string }> = ({ text }) => {
  const [displayedText, setDisplayedText] = useState('');
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isTyping, setIsTyping] = useState(true);

  useEffect(() => {
    setDisplayedText('');
    setCurrentIndex(0);
    setIsTyping(true);
  }, [text]);

  useEffect(() => {
    if (currentIndex < text.length) {
      const timeout = setTimeout(() => {
        setDisplayedText(prev => prev + text[currentIndex]);
        setCurrentIndex(prev => prev + 1);
      }, 50); // 50ms per character for smooth typing

      return () => clearTimeout(timeout);
    } else {
      setIsTyping(false);
    }
  }, [currentIndex, text]);

  return (
    <div className="text-lg leading-relaxed text-white font-sans">
      {displayedText}
      {isTyping && <span className="animate-pulse text-white/60">|</span>}
    </div>
  );
};

const TricksComponent: React.FC = () => {
  const [selectedTrick, setSelectedTrick] = useState<Trick | null>(tricks[0]);

  const handleTrickClick = (trick: Trick) => {
    setSelectedTrick(trick);
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
      variants={tagVariants}
      initial="hidden"
      animate="visible"
      className="text-center w-full"
    >
      {/* Header */}
      <div className="heading-stack">
        <h2 className="text-heading-lg heading-gradient heading-crisp text-breathe">
          Some More Tricks You Can Try
        </h2>
        <p className="text-sm text-subtle leading-relaxed subheading">
          These commands make dictating with Sonic Flow incredibly powerful.
        </p>
      </div>

      {/* Compact Tag Cloud */}
      <div className="flex flex-wrap justify-center gap-2 mb-8">
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
      {selectedTrick && (
        <div className="w-full">
          <div className="card-floating rounded-2xl p-3 border border-white/10 bg-black/20 backdrop-blur-xl w-full h-24 flex items-center justify-center">
            <div className="text-left w-full overflow-hidden whitespace-nowrap px-4">
              <SimpleTypewriter text={selectedTrick.text} />
            </div>
          </div>
        </div>
      )}
    </motion.div>
  );
};

export default TricksComponent;