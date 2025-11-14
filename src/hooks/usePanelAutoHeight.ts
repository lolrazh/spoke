import { useLayoutEffect, type RefObject } from "react";

/**
 * Reports the natural height of a panel container (including padding) so the
 * pill shell can resize itself without relying on hard-coded values.
 */
export function usePanelAutoHeight(
  ref: RefObject<HTMLElement>,
  onHeightChange?: (height: number) => void,
): void {
  useLayoutEffect(() => {
    if (!ref.current || !onHeightChange) return;
    if (typeof window === "undefined") return;

    let rafHandle: number | null = null;

    const measure = () => {
      const node = ref.current;
      if (!node) return;
      const measured =
        typeof node.scrollHeight === "number"
          ? node.scrollHeight
          : node.getBoundingClientRect().height;
      const height = Math.ceil(Math.max(measured, 0));
      onHeightChange(height);
    };

    measure();

    const ResizeObserverCtor = window.ResizeObserver;
    if (!ResizeObserverCtor) {
      const handleResize = () => measure();
      window.addEventListener("resize", handleResize);
      const interval = window.setInterval(measure, 500);

      return () => {
        window.removeEventListener("resize", handleResize);
        window.clearInterval(interval);
        if (rafHandle !== null) {
          window.cancelAnimationFrame(rafHandle);
        }
      };
    }

    const observer = new ResizeObserverCtor(() => {
      // Batch DOM reads to the next frame to avoid layout thrash
      if (rafHandle !== null) {
        window.cancelAnimationFrame(rafHandle);
      }
      rafHandle = window.requestAnimationFrame(measure);
    });

    observer.observe(ref.current);

    return () => {
      if (rafHandle !== null) {
        window.cancelAnimationFrame(rafHandle);
      }
      observer.disconnect();
    };
  }, [ref, onHeightChange]);
}
