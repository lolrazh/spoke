import { useState, useLayoutEffect } from "react";

/**
 * Measures the width of a text string by rendering it into an off-screen "ghost" element.
 * It uses a ResizeObserver to respond to any size changes, for instance, from web font loading.
 *
 * @param text The text to measure.
 * @returns The measured width of the text in pixels.
 */
export function useGhostMeasure(text: string): number {
  const [width, setWidth] = useState(0);

  useLayoutEffect(() => {
    const el = document.getElementById("pill-ghost-measure") as HTMLSpanElement | null;
    if (!el) return;

    // Set the text content of the ghost element.
    el.textContent = text || "";

    // Use a ResizeObserver to get the most accurate, up-to-date width.
    const observer = new ResizeObserver(([entry]) => {
      // We use Math.ceil to avoid fractional pixels, which can cause jitter.
      setWidth(Math.ceil(entry.contentRect.width));
    });

    observer.observe(el);

    // Also, set the initial width immediately without waiting for the observer.
    setWidth(Math.ceil(el.offsetWidth));

    // Cleanup function to disconnect the observer when the component unmounts or text changes.
    return () => observer.disconnect();
  }, [text]);

  return width;
} 