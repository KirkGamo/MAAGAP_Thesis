"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createProject } from "@/actions/projects";
import type { ProjectStatus } from "@/types/database";

const STATUS_OPTIONS: { value: ProjectStatus; label: string }[] = [
  { value: "not_yet_implemented", label: "Not Yet Implemented" },
  { value: "for_bidding", label: "For Bidding" },
  { value: "on_going", label: "On-going" },
  { value: "completed", label: "Completed / Functional" },
];

const emptyForm = {
  project_key: "",
  name_of_project: "",
  location: "",
  municipality: "",
  amount_php: "",
  status: "not_yet_implemented" as ProjectStatus,
  date_released: "",
};

export function ManualEntryForm() {
  const [form, setForm] = useState(emptyForm);
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const res = await createProject({
        project_key: form.project_key,
        name_of_project: form.name_of_project,
        location: form.location,
        municipality: form.municipality || undefined,
        amount_php: form.amount_php ? Number(form.amount_php) : undefined,
        status: form.status,
        date_released: form.date_released || undefined,
      });
      if (res.success) {
        setResult({ success: true, message: `Project ${form.project_key} created.` });
        setForm(emptyForm);
      } else {
        setResult({ success: false, message: res.error });
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="grid max-w-xl grid-cols-1 gap-4 sm:grid-cols-2">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="project_key">Project Key</Label>
        <Input
          id="project_key"
          required
          placeholder="PRJ_10234"
          value={form.project_key}
          onChange={(e) => setForm((f) => ({ ...f, project_key: e.target.value }))}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="status">Status</Label>
        <select
          id="status"
          className="h-10 rounded-md border border-brand-navy/10 bg-white px-3 text-sm"
          value={form.status}
          onChange={(e) => setForm((f) => ({ ...f, status: e.target.value as ProjectStatus }))}
        >
          {STATUS_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>
      <div className="col-span-full flex flex-col gap-1.5">
        <Label htmlFor="name_of_project">Name of Project</Label>
        <Input
          id="name_of_project"
          required
          value={form.name_of_project}
          onChange={(e) => setForm((f) => ({ ...f, name_of_project: e.target.value }))}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="location">Location</Label>
        <Input
          id="location"
          required
          placeholder="Brgy. San Juan, Barotac Viejo"
          value={form.location}
          onChange={(e) => setForm((f) => ({ ...f, location: e.target.value }))}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="municipality">Municipality</Label>
        <Input
          id="municipality"
          value={form.municipality}
          onChange={(e) => setForm((f) => ({ ...f, municipality: e.target.value }))}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="amount_php">Amount (PHP)</Label>
        <Input
          id="amount_php"
          type="number"
          min="0"
          step="0.01"
          value={form.amount_php}
          onChange={(e) => setForm((f) => ({ ...f, amount_php: e.target.value }))}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="date_released">Date Released</Label>
        <Input
          id="date_released"
          type="date"
          value={form.date_released}
          onChange={(e) => setForm((f) => ({ ...f, date_released: e.target.value }))}
        />
      </div>

      {result && (
        <p className={`col-span-full text-sm ${result.success ? "text-emerald-700" : "text-red-600"}`}>
          {result.message}
        </p>
      )}
      <Button type="submit" disabled={isPending} className="col-span-full w-fit">
        {isPending ? "Saving..." : "Create project"}
      </Button>
    </form>
  );
}
