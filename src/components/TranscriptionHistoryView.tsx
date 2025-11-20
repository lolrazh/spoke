import React, { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { MOTION } from "../config/motionTokens";
import DateGroup from "./DateGroup";
import HistoryItem, { HistoryItemData } from "./HistoryItem";
import {
  subscribeTranscriptionHistory,
  getTranscriptionHistory,
} from "../state/transcriptionHistory";
import type { TranscriptionItem } from "../types/shared";

// Helper function to format date as "MMM DD, YYYY" in caps
const formatDateLabel = (timestamp: number): string => {
  const date = new Date(timestamp);
  const months = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
  const month = months[date.getMonth()];
  const day = date.getDate();
  const year = date.getFullYear();
  return `${month} ${day}, ${year}`;
};

// Helper function to get start of day for a timestamp
const getStartOfDay = (timestamp: number): number => {
  const date = new Date(timestamp);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
};

// Helper function to group items by date categories
const groupItemsByDate = (items: HistoryItemData[]) => {
  const startOfToday = new Date().setHours(0, 0, 0, 0);
  const oneDay = 24 * 60 * 60 * 1000;
  const startOfYesterday = startOfToday - oneDay;

  // Use a Map to collect items by their date key
  const groupMap = new Map<string, { label: string; items: HistoryItemData[]; sortKey: number }>();

  items.forEach((item) => {
    let label: string;
    let sortKey: number;

    if (item.timestamp >= startOfToday) {
      label = "TODAY";
      sortKey = startOfToday;
    } else if (item.timestamp >= startOfYesterday) {
      label = "YESTERDAY";
      sortKey = startOfYesterday;
    } else {
      // For older items, group by individual day
      const dayStart = getStartOfDay(item.timestamp);
      label = formatDateLabel(item.timestamp);
      sortKey = dayStart;
    }

    if (!groupMap.has(label)) {
      groupMap.set(label, { label, items: [], sortKey });
    }
    groupMap.get(label)!.items.push(item);
  });

  // Convert to array and sort by date (most recent first)
  const groups = Array.from(groupMap.values());
  groups.sort((a, b) => b.sortKey - a.sortKey);

  return groups;
};

// Convert TranscriptionItem to HistoryItemData
const toHistoryItem = (item: TranscriptionItem): HistoryItemData => ({
  id: item.id,
  text: item.text,
  timestamp: item.timestamp,
  mode: item.mode,
});

const TranscriptionHistoryView: React.FC = () => {
  const [historyItems, setHistoryItems] = useState<HistoryItemData[]>(() =>
    getTranscriptionHistory().map(toHistoryItem)
  );

  // Subscribe to transcription history changes
  useEffect(() => {
    const unsubscribe = subscribeTranscriptionHistory((items) => {
      setHistoryItems(items.map(toHistoryItem));
    });
    return unsubscribe;
  }, []);

  const groupedItems = groupItemsByDate(historyItems);

  const handleCopy = (item: HistoryItemData) => {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(item.text);
    }
  };

  // Empty state
  if (historyItems.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 px-4">
        <div className="text-center">
          <p className="text-sm text-muted-foreground">No transcriptions yet</p>
          <p className="text-xs text-muted-foreground/60 mt-1">
            Your transcription history will appear here
          </p>
        </div>
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: MOTION.durations.standard }}
    >
      {groupedItems.map((group) => (
        <DateGroup key={group.label} label={group.label}>
          {group.items.map((item, index) => (
            <div key={item.id}>
              <HistoryItem
                item={item}
                onCopy={() => handleCopy(item)}
              />
              {/* Don't show border after last item */}
              {index === group.items.length - 1 && (
                <div className="h-0" />
              )}
            </div>
          ))}
        </DateGroup>
      ))}
    </motion.div>
  );
};

export default TranscriptionHistoryView;
