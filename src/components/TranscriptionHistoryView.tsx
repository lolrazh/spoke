import React, { useState, useEffect, useRef, useCallback } from "react";
import { m } from "framer-motion";
import DateGroup from "./DateGroup";
import HistoryItem, { HistoryItemData } from "./HistoryItem";
import {
  panelCascadeContainer,
  panelCascadeItem,
} from "./shared/panelMotion";
import {
  subscribeTranscriptionHistory,
  getTranscriptionHistory,
} from "../state/transcriptionHistory";
import type { TranscriptionItem } from "../types/shared";

/** Number of items to load per batch */
const PAGE_SIZE = 50;

// Helper function to format date as "MMM DD, YYYY" in caps
const formatDateLabel = (timestamp: number): string => {
  const date = new Date(timestamp);
  const months = [
    "JAN",
    "FEB",
    "MAR",
    "APR",
    "MAY",
    "JUN",
    "JUL",
    "AUG",
    "SEP",
    "OCT",
    "NOV",
    "DEC",
  ];
  const month = months[date.getMonth()];
  const day = date.getDate();
  const year = date.getFullYear();
  return `${month} ${day}, ${year}`;
};

// Helper function to get start of day for a timestamp
const getStartOfDay = (timestamp: number): number => {
  const date = new Date(timestamp);
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
  ).getTime();
};

// Helper function to group items by date categories
const groupItemsByDate = (items: HistoryItemData[]) => {
  const startOfToday = new Date().setHours(0, 0, 0, 0);
  const oneDay = 24 * 60 * 60 * 1000;
  const startOfYesterday = startOfToday - oneDay;

  // Use a Map to collect items by their date key
  const groupMap = new Map<
    string,
    { label: string; items: HistoryItemData[]; sortKey: number }
  >();

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
  const [historyItems, setHistoryItems] = useState<TranscriptionItem[]>(() =>
    getTranscriptionHistory(),
  );
  const [displayedCount, setDisplayedCount] = useState(PAGE_SIZE);
  const loadMoreRef = useRef<HTMLDivElement>(null);

  // Track which items were in the initial batch (for animation skipping)
  const initialBatchIdsRef = useRef<Set<string>>(new Set());

  // Initialize the initial batch IDs on first render
  useEffect(() => {
    if (initialBatchIdsRef.current.size === 0 && historyItems.length > 0) {
      const initialIds = historyItems
        .slice(0, PAGE_SIZE)
        .map((item) => item.id);
      initialBatchIdsRef.current = new Set(initialIds);
    }
  }, [historyItems]);

  // Subscribe to transcription history changes. Store the raw list as-is so a
  // new transcription doesn't re-map the whole history on every emit; only the
  // visible window is mapped below.
  useEffect(() => {
    const unsubscribe = subscribeTranscriptionHistory(setHistoryItems);
    return unsubscribe;
  }, []);

  // Map only the visible slice of items. Memoized so its identity is stable
  // across renders where neither the list nor the paging cursor changed,
  // which keeps the grouping memo below from recomputing needlessly.
  const visibleItems = React.useMemo(
    () => historyItems.slice(0, displayedCount).map(toHistoryItem),
    [historyItems, displayedCount],
  );

  // Memoize grouping since it does real work (Map creation, sorting)
  const groupedItems = React.useMemo(() => {
    return groupItemsByDate(visibleItems);
  }, [visibleItems]);

  // Load more items when scrolling to bottom
  const loadMore = useCallback(() => {
    setDisplayedCount((prev) =>
      Math.min(prev + PAGE_SIZE, historyItems.length),
    );
  }, [historyItems.length]);

  // Intersection observer for infinite scroll
  useEffect(() => {
    const sentinel = loadMoreRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && displayedCount < historyItems.length) {
          loadMore();
        }
      },
      { rootMargin: "100px" }, // Start loading 100px before reaching the bottom
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [displayedCount, historyItems.length, loadMore]);

  const hasMore = displayedCount < historyItems.length;

  const handleCopy = useCallback(async (item: HistoryItemData) => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(item.text);
        return true;
      }
    } catch (error) {
      console.warn("[History] Browser clipboard write failed:", error);
    }

    try {
      const result = await window.clipboard?.writeText?.(item.text);
      return result?.ok === true;
    } catch (error) {
      console.warn("[History] Electron clipboard write failed:", error);
      return false;
    }
  }, []);

  // Check if an item should skip its entrance animation
  // If it's NOT in the initial batch, we skip animation so it feels like native scrolling
  const shouldSkipAnimation = (itemId: string) => {
    return !initialBatchIdsRef.current.has(itemId);
  };

  // Empty state
  if (historyItems.length === 0) {
    return (
      <m.div
        className="flex flex-col items-center justify-center py-16 px-4"
        initial="hidden"
        animate="visible"
        variants={panelCascadeContainer}
      >
        <m.div className="text-center" variants={panelCascadeItem}>
          <p className="text-sm text-muted-foreground">No transcriptions yet</p>
          <p className="text-xs text-muted-foreground/60 mt-1">
            Your transcription history will appear here
          </p>
        </m.div>
      </m.div>
    );
  }

  return (
    <m.div
      initial="hidden"
      animate="visible"
      variants={panelCascadeContainer}
    >
      {groupedItems.map((group) => (
        <DateGroup key={group.label} label={group.label}>
          {group.items.map((item, index) => (
            <div key={item.id}>
              <HistoryItem
                item={item}
                onCopy={() => handleCopy(item)}
                skipAnimation={shouldSkipAnimation(item.id)}
              />
              {/* Don't show border after last item */}
              {index === group.items.length - 1 && <div className="h-0" />}
            </div>
          ))}
        </DateGroup>
      ))}

      {/* Sentinel element for infinite scroll */}
      <div ref={loadMoreRef} className="h-1" />

      {/* Loading indicator when more items are available */}
      {hasMore && (
        <div className="flex justify-center py-4">
          <span className="text-xs text-muted-foreground/50">
            Loading more...
          </span>
        </div>
      )}
    </m.div>
  );
};

export default TranscriptionHistoryView;
