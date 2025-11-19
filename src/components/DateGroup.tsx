import React from "react";
import { motion } from "framer-motion";
import { MOTION } from "../config/motionTokens";

interface DateGroupProps {
  label: string; // e.g., "TODAY", "YESTERDAY", "THIS WEEK"
  children: React.ReactNode;
}

const DateGroup: React.FC<DateGroupProps> = ({ label, children }) => {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", ...MOTION.springs.quick }}
      className="mb-6"
    >
      {/* Date Label */}
      <div className="px-4 py-2 mb-2">
        <h3 className="text-[10px] font-semibold text-muted-foreground/70 tracking-widest uppercase">
          {label}
        </h3>
      </div>

      {/* Items */}
      <div className="border border-border/30 rounded-lg overflow-hidden bg-background/30 backdrop-blur-sm">
        {children}
      </div>
    </motion.div>
  );
};

export default DateGroup;
