/**
 * useVisibilityObserver.ts
 *
 * A custom hook to track the visibility of an element within the viewport, including support for margins similar to the IntersectionObserver API.
 * The hook continuously checks the element's visibility at a specified interval, calling the provided callbacks when the element becomes visible or invisible.
 */

import { useState, useEffect, useRef, useCallback } from 'react';

// Type definitions for the hook's props
export type VisibilityTrackerProps = {
  /**
   * The delay in milliseconds between visibility checks. Default is 100ms.
   */
  delay?: number;

  /**
   * A CSS-like margin to expand or contract the area used to determine visibility. Default is '0px'.
   */
  rootMargin?: string;

  /**
   * Callback function to be called when the element becomes visible.
   */
  onVisible?: () => void;

  /**
   * Callback function to be called when the element becomes invisible.
   */
  onInvisible?: () => void;

  /**
   * Initial visibility state. Default is false.
   */
  initialInView?: boolean;
  /**
   * Whether to track visibility of the element. Default is true.
   * If set to false, the element will be considered visible at all times, regardless of its actual visibility of initialInView value.
   */
  trackVisibility?: boolean;
};

// Type definitions for the hook's return value
export type VisibilityTrackerReturn = {
  /**
   * Whether the element is currently visible.
   */
  visible: boolean;

  /**
   * A ref callback to attach to the element to be observed.
   */
  ref: (node?: HTMLElement | null) => void;
};

/**
 * Parses a CSS-like margin string into an object with top, right, bottom, and left properties.
 *
 * @param margin - A CSS-like margin string (e.g., '10px', '10px 20px', '10px 20px 30px', '10px 20px 30px 40px').
 * @returns An object with top, right, bottom, and left properties.
 */
const parseRootMargin = (margin: string) => {
  const values = margin.split(' ').map(value => parseInt(value, 10));

  switch (values.length) {
    case 1:
      return {
        top: values[0],
        right: values[0],
        bottom: values[0],
        left: values[0],
      };
    case 2:
      return {
        top: values[0],
        right: values[1],
        bottom: values[0],
        left: values[1],
      };
    case 3:
      return {
        top: values[0],
        right: values[1],
        bottom: values[2],
        left: values[1],
      };
    case 4:
      return {
        top: values[0],
        right: values[1],
        bottom: values[2],
        left: values[3],
      };
    default:
      return {
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
      };
  }
};

/**
 * A custom hook that tracks the visibility of an element within the viewport.
 *
 * @param delay - The delay in milliseconds between visibility checks.
 * @param rootMargin - A CSS-like margin string to expand or contract the area used to determine visibility.
 * @param onVisible - Callback function to be called when the element becomes visible.
 * @param onInvisible - Callback function to be called when the element becomes invisible.
 * @param initialInView - Initial visibility state.
 * @returns An object containing the visibility state and a ref callback to attach to the element.
 */
export const useVisibilityObserver = ({
  delay = 100,
  rootMargin = '0px',
  onVisible,
  onInvisible,
  initialInView = false,
  trackVisibility = true,
}: VisibilityTrackerProps): VisibilityTrackerReturn => {
  const [visible, setVisible] = useState(initialInView || !trackVisibility);
  const targetRef = useRef<HTMLElement | null>(null);
  const intervalRef = useRef<number | null>(null);
  const { top, right, bottom, left } = parseRootMargin(rootMargin);

  // Callback to check the visibility of the target element
  const checkVisibility = useCallback(() => {
    if (!targetRef.current) return;
    const rect = targetRef.current.getBoundingClientRect();
    const inView =
      rect.bottom > -top &&
      rect.right > -left &&
      rect.top < window.innerHeight + bottom &&
      rect.left < window.innerWidth + right;

    if (inView) {
      setVisible(true);
    } else {
      setVisible(false);
    }
  }, [top, right, bottom, left]);

  useEffect(() => {
    if (!trackVisibility) {
      setVisible(true);
      return;
    }
    // Start the interval to check visibility
    const startChecking = () => {
      if (intervalRef.current) return;
      intervalRef.current = window.setInterval(checkVisibility, delay);
    };

    // Stop the interval to check visibility
    const stopChecking = () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };

    startChecking();
    return () => stopChecking(); // Clean up interval on unmount
  }, [checkVisibility, delay, trackVisibility]);

  useEffect(() => {
    if (visible) {
      onVisible?.();
    } else {
      onInvisible?.();
    }
  }, [visible, onVisible, onInvisible]);

  // Ref callback to attach to the target element
  const ref = useCallback((node?: HTMLElement | null) => {
    if (node) targetRef.current = node;
  }, []);

  return { visible, ref };
};
