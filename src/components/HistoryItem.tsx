import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { MOTION } from "../config/motionTokens";
import SfIcon from "./icons/SfIcon";

export interface HistoryItemData {
  id: string;
  text: string;
  timestamp: number; // Unix timestamp in ms
  mode?: "dictation" | "edit";
}

interface HistoryItemProps {
  item: HistoryItemData;
  onCopy: () => void;
  skipAnimation?: boolean;
}

const formatTime = (timestamp: number): string => {
  const date = new Date(timestamp);
  const hours = date.getHours();
  const minutes = date.getMinutes();
  const ampm = hours >= 12 ? "PM" : "AM";
  const displayHours = hours % 12 || 12;
  const displayMinutes = minutes.toString().padStart(2, "0");
  return `${displayHours}:${displayMinutes} ${ampm}`;
};

const HistoryItem: React.FC<HistoryItemProps> = ({ item, onCopy, skipAnimation = false }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    onCopy();
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <motion.div
      initial={skipAnimation ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ type: "spring", ...MOTION.springs.quick }}
      className="group flex border-b border-white/[0.08] hover:bg-white/5 transition-colors cursor-default"
    >
      {/* Text - left side with max width */}
      <div className="flex-1 p-3 pr-2">
        <p className="text-xs text-foreground/80 leading-relaxed font-normal">
          {item.text}
        </p>
      </div>

      {/* Right band - copy button centered, time at bottom */}
      <div className="flex flex-col items-center pt-2 pb-1 px-3 min-w-[48px]">
        {/* Copy button - takes remaining space, centered within */}
        <div className="flex-1 flex items-center justify-center">
          <button
            onClick={handleCopy}
            className={`transition-opacity w-[14px] h-[14px] flex items-center justify-center ${copied ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}
            title="Copy to clipboard"
          >
            <AnimatePresence mode="wait">
              {copied ? (
                <motion.svg
                  key="check"
                  width={14}
                  height={14}
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2.5}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="text-foreground"
                  initial={{ scale: 0.6, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ scale: 0.6, opacity: 0 }}
                  transition={{
                    default: {
                      type: "spring",
                      stiffness: 600,
                      damping: 15,
                      mass: 0.5
                    },
                    exit: { duration: 0.05 }
                  }}
                >
                  <motion.path
                    d="M4 12l5 5L20 6"
                    initial={{ pathLength: 0 }}
                    animate={{ pathLength: 1 }}
                    transition={{ duration: 0.15, ease: "easeOut" }}
                  />
                </motion.svg>
              ) : (
                <motion.div
                  key="copy"
                  initial={{ scale: 0.6, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ scale: 0.6, opacity: 0 }}
                  transition={{
                    default: {
                      type: "spring",
                      stiffness: 600,
                      damping: 15,
                      mass: 0.5
                    },
                    exit: { duration: 0.05 }
                  }}
                >
                  <SfIcon name="document.on.document" size={14} className="text-muted-foreground/50 hover:text-foreground transition-colors" />
                </motion.div>
              )}
            </AnimatePresence>
          </button>
        </div>
        {/* Time - anchored at bottom */}
        <span className="text-[10px] text-muted-foreground/50">
          {formatTime(item.timestamp)}
        </span>
      </div>
    </motion.div>
  );
};

export default HistoryItem;
