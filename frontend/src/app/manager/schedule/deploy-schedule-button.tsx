"use client";

import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { deployLatestSchedule } from "@/actions/deploy-schedule";

export function DeployScheduleButton() {
  const [isPending, startTransition] = useTransition();

  return (
    <Button
      variant="outline"
      disabled={isPending}
      onClick={() => startTransition(() => deployLatestSchedule())}
    >
      {isPending ? "Deploying..." : "Deploy latest schedule"}
    </Button>
  );
}
