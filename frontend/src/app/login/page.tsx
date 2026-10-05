"use client";

import Image from "next/image";
import { ClipboardCheck, LayoutDashboard } from "lucide-react";
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
    <main className="grid min-h-screen grid-rows-[auto_1fr] lg:grid-cols-[1.3fr_1fr] lg:grid-rows-1">
      <IdentityPanel />
      <section className="flex items-center justify-center bg-white px-6 py-10 sm:px-12">
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
    <aside className="flex flex-col overflow-hidden bg-surface-inverse px-6 py-8 sm:px-10 lg:px-14 lg:py-12">
      {/* Text above, map below.
          
          Earlier passes put the two side by side and spent three rounds
          policing the boundary with offsets — first a percentage, which drifts
          against a fixed-width text column, then a measured 29.5rem. Stacking
          removes the overlap by construction instead: the map is a flex sibling
          that takes the height the text does not use, so it cannot encroach on
          the type at any width, and it gets the panel's full width rather than
          a ~370px gutter. */}
      <div className="flex w-full max-w-md shrink-0 flex-col gap-6">
        <div className="flex flex-col gap-3">
          {/* Three defects were measured in the committed logo on this panel:
              a pure-white field with no alpha (it rendered as a white box), a
              darkest ink of #242367 against this #242467 ground that made the
              leading "M" invisible, and a 3.03:1 canvas around 4.84:1 artwork.
              This file is the artwork cropped to its bounding box with only the
              inks failing 3:1 lifted to white.

              self-start is load-bearing: as a flex child, align-items: stretch
              forced this to the container width while the height class pinned
              it, rendering the wordmark at 11.20:1. w-auto cannot beat stretch;
              align-self can. */}
          <Image
            src="/maagap-logo-reversed.png"
            alt="MAAGAP"
            width={552}
            height={114}
            priority
            className="h-8 w-auto self-start lg:h-11"
          />
          <p className="max-w-xs text-[11px] leading-relaxed font-medium tracking-[0.08em] text-surface-inverse-muted uppercase lg:text-xs">
            Machine Analytics for Allocation, Governance and Assessment of Projects
          </p>
        </div>

        <div className="hidden flex-col gap-5 lg:flex">
          <h2 className="text-[2.35rem] leading-[1.08] font-semibold tracking-[-0.015em] text-balance text-surface-inverse-ink">
            Risk assessment and inspection scheduling for provincial projects.
          </h2>
          <p className="max-w-sm text-[15px] leading-relaxed text-surface-inverse-muted">
            Ongoing projects are ranked by delay risk, and each week&apos;s
            inspector assignments are planned against that ranking.
          </p>

          {/* Two roles sign in here and land in different places. Saying so
              costs two lines and saves the discovery. */}
          <dl className="flex flex-col gap-4 border-t border-white/12 pt-5 text-[15px]">
            <div className="flex items-start gap-3">
              <LayoutDashboard
                className="mt-0.5 size-[18px] shrink-0 text-surface-inverse-accent"
                aria-hidden="true"
              />
              <div className="flex flex-col gap-0.5">
                <dt className="font-semibold text-surface-inverse-ink">Managers</dt>
                <dd className="text-surface-inverse-muted">
                  Review risk, run the optimizer, deploy weekly schedules
                </dd>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <ClipboardCheck
                className="mt-0.5 size-[18px] shrink-0 text-surface-inverse-accent"
                aria-hidden="true"
              />
              <div className="flex flex-col gap-0.5">
                <dt className="font-semibold text-surface-inverse-ink">Inspectors</dt>
                <dd className="text-surface-inverse-muted">
                  File monitoring reports from the field
                </dd>
              </div>
            </div>
          </dl>
        </div>
      </div>

      {/* The province, drawn from the data the system runs on: all 1,342
          barangay points in PPDO's LMB layer, with the 43 municipality
          centroids picked out brighter — the same centroids the optimizer uses
          to cost travel between clusters. North up, with a cos(latitude)
          correction (0.981 here) so the shape is not stretched east-west.

          The band is flex-1 and always rendered, so it both carries the map
          and pins the footer to the foot of the panel. An earlier attempt gave
          the footer mt-auto for that job, which silently starved this: auto
          margins are resolved before flex-grow, so the footer took the free
          space and the band collapsed to 86px at 762px tall — small enough that
          the map was gated off as unreadable, treating the symptom.

          Sized to 145% of the band
          so it fills that height rather than being fitted inside it — at
          bg-contain a square map in a wide band is sized by the band's height
          and leaves most of the width empty. The band clips the overspill, and
          anchoring right balances the left-aligned text above it. */}
      <div
        aria-hidden="true"
        className="relative mt-6 hidden min-h-0 flex-1 overflow-hidden lg:block"
      >
        <div className="absolute inset-x-[-3.5rem] inset-y-0 bg-[url('/iloilo-points.svg')] bg-[length:115%_auto] bg-[position:center_42%] bg-no-repeat opacity-95" />
      </div>

      <p className="hidden shrink-0 pt-8 text-xs leading-relaxed text-surface-inverse-muted lg:block">
        Provincial Planning and Development Office
        <br />
        Provincial Government of Iloilo
      </p>
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
    <div className="w-full max-w-[26rem]">
      {/* The mark repeats here only below lg, where the navy panel has
          collapsed to a band and would otherwise be the only thing carrying
          the identity above a bare form. */}
      <div className="mb-6 flex flex-col gap-2">
        <h1 className="text-[2rem] leading-tight font-semibold tracking-tight text-brand-navy">
          Sign in
        </h1>
        <p className="text-sm leading-relaxed text-slate-500">
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

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="email">Work email</Label>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            required
            className="h-11"
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
            className="h-11"
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

        <Button type="submit" disabled={isSubmitting} className="mt-2 h-11 text-[15px]">
          {isSubmitting ? "Signing in…" : "Sign in"}
        </Button>
      </form>

      {/* Closes the block rather than leaving the button as a loose bottom
          edge, and answers the one question a failed sign-in actually raises.
          Matches the wording of the deactivated-account notice above, which
          already tells people to contact their Manager. */}
      <p className="mt-6 border-t border-border-subtle pt-4 text-xs leading-relaxed text-slate-500">
        Accounts are issued and deactivated by your Manager. If you cannot sign
        in, contact them rather than creating a second account.
      </p>
    </div>
  );
}
