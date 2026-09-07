"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { inviteInspector } from "@/actions/inspectors";

/**
 * "Add inspector", using Supabase's email-invite Admin API (see
 * actions/inspectors.ts's inviteInspector -- the new Inspector sets
 * their own password via the emailed link, rather than a Manager
 * choosing a temporary one that then has to be relayed out-of-band).
 *
 * Now a slide-over rather than an inline expanding form: the roster page
 * is pinned to the viewport, so a form that grows in place would push
 * the slot grid out of the fixed layout. It also matches the Schedule
 * tab's Add-visit panel.
 *
 * The invite cannot bind an optimizer slot itself -- `profiles` only
 * exists after the person accepts and handle_new_user() fires -- so the
 * panel says where the slot gets assigned instead of implying it happens
 * here.
 */
export function InviteInspectorForm() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(false);
    startTransition(async () => {
      const res = await inviteInspector(email, fullName);
      if (res.success) {
        setSuccess(true);
        setEmail("");
        setFullName("");
        router.refresh();
      } else {
        setError(res.error);
      }
    });
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button>Add inspector</Button>
      </SheetTrigger>
      <SheetContent className="sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Add an inspector</SheetTitle>
          <SheetDescription>
            They receive an email invitation and set their own password.
          </SheetDescription>
        </SheetHeader>
        <SheetBody>
          <form onSubmit={handleSubmit} className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="invite_full_name">Full name</Label>
              <Input
                id="invite_full_name"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Juan Dela Cruz"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="invite_email">Email</Label>
              <Input
                id="invite_email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="inspector@ppdo.gov.ph"
              />
            </div>

            <p className="rounded-md border border-brand-navy/10 bg-brand-surface/60 p-2 text-[11px] leading-relaxed text-slate-500">
              Once they accept, they appear under &quot;No optimizer slot&quot; — assign them a slot
              there, or from any empty slot card, so deployed schedules can reach them.
            </p>

            <div className="flex gap-2">
              <Button type="submit" disabled={isPending}>
                {isPending ? "Sending invite..." : "Send invite"}
              </Button>
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                Cancel
              </Button>
            </div>

            {error && <p className="text-sm text-red-600">{error}</p>}
            {success && (
              <p className="text-sm text-emerald-700">
                Invite sent — they&apos;ll receive an email to set their password.
              </p>
            )}
          </form>
        </SheetBody>
      </SheetContent>
    </Sheet>
  );
}
