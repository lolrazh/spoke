import React from "react";
import { m } from "framer-motion";
import { SectionSeparator } from "./SectionSeparator";
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
    <m.div
      variants={panelCascadeItem}
      style={{ marginTop: "var(--panel-section-offset)" }}
    >
      {/* Date Label - using same style as settings sections */}
      <SectionSeparator title={label} />

      {/* Items - with card outline */}
      <m.div
        variants={panelCascadeContainer}
        className="border border-white/[0.08] rounded-lg overflow-hidden bg-background [&>*:last-child]:border-b-0"
      >
        {children}
      </m.div>
    </m.div>
  );
};

export default DateGroup;
