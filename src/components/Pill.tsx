import React, { useState, useEffect } from 'react';

interface PillProps {
  isListening: boolean;
  isProcessing: boolean;
  isHovered: boolean;
  onStartDictation: () => void;
  onStopDictation: () => void;
}

const Pill: React.FC<PillProps> = ({ 
  isListening, 
  isProcessing, 
  isHovered,
  onStartDictation, 
  onStopDictation 
}) => {
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


  
  // Determine if the pill should be in the expanded state
  const isExpanded = isHovered || isListening || isProcessing;
  
  return (
    <div 
      className={`
        pill-wrapper
        ${isExpanded ? 'expanded' : 'collapsed'}
        ${isListening ? 'listening' : ''}
        ${isProcessing ? 'processing' : ''}
      `}
      onClick={isListening ? onStopDictation : onStartDictation}
    >
      <div className="pill-core">
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
    </div>
  );
};

export default Pill; 