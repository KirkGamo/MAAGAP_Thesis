"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Phase 21: hides the filter sidebar entirely and lets the table/map take
 * the full row width -- for a Manager who's already set their filters and
 * just wants to see more columns/more of the map without the sidebar
 * eating ~256px, per a reference dashboard's "Hide Controls"/"Show
 * Controls" toggle. Backed by a `controls` URL param (like `view`, not a
 * filter) rather than local component state, since the sidebar it hides
 * is a server-rendered sibling in page.tsx, not a child this component
 * could reach via props/context.
 */
export function PpaControlsToggle() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const hidden = searchParams.get("controls") === "hidden";

  function toggle() {
    const next = new URLSearchParams(searchParams.toString());
    if (hidden) next.delete("controls");
    else next.set("controls", "hidden");
    router.push(`/manager/ppas?${next.toString()}`);
  }

  return (
    <Button type="button" variant="outline" size="sm" onClick={toggle} className="shrink-0">
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
