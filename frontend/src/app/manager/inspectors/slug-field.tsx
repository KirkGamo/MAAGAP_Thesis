"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { setInspectorSlug } from "@/actions/inspectors";

/**
 * Phase 12.1: assigns a real Inspector profile to one of
 * ml-service/optimization_engine.py's fixed synthetic roster slots
 * ("Inspector_1".."Inspector_6") -- this is the missing link
 * actions/deploy-schedule.ts needs to translate the PuLP solve's CSV
 * output into real inspector_schedules rows. Free-text rather than a
 * dropdown: the optimizer's INSPECTOR_COUNT could change, and hardcoding
 * "1..6" in two places (Python and here) would drift the moment one
 * changes without the other.
 */
export function SlugField({ profileId, slug }: { profileId: string; slug: string | null }) {
  const router = useRouter();
  const [value, setValue] = useState(slug ?? "");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSave() {
    setError(null);
    startTransition(async () => {
      const res = await setInspectorSlug(profileId, value);
      if (res.success) {
        router.refresh();
      } else {
        setError(res.error);
      }
    });
  }

  return (
    <div className="flex items-center gap-1.5">
      <Input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="e.g. Inspector_1"
        className="h-8 w-32 text-sm"
      />
      <Button size="sm" variant="outline" disabled={isPending} onClick={handleSave}>
        {isPending ? "Saving..." : "Save"}
      </Button>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </div>
  );
}
