import React from "react";
import { motion } from "framer-motion";
import { SectionSeparator } from "./SettingsPanel";
import {
  panelCascadeContainer,
  panelCascadeItem,
} from "./shared/panelMotion";

interface DateGroupProps {
  label: string; // e.g., "TODAY", "YESTERDAY", "THIS WEEK"
  children: React.ReactNode;
}

const DateGroup: React.FC<DateGroupProps> = ({ label, children }) => {
  return (
    <motion.div
      variants={panelCascadeItem}
      style={{ marginTop: "var(--panel-section-offset)" }}
    >
      {/* Date Label - using same style as settings sections */}
      <SectionSeparator title={label} />

      {/* Items - with card outline */}
      <motion.div
        variants={panelCascadeContainer}
        className="border border-white/[0.08] rounded-lg overflow-hidden bg-background [&>*:last-child]:border-b-0"
      >
        {children}
      </motion.div>
    </motion.div>
  );
};

export default DateGroup;
