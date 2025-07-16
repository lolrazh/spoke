import { useState, useLayoutEffect } from 'react';

/**
 * A hook that measures the width of a piece of text by rendering it into a hidden "ghost" element.
 * It uses a ResizeObserver to reliably report the width, even accounting for font loads.
 * @param text The text to measure.
 * @returns The measured width in pixels.
 */
export function useGhostMeasure(text: string): number {
  const [width, setWidth] = useState(0);

  useLayoutEffect(() => {
    const ghostElement = document.getElementById('pill-ghost-measure');
    if (!ghostElement) return;

    // Set the text content of the ghost element.
    ghostElement.textContent = text || '';

    // Use ResizeObserver to listen for size changes. This is more reliable than a one-time read,
    // as it accounts for things like web font loading that can change the element's size.
    const resizeObserver = new ResizeObserver(([entry]) => {
      // We use contentRect.width which is the width of the content, excluding padding.
      setWidth(Math.ceil(entry.contentRect.width));
    });

    resizeObserver.observe(ghostElement);

    // Also set the initial width immediately.
    setWidth(Math.ceil(ghostElement.offsetWidth));

    // Cleanup by disconnecting the observer when the component unmounts or text changes.
    return () => resizeObserver.disconnect();
  }, [text]);

  return width;
} 