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
      className="group relative p-3 border-b border-border/20 hover:bg-white/5 transition-colors cursor-default"
    >
      {/* Text */}
      <p className="text-xs text-foreground/80 leading-relaxed font-normal">
        {item.text}
      </p>

      {/* Bottom row: Time and Copy */}
      <div className="flex items-center justify-end gap-2 mt-2">
        <span className="text-[10px] text-muted-foreground/60">
          {formatTime(item.timestamp)}
        </span>
        <button
          onClick={onCopy}
          className="p-1.5 rounded-md opacity-0 group-hover:opacity-100 hover:bg-white/10 transition-all"
          title="Copy to clipboard"
        >
          <SfIcon name="doc.on.doc" size={12} className="text-muted-foreground hover:text-foreground transition-colors" />
        </button>
      </div>
    </motion.div>
  );
};

export default HistoryItem;
