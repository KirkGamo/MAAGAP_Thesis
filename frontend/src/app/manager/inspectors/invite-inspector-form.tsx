"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { inviteInspector } from "@/actions/inspectors";

/**
 * Phase 12: "Add inspector" flow, using Supabase's email-invite Admin API
 * (see actions/inspectors.ts's inviteInspector -- the new Inspector sets
 * their own password via the emailed link, rather than a Manager choosing
 * a temporary one that then has to be relayed out-of-band).
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

  if (!open) {
    return <Button onClick={() => setOpen(true)}>Add inspector</Button>;
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col gap-3 rounded-md border border-brand-navy/10 bg-white p-4 sm:flex-row sm:items-end"
    >
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
      <div className="flex gap-2">
        <Button type="submit" disabled={isPending}>
          {isPending ? "Sending invite..." : "Send invite"}
        </Button>
        <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
      {error && <p className="text-sm text-red-600 sm:basis-full">{error}</p>}
      {success && (
        <p className="text-sm text-emerald-700 sm:basis-full">
          Invite sent — they&apos;ll receive an email to set their password.
        </p>
      )}
    </form>
  );
}
