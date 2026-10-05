"use client";

import Image from "next/image";
import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * Shared login screen for both Manager and Inspector roles. After a
 * successful sign-in it redirects to "/", whose Server Component checks
 * the signed-in user's `profiles.role` and forwards to /manager or
 * /inspector accordingly — this page does not need to know about roles
 * itself.
 *
 * PHASE 2 of WEBSITE_REDESIGN_PLAN.md. This was a max-w-sm card centred on
 * grey: a form that could have belonged to any product, on the one screen
 * that exists to say whose system this is before anyone is inside it. The
 * logo was committed at public/maagap-logo.png and referenced nowhere.
 *
 * WHY THE LEFT PANEL IS NAVY. Measured against white, two of the four brand
 * colours fail WCAG AA for body text — Sky #099ED7 at 3.05:1 and Cyan
 * #6AD9F7 at 1.63:1 — so on a white page they can only ever be hairlines.
 * On navy they are 4.52:1 and 8.46:1. Navy as a *surface* is what lets the
 * brand appear in the product at all, and this page is the cheapest place to
 * prove that direction before the rest of the redesign depends on it.
 */
export default function LoginPage() {
  return (
    <main className="grid min-h-screen grid-rows-[auto_1fr] lg:grid-cols-[1.05fr_1fr] lg:grid-rows-1">
      <IdentityPanel />
      <section className="flex items-center justify-center bg-white px-6 py-10 sm:px-10">
        {/* useSearchParams() (inside LoginForm) requires a Suspense boundary
            around it in the App Router, since this route has no dynamic
            segment of its own and could otherwise be statically prerendered
            without access to the request's query string. */}
        <Suspense fallback={null}>
          <LoginForm />
        </Suspense>
      </section>
    </main>
  );
}

/**
 * The identity half. On a phone this collapses to a compact header band
 * rather than disappearing — the branding is the point of the screen, and a
 * field inspector signing in at a job site should still see whose system
 * they are entering.
 */
function IdentityPanel() {
  return (
    <aside className="flex flex-col justify-center gap-6 bg-surface-inverse px-6 py-8 sm:px-10 lg:gap-10 lg:px-14 lg:py-16">
      <div className="flex flex-col gap-4 lg:gap-6">
        <Image
          src="/maagap-logo.png"
          alt="MAAGAP"
          width={597}
          height={197}
          priority
          className="h-10 w-auto lg:h-16"
        />
        {/* Set in cyan-light rather than white on purpose: 10.25:1 on navy,
            and it is a brand colour that cannot carry text anywhere on the
            white half of this page (1.63:1 there). Measured, not assumed. */}
        <p className="max-w-md text-sm leading-relaxed font-medium text-surface-inverse-muted lg:text-base">
          Machine Analytics for Allocation, Governance and Assessment of Projects
        </p>
      </div>

      <div className="hidden max-w-md flex-col gap-5 lg:flex">
        <p className="text-lg leading-snug font-semibold text-surface-inverse-ink">
          Risk assessment and inspection scheduling for provincial projects.
        </p>
        <p className="text-sm leading-relaxed text-surface-inverse-muted">
          Used by the Provincial Planning and Development Office, Iloilo Province,
          to rank ongoing projects by delay risk and plan where inspectors go each
          week.
        </p>

        {/* Two roles sign in here and land in different places. Saying so
            costs two lines and saves the discovery. */}
        <dl className="flex flex-col gap-3 border-t border-white/15 pt-5 text-sm">
          <div className="flex gap-3">
            <dt className="w-24 shrink-0 font-semibold text-surface-inverse-ink">
              Managers
            </dt>
            <dd className="text-surface-inverse-muted">
              Review risk, run the optimizer, deploy weekly schedules
            </dd>
          </div>
          <div className="flex gap-3">
            <dt className="w-24 shrink-0 font-semibold text-surface-inverse-ink">
              Inspectors
            </dt>
            <dd className="text-surface-inverse-muted">
              File monitoring reports from the field
            </dd>
          </div>
        </dl>
      </div>
    </aside>
  );
}

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const supabase = createClient();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const wasDeactivated = searchParams.get("reason") === "deactivated";

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);

    const { error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    setIsSubmitting(false);

    if (signInError) {
      setError(signInError.message);
      return;
    }

    router.replace("/");
    router.refresh();
  }

  return (
    <div className="w-full max-w-sm">
      <div className="mb-8 flex flex-col gap-1.5">
        <h1 className="text-2xl font-semibold tracking-tight text-brand-navy">
          Sign in
        </h1>
        <p className="text-sm text-slate-500">
          Use the account issued to you by the Provincial Planning and Development
          Office.
        </p>
      </div>

      {wasDeactivated && (
        <p className="mb-6 rounded-md border-l-2 border-amber-500 bg-amber-50 px-3 py-2.5 text-sm text-amber-900">
          This account has been deactivated. Contact your Manager if you believe
          this is a mistake.
        </p>
      )}

      <form onSubmit={handleSubmit} className="flex flex-col gap-5">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>

        {error && (
          <p
            role="alert"
            className="rounded-md border-l-2 border-red-600 bg-red-50 px-3 py-2.5 text-sm text-red-800"
          >
            {error}
          </p>
        )}

        <Button type="submit" disabled={isSubmitting} className="mt-1 h-11">
          {isSubmitting ? "Signing in…" : "Sign in"}
        </Button>
      </form>
    </div>
  );
}
