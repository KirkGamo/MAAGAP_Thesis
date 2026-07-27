import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { MapLoader } from "./map-loader";
import type { MapProject } from "./types";

/**
 * Manager-facing spatial view of the ongoing project population — the
 * same population `ml-service/optimization_engine.py` scores for the
 * inspector deployment schedule (see /manager/schedule). Pins are
 * color-coded by the meta-learner's Chapter 3 risk tier.
 */
export default async function ProjectRiskMapPage() {
  const supabase = await createClient();

  const { data: projects, error } = await supabase
    .from("projects")
    .select("id, project_key, name_of_project, municipality, risk_tier, risk_probability")
    .eq("status", "on_going")
    .limit(1000);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold text-brand-navy">Risk Map</h1>
        <p className="text-sm text-slate-500">
          Ongoing projects plotted by municipality, color-coded by the meta-learner&apos;s
          predicted risk tier.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{projects?.length ?? 0} ongoing project(s)</CardTitle>
          <CardDescription>
            Green = Low &middot; Yellow = Medium &middot; Orange = High &middot; Red = Critical.
            Coordinates are approximate town-center placements (see
            src/lib/municipality-coordinates.ts) — verify against a surveyed source before
            using this for anything requiring precise geolocation.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {error && <p className="text-sm text-red-600">{error.message}</p>}
          <MapLoader projects={(projects as MapProject[]) ?? []} />
        </CardContent>
      </Card>
    </div>
  );
}
