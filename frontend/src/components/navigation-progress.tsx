"use client";

import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import { NavigationPendingContext } from "@/lib/use-url-state";

/**
 * A thin progress bar across the top of the portal while any URL navigation is
 * in flight.
 *
 * Twelve controls drive server re-renders through the URL, and measurement put
 * the quiet interval at 897-2,321ms. Per-control feedback (a pulsing tab, a
 * dimmed filter row) says *which* control was pressed; this says *the page is
 * working*, which is the part a user needs when the thing they clicked is now
 * off-screen or when the delay runs long enough for them to look elsewhere.
 *
 * A counter, not a boolean: two transitions can overlap -- changing a filter
 * while a tab change is still settling -- and the bar must not clear while the
 * second is still running.
 *
 * It is `aria-hidden`. The bar is reassurance for sighted users; assistive tech
 * gets the per-control `aria-busy` instead, which says what is loading rather
 * than merely that something is. A live region here would announce on every
 * filter keystroke, which is noise.
 */
export function NavigationProgress({ children }: { children: ReactNode }) {
  const [active, setActive] = useState(0);
  const count = useRef(0);

  const begin = useCallback(() => {
    count.current += 1;
    setActive(count.current);
  }, []);
  const end = useCallback(() => {
    count.current = Math.max(0, count.current - 1);
    setActive(count.current);
  }, []);

  const value = useMemo(() => ({ begin, end }), [begin, end]);

  return (
    <NavigationPendingContext.Provider value={value}>
      <div
        aria-hidden="true"
        className={
          "pointer-events-none fixed inset-x-0 top-0 z-50 h-0.5 transition-opacity duration-150 " +
          (active > 0 ? "opacity-100" : "opacity-0")
        }
      >
        <div className="h-full w-full animate-pulse bg-brand-sky-dark" />
      </div>
      {children}
    </NavigationPendingContext.Provider>
  );
}
