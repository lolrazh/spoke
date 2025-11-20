import React from "react";
import { motion } from "framer-motion";
import { MOTION } from "../config/motionTokens";
import { SectionSeparator } from "./SettingsPanel";

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
      style={{ marginTop: "var(--panel-section-offset)" }}
    >
      {/* Date Label - using same style as settings sections */}
      <SectionSeparator title={label} />

      {/* Items */}
      <div className="space-y-0">
        {children}
      </div>
    </motion.div>
  );
};

export default DateGroup;
