"use client";

import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Show/hide for the PPAs filter sidebar, as client state rather than a server
 * round-trip.
 *
 * It used to be a `controls` URL param, for a stated reason: the sidebar is a
 * server-rendered sibling in page.tsx, not a child this button could reach.
 * The cost was not obvious until it was measured. `?controls=hidden` changes no
 * data -- it is a pure layout flag -- but pushing it re-ran the entire server
 * render, including the three-page facet pagination over 2,393 projects.
 * **2,321ms and three database queries to hide a sidebar**, with nothing on
 * screen in the meantime.
 *
 * The sidebar is now always rendered and hidden with CSS. That costs nothing:
 * the facet queries behind it were never conditional on this flag, so they ran
 * on every request regardless of whether the sidebar was shown. The only thing
 * the round-trip ever bought was omitting some DOM.
 *
 * The URL is still kept in sync, through `history.replaceState` rather than a
 * Next navigation, so the state survives a refresh and stays shareable without
 * costing a render. The server reads the same param to pick the initial value,
 * so the first paint matches the link that was opened.
 */
const ControlsVisibilityContext = createContext<{
  hidden: boolean;
  toggle: () => void;
} | null>(null);

export function ControlsVisibilityProvider({
  initiallyHidden,
  children,
}: {
  initiallyHidden: boolean;
  children: ReactNode;
}) {
  const [hidden, setHidden] = useState(initiallyHidden);

  const toggle = useCallback(() => {
    setHidden((prev) => {
      const next = !prev;
      // replaceState, not pushState: hiding a sidebar is not a navigation a
      // user expects the back button to undo, and not a step worth adding to
      // their history for every toggle.
      try {
        const url = new URL(window.location.href);
        if (next) url.searchParams.set("controls", "hidden");
        else url.searchParams.delete("controls");
        window.history.replaceState(null, "", url);
      } catch {
        // A failed URL sync must not stop the sidebar toggling; the only thing
        // lost is shareability of this one piece of state.
      }
      return next;
    });
  }, []);

  return (
    <ControlsVisibilityContext.Provider value={{ hidden, toggle }}>
      {children}
    </ControlsVisibilityContext.Provider>
  );
}

function useControlsVisibility() {
  const ctx = useContext(ControlsVisibilityContext);
  if (!ctx) {
    throw new Error("useControlsVisibility must be used inside ControlsVisibilityProvider");
  }
  return ctx;
}

/** Wraps the server-rendered sidebar so it can be hidden without a refetch. */
export function ControlsRegion({ children }: { children: ReactNode }) {
  const { hidden } = useControlsVisibility();
  return <div className={hidden ? "hidden" : "contents"}>{children}</div>;
}

export function PpaControlsToggle() {
  const { hidden, toggle } = useControlsVisibility();
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={toggle}
      className="shrink-0"
      aria-expanded={!hidden}
      aria-controls="ppa-filter-sidebar"
    >
      {hidden ? (
        <>
          <PanelLeftOpen className="size-4" aria-hidden="true" />
          Show Controls
        </>
      ) : (
        <>
          <PanelLeftClose className="size-4" aria-hidden="true" />
          Hide Controls
        </>
      )}
    </Button>
  );
}
