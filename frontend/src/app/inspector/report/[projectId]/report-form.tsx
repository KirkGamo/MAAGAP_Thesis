"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
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

/** `datetime-local` wants local wall-clock time, not UTC -- toISOString()
 * would shift it (see lib/local-date.ts for the same trap on dates). */
function toLocalDateTimeValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

interface ReportDraft {
  statusObserved: ProjectStatus;
  remarks: string;
  visitedAt: string;
  awaitingSend?: boolean;
}

type PhotoUploadState = {
  file: File;
  previewUrl: string;
  status: "pending" | "uploading" | "uploaded" | "error";
  /** Storage object path (e.g. "<uid>/<project_id>/<ts>-<uuid>.jpg"), NOT a
   * signed URL. `monitoring_reports.photo_urls` stores this path so the
   * Manager Portal can re-sign it fresh on every view (see
   * manager/ppas/[projectId]/page.tsx) rather than persisting a signed
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
  const [remarks, setRemarks] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [photos, setPhotos] = useState<PhotoUploadState[]>([]);
  const [visitedAt, setVisitedAt] = useState(() => toLocalDateTimeValue(new Date()));
  const [isOffline, setIsOffline] = useState(false);
  /** A submit was attempted but couldn't complete (offline, or the
   * request failed). The notes are on the device and will be re-sent. */
  const [awaitingSend, setAwaitingSend] = useState(false);

  const draftKey = `maagap:report-draft:${projectId}`;

  /**
   * Field connectivity is the normal failure here, not the exception.
   * Everything typed is mirrored into localStorage on every keystroke so
   * a dropped connection, a backgrounded browser, or an accidental
   * navigation can't cost an inspector a site visit's worth of notes --
   * previously a failed submit left the form intact only until the page
   * was closed, and offline queuing was called out as deliberately
   * out of scope.
   */
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(draftKey);
      if (raw) {
        const draft = JSON.parse(raw) as Partial<ReportDraft>;
        /* eslint-disable react-hooks/set-state-in-effect -- restoring
           persisted notes on mount is a one-shot sync from an external
           store (localStorage), which cannot be read during render
           without breaking SSR hydration. Runs once per project; it
           cannot cascade. */
        if (draft.statusObserved) setStatusObserved(draft.statusObserved);
        if (draft.remarks) setRemarks(draft.remarks);
        if (draft.visitedAt) setVisitedAt(draft.visitedAt);
        if (draft.awaitingSend) setAwaitingSend(true);
        /* eslint-enable react-hooks/set-state-in-effect */
      }
    } catch {
      // A blocked or full localStorage must never stop a report being
      // filed -- the draft is a convenience, the submit is the job.
    }
  }, [draftKey]);

  useEffect(() => {
    const sync = () => setIsOffline(!navigator.onLine);
    sync();
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    return () => {
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
    };
  }, []);

  const saveDraft = useCallback(
    (draft: ReportDraft) => {
      try {
        window.localStorage.setItem(draftKey, JSON.stringify(draft));
      } catch {
        // see above
      }
    },
    [draftKey]
  );

  // Mirror every keystroke, so nothing typed is ever only in memory.
  useEffect(() => {
    saveDraft({ statusObserved, remarks, visitedAt, awaitingSend });
  }, [saveDraft, statusObserved, remarks, visitedAt, awaitingSend]);

  function clearDraft() {
    try {
      window.localStorage.removeItem(draftKey);
    } catch {
      // see above
    }
    setAwaitingSend(false);
  }

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
      // manager/ppas/[projectId]/page.tsx). A short-lived signed URL is
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

  const send = useCallback(() => {
    setError(null);
    startTransition(async () => {
      const photoUrls = photos
        .filter((p) => p.status === "uploaded" && p.storagePath)
        .map((p) => p.storagePath!);

      try {
        const res = await submitReport({
          projectId,
          statusObserved,
          remarks: remarks || undefined,
          photoUrls: photoUrls.length > 0 ? photoUrls : undefined,
          visitedAt: new Date(visitedAt).toISOString(),
        });
        if (res.success) {
          clearDraft();
          router.replace("/inspector");
          router.refresh();
        } else {
          // A rejection from the server is a real answer, not a lost
          // connection -- keep the notes but don't schedule a retry that
          // would just be rejected again.
          setError(res.error);
        }
      } catch {
        setAwaitingSend(true);
        setError(
          "Couldn't reach the office. Your report is saved on this phone and will send itself once you have signal."
        );
      }
    });
    // clearDraft/router are stable enough for this callback's purpose;
    // the values it closes over are the submitted ones.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photos, projectId, statusObserved, remarks, visitedAt, router]);

  // Auto-send once connectivity returns, so an inspector who submitted in
  // a dead spot doesn't have to remember to come back to this screen.
  // Driven by the browser's `online` event rather than by an effect
  // watching state: coming back into signal IS the trigger, and a ref
  // keeps the listener pointing at the current form values without
  // re-subscribing on every keystroke.
  const retryRef = useRef<() => void>(() => {});
  useEffect(() => {
    retryRef.current = () => {
      if (awaitingSend && !isPending) send();
    };
  });

  useEffect(() => {
    const onOnline = () => retryRef.current();
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, []);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (isOffline) {
      setAwaitingSend(true);
      setError(
        "You're offline. Your report is saved on this phone and will send itself once you have signal."
      );
      return;
    }
    send();
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-5">
      {(isOffline || awaitingSend) && (
        <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm leading-relaxed text-amber-800">
          {isOffline
            ? "You're offline. Everything you type is saved on this phone, and the report will send itself when you're back in signal."
            : "This report is waiting to send. It will go out automatically — leave this screen open if you can."}
        </p>
      )}

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="visited_at">Date and time of visit</Label>
        {/* Reports are often written up the next morning; visited_at
            anchors the observation in the LSTM's event sequence, so it
            must be the visit's time, not the typing time. */}
        <Input
          id="visited_at"
          type="datetime-local"
          className="h-12 text-base"
          max={toLocalDateTimeValue(new Date())}
          value={visitedAt}
          onChange={(e) => setVisitedAt(e.target.value)}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="status_observed">Status observed</Label>
        <select
          id="status_observed"
          className="h-12 rounded-md border border-brand-navy/10 bg-white px-3 text-base"
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

      {/* D16: the "% complete" field is deliberately gone. A percentage
          judged by eye at a site is an unvalidated subjective estimate --
          no rubric, no inter-rater check, and no way to audit it
          afterwards -- and it was never a model input anyway. The
          observed status above is the objective, verifiable primitive
          that feeds the model instead; see
          ml-service/data_pipeline/status_vocabulary.py. */}

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="remarks">Remarks</Label>
        <textarea
          id="remarks"
          rows={4}
          className="rounded-md border border-brand-navy/10 bg-white px-3 py-2 text-base"
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
