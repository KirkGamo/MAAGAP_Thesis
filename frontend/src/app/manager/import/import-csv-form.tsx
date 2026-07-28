"use client";

import { useState, useTransition } from "react";
import Papa from "papaparse";
import { Button } from "@/components/ui/button";
import { importProjectsCsv, type CsvProjectRow } from "@/actions/projects";

/**
 * Parses the uploaded CSV entirely in the browser (Papaparse) and sends
 * only the resulting typed rows to the `importProjectsCsv` Server Action —
 * the raw file itself is never uploaded, which keeps the server action
 * simple and lets parsing errors surface immediately, before any network
 * round-trip.
 */
export function ImportCsvForm() {
  const [fileName, setFileName] = useState<string | null>(null);
  const [rows, setRows] = useState<CsvProjectRow[]>([]);
  const [parseError, setParseError] = useState<string | null>(null);
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setResult(null);
    setParseError(null);

    Papa.parse<CsvProjectRow>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        if (results.errors.length > 0) {
          setParseError(results.errors[0].message);
          setRows([]);
          return;
        }
        setRows(results.data);
      },
      error: (err) => setParseError(err.message),
    });
  }

  function handleImport() {
    startTransition(async () => {
      const res = await importProjectsCsv(rows);
      setResult(
        res.success
          ? { success: true, message: `Imported/updated ${res.imported} project(s).` }
          : { success: false, message: res.error }
      );
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <label
        htmlFor="csv-file"
        className="flex cursor-pointer flex-col items-center gap-1.5 rounded-lg border border-dashed border-brand-navy/20 bg-brand-surface px-4 py-6 text-center transition-colors hover:border-brand-blue/40 hover:bg-brand-cyan-light/20"
      >
        <span className="text-sm font-medium text-brand-navy">
          {fileName ? "Choose a different CSV file" : "Click to choose a CSV file"}
        </span>
        <span className="text-xs text-slate-500">project_key, name_of_project, location, ...</span>
      </label>
      <input id="csv-file" type="file" accept=".csv" onChange={handleFileChange} className="sr-only" />

      {parseError && (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
          {parseError}
        </p>
      )}
      {fileName && !parseError && (
        <p className="rounded-md border border-brand-navy/10 bg-white px-3 py-2 text-sm text-slate-600">
          Parsed <span className="font-medium text-brand-navy">{rows.length}</span> row(s) from{" "}
          <span className="font-medium">{fileName}</span>.
        </p>
      )}
      {result && (
        <p
          className={`rounded-md border px-3 py-2 text-sm ${
            result.success
              ? "border-emerald-200 bg-emerald-50 text-emerald-700"
              : "border-red-200 bg-red-50 text-red-600"
          }`}
        >
          {result.message}
        </p>
      )}
      <Button onClick={handleImport} disabled={rows.length === 0 || isPending} className="w-fit">
        {isPending ? "Importing..." : `Import ${rows.length || ""} row(s)`}
      </Button>
    </div>
  );
}
