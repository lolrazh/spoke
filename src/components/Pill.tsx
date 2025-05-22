import React, { useState, useEffect } from 'react';

interface PillProps {
  isListening: boolean;
  isProcessing: boolean;
  onStartDictation: () => void;
  onStopDictation: () => void;
}

const Pill: React.FC<PillProps> = ({ 
  isListening, 
  isProcessing, 
  onStartDictation, 
  onStopDictation 
}) => {
  const [isHovered, setIsHovered] = useState(false);
  
  // Number of dots/bars to display - consistent across all states
  const VISUALIZATION_COUNT = 7;
  
  // Generate frequency bars for the waveform (active state)
  const renderFrequencyBars = () => {
    // Create bars with consistent count
    return Array.from({ length: VISUALIZATION_COUNT }).map((_, index) => (
      <div 
        key={`bar-${index}`} 
        className="waveform-bar"
        style={{ 
          animationDelay: `${index * 0.1}s`,
          height: `${3 + Math.random() * 5}px`
        }}
      />
    ));
  };

  // Unified function to render dots with different styles
  const renderDots = (type: 'static' | 'animated' | 'collapsed') => {
    return Array.from({ length: VISUALIZATION_COUNT }).map((_, index) => (
      <div 
        key={`dot-${type}-${index}`} 
        className={`dot ${type}`}
        style={type === 'animated' ? { animationDelay: `${index * 0.12}s` } : undefined}
      />
    ));
  };

  // Handle context menu
  const handleContextMenu = (e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault(); // Prevent default browser context menu
    console.log(`[Pill] Context menu requested.`); // Removed coordinate logging
    // Check if the electron API exists and has the showPillContextMenu method
    if (window.electron && 'showPillContextMenu' in window.electron) {
      // Call without coordinates
      (window.electron as any).showPillContextMenu();
    } else {
      console.warn('[Pill] window.electron.showPillContextMenu not available.');
    }
  };
  
  // Determine if the pill should be in the expanded state
  const isExpanded = isHovered || isListening || isProcessing;
  
  return (
    <div 
      className={`
        pill-container 
        ${isExpanded ? 'expanded' : 'collapsed'}
        ${isListening ? 'listening' : ''}
        ${isProcessing ? 'processing' : ''}
        flex items-center justify-center
      `}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onClick={isListening ? onStopDictation : onStartDictation}
      onContextMenu={handleContextMenu}
    >
      <div className="pill-content flex items-center justify-center w-full h-full">
        {/* Dormant state - show smaller dots */}
        {!isExpanded && (
          <div className="visualization-container">
            {renderDots('collapsed')}
          </div>
        )}

        {/* Hover state - show static dots */}
        {isHovered && !isListening && !isProcessing && (
          <div className="visualization-container">
            {renderDots('static')}
          </div>
        )}
        
        {/* Active state - show frequency bars */}
        {isListening && (
          <div className="visualization-container">
            {renderFrequencyBars()}
          </div>
        )}
        
        {/* Loading state - show animated dots */}
        {isProcessing && !isListening && (
          <div className="visualization-container">
            {renderDots('animated')}
          </div>
        )}
      </div>
    </div>
  );
};

export default Pill; 