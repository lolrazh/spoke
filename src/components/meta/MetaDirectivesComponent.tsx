import React, { useState, useEffect } from "react";
import { motion } from "framer-motion";

interface TextSegment {
  text: string;
  type: 'normal' | 'strikethrough';
}

interface Trick {
  id: string;
  title: string;
  description: string;
  segments: TextSegment[];
}

const tricks: Trick[] = [
  {
    id: "correction",
    title: "Quick Correction",
    description: "Fix mistakes by saying what you actually meant",
    segments: [
      { text: "I need it by ", type: "normal" },
      { text: "12pm Friday. Actually, scratch that.", type: "strikethrough" },
      { text: " 11am Thursday.", type: "normal" }
    ]
  },
  // Other tricks will be added later once we perfect the first one
];

const SegmentTypewriter: React.FC<{ segments: TextSegment[] }> = ({ segments }) => {
  const [currentSegmentIndex, setCurrentSegmentIndex] = useState(0);
  const [currentCharIndex, setCurrentCharIndex] = useState(0);
  const [displayedSegments, setDisplayedSegments] = useState<{ segment: TextSegment; text: string; shouldStrike: boolean; isDisappearing: boolean }[]>([]);
  const [isTyping, setIsTyping] = useState(true);

  // Reset when segments change
  useEffect(() => {
    setCurrentSegmentIndex(0);
    setCurrentCharIndex(0);
    setDisplayedSegments([]);
    setIsTyping(true);
  }, [segments]);

  useEffect(() => {
    if (currentSegmentIndex >= segments.length) {
      setIsTyping(false);
      return;
    }

    const currentSegment = segments[currentSegmentIndex];
    const segmentText = currentSegment.text;

    if (currentCharIndex < segmentText.length) {
      const timeout = setTimeout(() => {
        // Add current character
        const newChar = segmentText[currentCharIndex];

        setDisplayedSegments(prev => {
          const updated = [...prev];
          if (updated.length <= currentSegmentIndex) {
            updated.push({ segment: currentSegment, text: newChar, shouldStrike: false, isDisappearing: false });
          } else {
            updated[currentSegmentIndex].text += newChar;
          }
          return updated;
        });

        setCurrentCharIndex(prev => prev + 1);
      }, 25); // 25ms per character for faster typing

      return () => clearTimeout(timeout);
    } else {
      // Segment complete, move to next segment
      setCurrentSegmentIndex(prev => prev + 1);
      setCurrentCharIndex(0);
    }
  }, [currentSegmentIndex, currentCharIndex, segments]);

  // Trigger strikethrough animation and disappearance after ALL text is finished typing
  useEffect(() => {
    if (!isTyping && displayedSegments.length === segments.length) {
      // Find all strikethrough segments and trigger animation with a slight delay
      displayedSegments.forEach((displayed, index) => {
        if (displayed.segment.type === 'strikethrough' && !displayed.shouldStrike) {
          setTimeout(() => {
            setDisplayedSegments(prev => {
              const updated = [...prev];
              updated[index].shouldStrike = true;
              return updated;
            });
          }, 500); // Delay after all text is complete

          // Trigger disappearance after strikethrough completes with extra gap
          setTimeout(() => {
            setDisplayedSegments(prev => {
              const updated = [...prev];
              updated[index].isDisappearing = true;
              return updated;
            });
          }, 1000); // 500ms delay + 250ms strikethrough + 250ms gap
        }
      });
    }
  }, [isTyping, displayedSegments, segments]);

  return (
    <div className="text-sm leading-relaxed text-white font-sans">
      {displayedSegments.map((displayed, index) => (
        <span key={index}>
          {displayed.segment.type === 'strikethrough' ? (
            <span
              className={`${displayed.shouldStrike ? 'strikethrough-animate' : ''} ${displayed.isDisappearing ? 'disappear-reverse' : ''}`}
              style={displayed.isDisappearing ? { animationDelay: '0ms' } : {}}
            >
              {displayed.text}
            </span>
          ) : (
            <span>{displayed.text}</span>
          )}
        </span>
      ))}
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
      className="text-center w-full max-w-6xl mx-auto px-6"
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
        <div className="w-full flex justify-center px-8">
          <div className="card-floating rounded-lg p-4 inline-block">
            <div className="text-left overflow-x-auto whitespace-nowrap">
              <SegmentTypewriter segments={selectedTrick.segments} />
            </div>
          </div>
        </div>
      )}
    </motion.div>
  );
};

export default TricksComponent;
