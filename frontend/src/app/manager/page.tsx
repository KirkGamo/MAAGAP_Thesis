import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { RiskTier } from "@/types/database";

const TIER_ORDER: RiskTier[] = ["Critical", "High", "Medium", "Low"];

const TIER_STYLES: Record<RiskTier, string> = {
  Critical: "border-red-200 bg-red-50 text-red-900",
  High: "border-orange-200 bg-orange-50 text-orange-900",
  Medium: "border-amber-200 bg-amber-50 text-amber-900",
  Low: "border-emerald-200 bg-emerald-50 text-emerald-900",
};

/**
 * Manager overview: a risk-tier summary of the live (ongoing) project
 * population, i.e. the same population `ml-service/optimization_engine.py`
 * scores. In production this reads directly from the `projects` table,
 * which a scheduled job/webhook keeps in sync with the ML service's
 * scoring output (see actions/submit-report.ts's module docstring for how
 * the feedback loop that ultimately refreshes these scores is wired).
 */
export default async function ManagerOverviewPage() {
  const supabase = await createClient();

  const { data: projects } = await supabase
    .from("projects")
    .select("risk_tier")
    .not("risk_tier", "is", null);

  const counts: Record<RiskTier, number> = { Critical: 0, High: 0, Medium: 0, Low: 0 };
  for (const row of projects ?? []) {
    const tier = row.risk_tier as RiskTier | null;
    if (tier) counts[tier] += 1;
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold text-brand-navy">Overview</h1>
        <p className="text-sm text-slate-500">
          Live risk distribution across currently ongoing PPDO projects.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {TIER_ORDER.map((tier) => (
          <Card key={tier} className={TIER_STYLES[tier]}>
            <CardHeader className="pb-2">
              <CardDescription className="text-inherit opacity-70">{tier}</CardDescription>
              <CardTitle className="text-3xl">{counts[tier]}</CardTitle>
            </CardHeader>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Next steps</CardTitle>
          <CardDescription>
            Use <span className="font-medium">Import Projects</span> to bring in new
            monitoring data, <span className="font-medium">Backlog</span> to review and
            filter every tracked project, and <span className="font-medium">Schedule</span>{" "}
            to deploy the latest PuLP-optimized inspector routes.
          </CardDescription>
        </CardHeader>
      </Card>
    </div>
  );
}
