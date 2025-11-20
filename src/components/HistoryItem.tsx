import React from "react";
import { motion } from "framer-motion";
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

const HistoryItem: React.FC<HistoryItemProps> = ({ item, onCopy }) => {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ type: "spring", ...MOTION.springs.quick }}
      className="group flex border-b border-border/20 hover:bg-white/5 transition-colors cursor-default"
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
            onClick={onCopy}
            className="opacity-0 group-hover:opacity-100 transition-opacity"
            title="Copy to clipboard"
          >
            <SfIcon name="document.on.document" size={14} className="text-muted-foreground/50 hover:text-foreground transition-colors" />
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
