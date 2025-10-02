import React, { useState, useEffect } from "react";

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
    <div className="font-mono text-lg leading-relaxed text-white">
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

  return (
    <div className="text-center max-w-6xl mx-auto">
      {/* Header */}
      <div className="heading-stack mb-8">
        <h2 className="text-heading-lg heading-gradient heading-crisp text-breathe">
          Voice Tricks & Shortcuts
        </h2>
        <p className="text-sm text-subtle leading-relaxed subheading">
          Click any trick to see it in action. These commands make dictation incredibly powerful.
        </p>
      </div>

      {/* Single Streaming Card */}
      {selectedTrick && (
        <div className="max-w-5xl mx-auto">
          <div className="card-floating rounded-2xl p-8 border border-white/10 bg-black/20 backdrop-blur-xl max-w-4xl mx-auto h-32 flex items-center justify-center">
            <div className="text-left w-full overflow-hidden">
              <SimpleTypewriter text={selectedTrick.text} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default TricksComponent;