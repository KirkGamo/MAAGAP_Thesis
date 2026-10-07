"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useTransition,
} from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

/**
 * Lets the layout know that *some* control is navigating, without every control
 * having to be wired to the indicator individually.
 *
 * The alternative was a progress bar per page reading one control's state, which
 * would mean twelve wirings and would still miss any control added later. A
 * counter rather than a boolean because two transitions can overlap -- a filter
 * change while a tab change is still settling -- and the bar must not clear
 * while the second is in flight.
 *
 * Optional by design: `useUrlState` works unchanged outside a provider, so a
 * component can be used in isolation or in a test without one.
 */
export const NavigationPendingContext = createContext<{
  begin: () => void;
  end: () => void;
} | null>(null);

/**
 * URL-param navigation with a pending state.
 *
 * Every filter, tab, toggle and list selection in this portal drives a server
 * re-render through the URL. Twelve components each wrote the same three lines
 * -- copy the current params, mutate one, `router.push` -- and none of them
 * wrapped it in a transition, so none could tell the user anything was
 * happening.
 *
 * That was not a cosmetic gap. Measured on a production build, click to
 * settled: 2,321ms for the PPAs controls toggle, 902ms for a Schedule day tab,
 * 897ms for selecting a report. `loading.tsx` cannot cover any of it, because
 * route segment skeletons do not fire for search-param changes within the same
 * route -- so the six skeletons this app already has are unreachable from any
 * filter click.
 *
 * `startTransition` around `router.push` is what makes the navigation
 * interruptible and, more importantly here, observable: `isPending` stays true
 * until the server render has streamed back, which is exactly the interval
 * that was previously silent.
 */
export function useUrlState(basePath?: string) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const tracker = useContext(NavigationPendingContext);

  // Reports this control's pending state up to the layout indicator. Cleanup
  // runs if the component unmounts mid-navigation, which would otherwise leave
  // the bar running forever.
  useEffect(() => {
    if (!tracker) return;
    if (!isPending) return;
    tracker.begin();
    return () => tracker.end();
  }, [isPending, tracker]);

  /**
   * Mutate the current params and navigate. The callback receives a copy, so
   * every other param is preserved unless it is explicitly removed -- the
   * behaviour each call site was hand-rolling, and the reason filters survive
   * a view switch.
   */
  const setParams = useCallback(
    (mutate: (params: URLSearchParams) => void, options?: { scroll?: boolean }) => {
      const next = new URLSearchParams(searchParams.toString());
      mutate(next);
      const query = next.toString();
      const href = `${basePath ?? pathname}${query ? `?${query}` : ""}`;
      startTransition(() => router.push(href, { scroll: options?.scroll ?? true }));
    },
    [basePath, pathname, router, searchParams]
  );

  /** Convenience for the common single-key case. An empty value deletes. */
  const setParam = useCallback(
    (key: string, value: string, options?: { scroll?: boolean }) => {
      setParams((params) => {
        if (value) params.set(key, value);
        else params.delete(key);
      }, options);
    },
    [setParams]
  );

  return { isPending, setParam, setParams, searchParams };
}

/**
 * Class names for a region whose content is stale while a navigation is in
 * flight. Kept here rather than repeated at each call site so "pending" looks
 * the same everywhere.
 *
 * Deliberately a dim-and-wait rather than a skeleton: the previous content is
 * still correct for the previous query, and replacing a full table with grey
 * boxes for 900ms is more disruptive than fading it. `pointer-events-none`
 * stops a second click landing on rows that are about to be replaced.
 */
export const PENDING_REGION =
  "transition-opacity duration-150 opacity-50 pointer-events-none select-none";

export function pendingRegionClass(isPending: boolean): string {
  return isPending ? PENDING_REGION : "transition-opacity duration-150";
}
