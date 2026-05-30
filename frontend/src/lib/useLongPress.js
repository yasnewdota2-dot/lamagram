import { useCallback, useRef } from "react";

/**
 * useLongPress — fires `onLongPress` after `threshold` ms of pointer/touch hold.
 * Cancels if pointer moves > moveThreshold (10px) or is released early.
 * Also wires `onContextMenu` so right-click on desktop triggers the same path.
 *
 * Returns an object spread onto the target element:
 *   const lp = useLongPress(handler);
 *   <div {...lp} />
 */
export function useLongPress(onLongPress, { threshold = 500, moveThreshold = 10 } = {}) {
  const timerRef = useRef(null);
  const firedRef = useRef(false);
  const startRef = useRef({ x: 0, y: 0 });

  const clear = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const start = useCallback((e) => {
    firedRef.current = false;
    const point = e.touches?.[0] || e;
    startRef.current = { x: point.clientX || 0, y: point.clientY || 0 };
    clear();
    timerRef.current = setTimeout(() => {
      firedRef.current = true;
      onLongPress?.(e);
    }, threshold);
  }, [clear, onLongPress, threshold]);

  const move = useCallback((e) => {
    if (!timerRef.current) return;
    const point = e.touches?.[0] || e;
    const dx = (point.clientX || 0) - startRef.current.x;
    const dy = (point.clientY || 0) - startRef.current.y;
    if (Math.hypot(dx, dy) > moveThreshold) clear();
  }, [clear, moveThreshold]);

  const cancel = useCallback(() => {
    clear();
  }, [clear]);

  return {
    onTouchStart: start,
    onTouchMove: move,
    onTouchEnd: cancel,
    onTouchCancel: cancel,
    onPointerDown: (e) => {
      // Only left button or touch
      if (e.pointerType === "mouse" && e.button !== 0) return;
      start(e);
    },
    onPointerMove: move,
    onPointerUp: cancel,
    onPointerLeave: cancel,
    onContextMenu: (e) => {
      // Right-click on desktop → same as long-press
      e.preventDefault();
      firedRef.current = true;
      onLongPress?.(e);
    },
    /** Call this from your onClick to know if the click should be suppressed */
    didFire: () => firedRef.current,
  };
}
