import React, { useState } from "react";
import { motion } from "framer-motion";
import { MOTION } from "../config/motionTokens";
import DateGroup from "./DateGroup";
import HistoryItem, { HistoryItemData } from "./HistoryItem";

// Mock data for development/testing
const generateMockData = (): HistoryItemData[] => {
  const now = Date.now();
  const oneHour = 60 * 60 * 1000;
  const oneDay = 24 * oneHour;

  return [
    // Today
    {
      id: "1",
      text: "Hey team, let's schedule a meeting for tomorrow afternoon to discuss the project roadmap and align on priorities.",
      timestamp: now - 2 * oneHour,
      mode: "dictation" as const,
    },
    {
      id: "2",
      text: "Quick reminder to follow up with the client about their feedback on the latest prototype we sent last week.",
      timestamp: now - 4 * oneHour,
      mode: "dictation" as const,
    },
    {
      id: "3",
      text: "Meeting notes: Discussed the new feature requirements, timeline constraints, and resource allocation for Q2.",
      timestamp: now - 6 * oneHour,
      mode: "dictation" as const,
    },
    // Yesterday
    {
      id: "4",
      text: "Project update: We've completed the initial design phase and are ready to move into development this week.",
      timestamp: now - oneDay - 5 * oneHour,
      mode: "dictation" as const,
    },
    {
      id: "5",
      text: "Thanks for the great presentation today. The stakeholders were really impressed with the progress we've made.",
      timestamp: now - oneDay - 8 * oneHour,
      mode: "dictation" as const,
    },
    // This Week (3 days ago)
    {
      id: "6",
      text: "Don't forget to submit your timesheet by end of day Friday. Also, please update the project tracker with your progress.",
      timestamp: now - 3 * oneDay - 2 * oneHour,
      mode: "dictation" as const,
    },
    {
      id: "7",
      text: "The new design system documentation is now live on Confluence. Check it out and let me know if you have any questions.",
      timestamp: now - 3 * oneDay - 6 * oneHour,
      mode: "dictation" as const,
    },
    // This Week (5 days ago)
    {
      id: "8",
      text: "Reminder: Team lunch this Friday at 12:30 PM. Please RSVP in the calendar invite so we can get an accurate headcount.",
      timestamp: now - 5 * oneDay - 3 * oneHour,
      mode: "dictation" as const,
    },
  ];
};

// Helper function to group items by date categories
const groupItemsByDate = (items: HistoryItemData[]) => {
  const now = Date.now();
  const oneDay = 24 * 60 * 60 * 1000;
  const startOfToday = new Date().setHours(0, 0, 0, 0);
  const startOfYesterday = startOfToday - oneDay;
  const startOfThisWeek = startOfToday - 7 * oneDay;

  const groups: { label: string; items: HistoryItemData[] }[] = [
    { label: "TODAY", items: [] },
    { label: "YESTERDAY", items: [] },
    { label: "THIS WEEK", items: [] },
    { label: "OLDER", items: [] },
  ];

  items.forEach((item) => {
    if (item.timestamp >= startOfToday) {
      groups[0].items.push(item);
    } else if (item.timestamp >= startOfYesterday) {
      groups[1].items.push(item);
    } else if (item.timestamp >= startOfThisWeek) {
      groups[2].items.push(item);
    } else {
      groups[3].items.push(item);
    }
  });

  // Filter out empty groups
  return groups.filter((group) => group.items.length > 0);
};

interface TranscriptionHistoryViewProps {
  // In the future, we'll pass real data here
  // historyItems?: HistoryItemData[];
}

const TranscriptionHistoryView: React.FC<TranscriptionHistoryViewProps> = () => {
  // For now, using mock data - will be replaced with real data later
  const [historyItems] = useState<HistoryItemData[]>(generateMockData());
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const groupedItems = groupItemsByDate(historyItems);

  const handleCopy = (item: HistoryItemData) => {
    // Copy to clipboard
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(item.text).then(() => {
        setCopiedId(item.id);
        setTimeout(() => setCopiedId(null), 2000); // Reset after 2s
      });
    }
  };

  // Empty state
  if (historyItems.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 px-4">
        <div className="text-center">
          <div className="mb-4 opacity-30">
            <svg
              width="64"
              height="64"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
            </svg>
          </div>
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

      {/* Copy success toast (optional, simple version) */}
      {copiedId && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 20 }}
          className="fixed bottom-8 left-1/2 -translate-x-1/2 bg-foreground text-background px-4 py-2 rounded-lg shadow-lg text-sm font-medium z-50"
        >
          Copied to clipboard
        </motion.div>
      )}
    </motion.div>
  );
};

export default TranscriptionHistoryView;
