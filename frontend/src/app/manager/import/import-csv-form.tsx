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
      <input
        type="file"
        accept=".csv"
        onChange={handleFileChange}
        className="text-sm file:mr-4 file:rounded-md file:border-0 file:bg-slate-900 file:px-3 file:py-2 file:text-sm file:font-medium file:text-slate-50"
      />
      {parseError && <p className="text-sm text-red-600">{parseError}</p>}
      {fileName && !parseError && (
        <p className="text-sm text-slate-600">
          Parsed {rows.length} row(s) from <span className="font-medium">{fileName}</span>.
        </p>
      )}
      {result && (
        <p className={`text-sm ${result.success ? "text-emerald-700" : "text-red-600"}`}>
          {result.message}
        </p>
      )}
      <Button
        onClick={handleImport}
        disabled={rows.length === 0 || isPending}
        className="w-fit"
      >
        {isPending ? "Importing..." : `Import ${rows.length || ""} row(s)`}
      </Button>
    </div>
  );
}
