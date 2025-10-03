import React, { useState, useEffect } from "react";
import { motion } from "framer-motion";

interface TextSegment {
  text: string;
  type: 'normal' | 'strikethrough' | 'insertion';
  replacementText?: string; // For character-level replacements (e.g., 'a' -> 'e')
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
      { text: "mma model?", type: "normal" },
      { text: " Spell that G-E-M-M-A.", type: "strikethrough" },
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
      { text: "good.", type: "normal" }
    ]
  }
  // Other tricks will be added later
];

// Helper function to split text for smart strikethrough (ignores leading/trailing spaces)
const splitTextForStrikethrough = (text: string) => {
  const leadingSpaces = text.match(/^(\s*)/)?.[1] || '';
  const trailingSpaces = text.match(/(\s*)$/)?.[1] || '';
  const middleContent = text.slice(leadingSpaces.length, text.length - trailingSpaces.length);

  return { leadingSpaces, middleContent, trailingSpaces };
};

const SegmentTypewriter: React.FC<{ segments: TextSegment[]; onSuccessGlow?: (show: boolean) => void }> = ({ segments, onSuccessGlow }) => {
  const [currentSegmentIndex, setCurrentSegmentIndex] = useState(0);
  const [currentCharIndex, setCurrentCharIndex] = useState(0);
  const [displayedSegments, setDisplayedSegments] = useState<{ 
    segment: TextSegment; 
    text: string; 
    shouldStrike: boolean; 
    isDisappearing: boolean; 
    isReplacing: boolean;
    isInserting: boolean;
    measuredWidth?: number; 
    replacementWidth?: number;
  }[]>([]);
  const [isTyping, setIsTyping] = useState(true);
  const segmentRefs = React.useRef<(HTMLSpanElement | null)[]>([]);

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
      // Segment complete, move to next segment
      setCurrentSegmentIndex(prev => prev + 1);
      setCurrentCharIndex(0);
    }
  }, [currentSegmentIndex, currentCharIndex, segments]);

  // Trigger strikethrough animation and disappearance after ALL text is finished typing
  useEffect(() => {
    if (!isTyping && displayedSegments.length === segments.length) {
      // Find all strikethrough segments
      const strikethroughIndices = displayedSegments
        .map((displayed, index) => displayed.segment.type === 'strikethrough' && !displayed.shouldStrike ? index : -1)
        .filter(index => index !== -1);
      
      // Find all insertion segments
      const insertionIndices = displayedSegments
        .map((displayed, index) => displayed.segment.type === 'insertion' && !displayed.isInserting ? index : -1)
        .filter(index => index !== -1);

      if (strikethroughIndices.length === 0 && insertionIndices.length === 0) return;

      // Strike all strikethrough segments simultaneously
      setTimeout(() => {
        setDisplayedSegments(prev => {
          const updated = [...prev];
          strikethroughIndices.forEach(index => {
            updated[index].shouldStrike = true;
          });
          return updated;
        });
      }, 500); // Delay after all text is complete

      // Measure widths and trigger disappearance/replacement
      setTimeout(() => {
        strikethroughIndices.forEach(index => {
          const element = segmentRefs.current[index];
          if (!element) return;

          const segment = displayedSegments[index].segment;
          const isReplacement = !!segment.replacementText;

          if (isReplacement) {
            // For replacement: measure both old and new widths
            const oldWidth = element.offsetWidth;
            
            // Temporarily measure replacement text width
            const tempSpan = document.createElement('span');
            tempSpan.style.cssText = window.getComputedStyle(element).cssText;
            tempSpan.style.visibility = 'hidden';
            tempSpan.style.position = 'absolute';
            tempSpan.textContent = segment.replacementText || '';
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

            // Trigger replacement animation
            requestAnimationFrame(() => {
              requestAnimationFrame(() => {
                setDisplayedSegments(prev => {
                  const updated = [...prev];
                  updated[index].isReplacing = true;
                  return updated;
                });
              });
            });
          } else {
            // For regular removal: measure and collapse
            const width = element.offsetWidth;
            
            setDisplayedSegments(prev => {
              const updated = [...prev];
              updated[index].measuredWidth = width;
              return updated;
            });

            // Trigger collapse animation
            requestAnimationFrame(() => {
              requestAnimationFrame(() => {
                setDisplayedSegments(prev => {
                  const updated = [...prev];
                  updated[index].isDisappearing = true;
                  return updated;
                });
              });
            });
          }
        });

        // Handle insertions - measure and trigger insertion animation
        insertionIndices.forEach(index => {
          const element = segmentRefs.current[index];
          if (!element) return;

          const segment = displayedSegments[index].segment;
          
          // Temporarily measure insertion text width
          const tempSpan = document.createElement('span');
          tempSpan.style.cssText = window.getComputedStyle(element).cssText;
          tempSpan.style.visibility = 'hidden';
          tempSpan.style.position = 'absolute';
          tempSpan.textContent = segment.text;
          document.body.appendChild(tempSpan);
          const insertionWidth = tempSpan.offsetWidth;
          document.body.removeChild(tempSpan);

          // Set measured width (start from 0, will expand to this)
          setDisplayedSegments(prev => {
            const updated = [...prev];
            updated[index].measuredWidth = insertionWidth;
            return updated;
          });

          // Trigger insertion animation
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              setDisplayedSegments(prev => {
                const updated = [...prev];
                updated[index].isInserting = true;
                return updated;
              });
            });
          });
        });
      }, 1050); // 500ms delay + 250ms strikethrough + 300ms tiny pause
      
      // Trigger success glow after all animations complete
      setTimeout(() => {
        onSuccessGlow?.(true);
        setTimeout(() => {
          onSuccessGlow?.(false);
        }, 1000); // Full glow cycle
      }, 2050); // 1050ms before animations start + 1000ms animation duration
    }
  }, [isTyping, displayedSegments, segments, onSuccessGlow]);

  return (
    <div className="text-sm leading-relaxed text-white font-sans">
      <span className="inline-flex items-baseline">
        {displayedSegments.map((displayed, index) => (
          <span
            key={index}
            ref={el => segmentRefs.current[index] = el}
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
            {displayed.segment.type === 'strikethrough' ? (
              displayed.segment.replacementText && displayed.isReplacing ? (
                // Replacement: show both old and new text with crossfade
                <span className="relative inline-block" style={{ whiteSpace: 'pre' }}>
                  <span className="replacement-fade-out">
                    {displayed.text}
                  </span>
                  <span className="replacement-fade-in absolute top-0 left-0">
                    {displayed.segment.replacementText}
                  </span>
                </span>
              ) : (
                // Regular strikethrough or pre-replacement state - Smart split rendering
                (() => {
                  const { leadingSpaces, middleContent, trailingSpaces } = splitTextForStrikethrough(displayed.text);
                  return (
                    <span className="inline-block" style={{ whiteSpace: 'pre' }}>
                      {leadingSpaces && (
                        <span className={`inline-block ${displayed.isDisappearing ? 'disappear-reverse' : ''}`}>
                          {leadingSpaces}
                        </span>
                      )}
                      {middleContent && (
                        <span
                          className={`inline-block ${displayed.shouldStrike ? 'strikethrough-animate' : ''} ${displayed.isDisappearing ? 'disappear-reverse' : ''}`}
                        >
                          {middleContent}
                        </span>
                      )}
                      {trailingSpaces && (
                        <span className={`inline-block ${displayed.isDisappearing ? 'disappear-reverse' : ''}`}>
                          {trailingSpaces}
                        </span>
                      )}
                    </span>
                  );
                })()
              )
            ) : displayed.segment.type === 'insertion' ? (
              // Insertion: fade in from invisible
              <span className={`inline-block ${displayed.isInserting ? 'insertion-fade-in' : ''}`} style={{ whiteSpace: 'pre', opacity: displayed.isInserting ? undefined : 0 }}>
                {displayed.text}
              </span>
            ) : (
              <span className="inline-block" style={{ whiteSpace: 'pre' }}>{displayed.text}</span>
            )}
          </span>
        ))}
      </span>
      {isTyping && <span className="animate-pulse text-white/60">|</span>}
    </div>
  );
};

const TricksComponent: React.FC = () => {
  const [selectedTrick, setSelectedTrick] = useState<Trick | null>(tricks[0]);
  const [showCardGlow, setShowCardGlow] = useState(false);

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
          These commands make Sonic Flow feel like magic.
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
          <div className={`card-floating rounded-lg p-4 inline-block transition-all ${showCardGlow ? 'success-container-glow' : ''}`}>
            <div className="text-left overflow-x-auto whitespace-nowrap">
              <SegmentTypewriter segments={selectedTrick.segments} onSuccessGlow={setShowCardGlow} />
            </div>
          </div>
        </div>
      )}
    </motion.div>
  );
};

export default TricksComponent;
