import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { InviteInspectorForm } from "./invite-inspector-form";
import { ActiveToggle } from "./active-toggle";

/**
 * Phase 12: Inspectors tab. Lists every Inspector-role profile with an
 * activate/deactivate toggle and an "Add inspector" (email invite) action
 * — see actions/inspectors.ts for the two Supabase clients this uses and
 * why.
 *
 * Deliberately minimal fields (name, role, active), per the scope decided
 * before this phase: `profiles` has no contact-info/contract-dates/
 * capacity columns (unlike the attached Agents template), and some of
 * those (e.g. per-inspector capacity in minutes) have no source of truth
 * anywhere in the ML pipeline to populate them from. Email isn't shown
 * either — it lives on auth.users, not profiles, and surfacing it here
 * would need a second Admin API round trip for a field this tab doesn't
 * otherwise need.
 */
export default async function InspectorsPage() {
  const supabase = await createClient();

  const { data: inspectors, error } = await supabase
    .from("profiles")
    .select("id, full_name, active, created_at")
    .eq("role", "inspector")
    .order("full_name");

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-brand-navy">Inspectors</h1>
          <p className="text-sm text-slate-500">
            Manage who can sign in as a field inspector.
          </p>
        </div>
      </div>

      <InviteInspectorForm />

      <Card className="border-brand-navy/10 p-0">
        <CardHeader className="border-b border-brand-navy/10 px-5 py-4">
          <CardTitle>{inspectors?.length ?? 0} inspector(s)</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {error && <p className="p-5 text-sm text-red-600">{error.message}</p>}
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Joined</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(inspectors ?? []).map((inspector) => (
                <TableRow key={inspector.id}>
                  <TableCell className="font-medium text-slate-900">
                    {inspector.full_name ?? "Unnamed"}
                  </TableCell>
                  <TableCell>{new Date(inspector.created_at).toLocaleDateString()}</TableCell>
                  <TableCell>
                    <ActiveToggle profileId={inspector.id} active={inspector.active} />
                  </TableCell>
                </TableRow>
              ))}
              {(inspectors ?? []).length === 0 && (
                <TableRow>
                  <TableCell colSpan={3} className="text-center text-slate-400">
                    No inspectors yet — use &quot;Add inspector&quot; above.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
