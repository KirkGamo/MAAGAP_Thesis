"use client";

import { useState } from "react";
import { UploadCloud } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetTrigger,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetBody,
} from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ImportCsvForm } from "../import/import-csv-form";
import { ManualEntryForm } from "../import/manual-entry-form";

/**
 * Phase 19: replaces the old `<Link href="/manager/import">Import
 * Projects</Link>` full-page navigation with an in-place slide-out panel
 * (see components/ui/sheet.tsx), per the user's reference screenshot of an
 * "Add New Transaction" side panel -- importing no longer loses whatever
 * filters/page/view the Manager had open on the PPAs tab. Reuses the exact
 * same CSV/manual forms /manager/import already had (both Server Actions
 * already `revalidatePath("/manager/ppas")` on success -- see
 * actions/projects.ts -- so closing the panel shows the newly imported
 * rows without any extra plumbing here). The /manager/import route itself
 * is left in place as a direct-link fallback, not deleted.
 */
export function PpaImportPanel() {
  const [open, setOpen] = useState(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button>Import Projects</Button>
      </SheetTrigger>
      <SheetContent>
        <SheetHeader>
          <div className="flex items-center gap-2.5">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-brand-surface text-brand-blue">
              <UploadCloud className="size-4.5" aria-hidden="true" />
            </span>
            <SheetTitle>Import projects</SheetTitle>
          </div>
          <SheetDescription>
            CSV columns expected: project_key, name_of_project, location, municipality,
            amount_php, status, date_released. Re-uploading a file with the same
            project_key values updates those rows instead of duplicating them.
          </SheetDescription>
        </SheetHeader>
        <SheetBody>
          <Tabs defaultValue="csv">
            <TabsList className="w-full">
              <TabsTrigger value="csv" className="flex-1">
                CSV Upload
              </TabsTrigger>
              <TabsTrigger value="manual" className="flex-1">
                Manual Entry
              </TabsTrigger>
            </TabsList>
            <TabsContent value="csv" className="mt-5">
              <ImportCsvForm />
            </TabsContent>
            <TabsContent value="manual" className="mt-5">
              <ManualEntryForm />
            </TabsContent>
          </Tabs>
        </SheetBody>
      </SheetContent>
    </Sheet>
  );
}
