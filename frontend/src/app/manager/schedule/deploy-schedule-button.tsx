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
      onClick={() =>
        startTransition(() => {
          // startTransition's callback must return void; deployLatestSchedule()
          // resolves to a { success, ... } result we're not using here (no
          // toast/error surface wired up yet — see that action's TODOs), so
          // the promise is intentionally not returned/awaited.
          void deployLatestSchedule();
        })
      }
    >
      {isPending ? "Deploying..." : "Deploy latest schedule"}
    </Button>
  );
}
