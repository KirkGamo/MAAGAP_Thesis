"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { submitReport } from "@/actions/submit-report";
import { createClient } from "@/lib/supabase/client";
import type { ProjectStatus } from "@/types/database";

const STATUS_OPTIONS: { value: ProjectStatus; label: string }[] = [
  { value: "not_yet_implemented", label: "Not Yet Implemented" },
  { value: "for_bidding", label: "For Bidding" },
  { value: "on_going", label: "On-going" },
  { value: "completed", label: "Completed / Functional" },
];

const MONITORING_PHOTOS_BUCKET = "monitoring-photos";

type PhotoUploadState = {
  file: File;
  previewUrl: string;
  status: "pending" | "uploading" | "uploaded" | "error";
  /** Storage object path (e.g. "<uid>/<project_id>/<ts>-<uuid>.jpg"), NOT a
   * signed URL. `monitoring_reports.photo_urls` stores this path so the
   * Manager Portal can re-sign it fresh on every view (see
   * manager/backlog/[projectId]/page.tsx) rather than persisting a signed
   * URL that expires a fixed number of days after upload. */
  storagePath?: string;
  error?: string;
};

/** Mobile-first: large tap targets, single column, minimal required
 * fields — an inspector is filling this out standing at a job site, not
 * at a desk. */
export function ReportForm({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [statusObserved, setStatusObserved] = useState<ProjectStatus>("on_going");
  const [percentComplete, setPercentComplete] = useState("");
  const [remarks, setRemarks] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [photos, setPhotos] = useState<PhotoUploadState[]>([]);

  /**
   * Storage RLS (see supabase/storage_monitoring_photos.sql) requires every
   * object's path to be prefixed with the uploading Inspector's own
   * auth.uid() — "<uid>/<project_id>/<timestamp>-<filename>" — so an
   * Inspector can only ever write into their own folder. Uploads start the
   * moment a photo is captured/selected (not deferred to submit time) so the
   * Inspector sees per-photo upload progress/errors before hitting Submit,
   * and so a slow mobile connection uploads in the background while they
   * finish typing remarks.
   */
  async function handlePhotoCapture(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = ""; // allow re-selecting the same file again later
    if (files.length === 0) return;

    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      setError("You must be signed in to attach photos.");
      return;
    }

    const newEntries: PhotoUploadState[] = files.map((file) => ({
      file,
      previewUrl: URL.createObjectURL(file),
      status: "pending",
    }));
    setPhotos((prev) => [...prev, ...newEntries]);

    for (const entry of newEntries) {
      setPhotos((prev) =>
        prev.map((p) => (p === entry ? { ...p, status: "uploading" } : p))
      );

      const extension = entry.file.name.split(".").pop() ?? "jpg";
      const path = `${user.id}/${projectId}/${Date.now()}-${crypto.randomUUID()}.${extension}`;

      const { error: uploadError } = await supabase.storage
        .from(MONITORING_PHOTOS_BUCKET)
        .upload(path, entry.file, { contentType: entry.file.type });

      if (uploadError) {
        setPhotos((prev) =>
          prev.map((p) =>
            p === entry ? { ...p, status: "error", error: uploadError.message } : p
          )
        );
        continue;
      }

      // Store the storage *path*, not a signed URL — the bucket is private
      // (see storage_monitoring_photos.sql), and a signed URL minted now
      // would expire a fixed number of days after upload regardless of when
      // a Manager actually looks at it. The Manager Portal re-signs this
      // path fresh on every page load instead (see
      // manager/backlog/[projectId]/page.tsx). A short-lived signed URL is
      // still generated here purely for this form's own local photo preview.
      setPhotos((prev) =>
        prev.map((p) => (p === entry ? { ...p, status: "uploaded", storagePath: path } : p))
      );
    }
  }

  function removePhoto(entry: PhotoUploadState) {
    setPhotos((prev) => prev.filter((p) => p !== entry));
    URL.revokeObjectURL(entry.previewUrl);
  }

  const isUploadingPhotos = photos.some((p) => p.status === "uploading");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const photoUrls = photos
        .filter((p) => p.status === "uploaded" && p.storagePath)
        .map((p) => p.storagePath!);

      const res = await submitReport({
        projectId,
        statusObserved,
        percentComplete: percentComplete ? Number(percentComplete) : undefined,
        remarks: remarks || undefined,
        photoUrls: photoUrls.length > 0 ? photoUrls : undefined,
      });
      if (res.success) {
        router.replace("/inspector");
        router.refresh();
      } else {
        setError(res.error);
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-5">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="status_observed">Status observed</Label>
        <select
          id="status_observed"
          className="h-12 rounded-md border border-slate-200 bg-white px-3 text-base"
          value={statusObserved}
          onChange={(e) => setStatusObserved(e.target.value as ProjectStatus)}
        >
          {STATUS_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="percent_complete">% complete (optional)</Label>
        <Input
          id="percent_complete"
          type="number"
          min="0"
          max="100"
          inputMode="numeric"
          className="h-12 text-base"
          value={percentComplete}
          onChange={(e) => setPercentComplete(e.target.value)}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="remarks">Remarks</Label>
        <textarea
          id="remarks"
          rows={4}
          className="rounded-md border border-slate-200 bg-white px-3 py-2 text-base"
          placeholder="Anything the office should know about this visit..."
          value={remarks}
          onChange={(e) => setRemarks(e.target.value)}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="site_photo">Site photo (optional)</Label>
        {/* capture="environment" opens the rear/outward-facing camera
            directly on mobile, rather than the general file picker — the
            Inspector is standing at the site, not browsing an existing
            camera roll. */}
        <input
          id="site_photo"
          type="file"
          accept="image/*"
          capture="environment"
          multiple
          onChange={handlePhotoCapture}
          className="text-sm file:mr-3 file:h-10 file:rounded-md file:border-0 file:bg-brand-navy file:px-3 file:text-sm file:font-medium file:text-white"
        />

        {photos.length > 0 && (
          <div className="mt-2 grid grid-cols-3 gap-2">
            {photos.map((p, i) => (
              <div key={i} className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element -- local blob: preview, not an optimizable remote asset */}
                <img
                  src={p.previewUrl}
                  alt="Captured site photo"
                  className="h-20 w-full rounded-md border border-slate-200 object-cover"
                />
                <button
                  type="button"
                  onClick={() => removePhoto(p)}
                  className="absolute right-1 top-1 flex size-5 items-center justify-center rounded-full bg-black/60 text-xs text-white"
                  aria-label="Remove photo"
                >
                  ×
                </button>
                <p className="mt-0.5 truncate text-center text-[10px] text-slate-500">
                  {p.status === "uploading" && "Uploading..."}
                  {p.status === "uploaded" && "Uploaded"}
                  {p.status === "pending" && "Queued"}
                  {p.status === "error" && (p.error ?? "Upload failed")}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <Button
        type="submit"
        size="lg"
        disabled={isPending || isUploadingPhotos}
        className="w-full"
      >
        {isPending ? "Submitting..." : isUploadingPhotos ? "Uploading photos..." : "Submit report"}
      </Button>
    </form>
  );
}
