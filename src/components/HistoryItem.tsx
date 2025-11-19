import React from "react";
import { motion } from "framer-motion";
import { MOTION } from "../config/motionTokens";
import { Button } from "./ui/button";
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
      className="group relative p-4 border-b border-border/20 hover:bg-white/5 transition-colors cursor-default"
    >
      {/* Time */}
      <div className="text-[11px] text-muted-foreground/70 mb-2 font-medium">
        {formatTime(item.timestamp)}
      </div>

      {/* Text */}
      <p className="text-sm text-foreground/90 leading-relaxed pr-8">
        {item.text}
      </p>

      {/* Copy Button - shows on hover */}
      <div className="absolute top-4 right-4 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          onClick={onCopy}
          className="p-2 rounded-md hover:bg-white/10 transition-colors"
          title="Copy to clipboard"
        >
          <SfIcon name="doc.on.doc" size={14} className="text-muted-foreground hover:text-foreground transition-colors" />
        </button>
      </div>
    </motion.div>
  );
};

export default HistoryItem;
