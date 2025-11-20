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
