import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ImportCsvForm } from "./import-csv-form";
import { ManualEntryForm } from "./manual-entry-form";

export default function ImportProjectsPage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Import Projects</h1>
        <p className="text-sm text-slate-500">
          Bring new PPDO monitoring data into MAAGAP via a consolidated CSV export, or
          add a single project by hand.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Add projects</CardTitle>
          <CardDescription>
            CSV columns expected: project_key, name_of_project, location, municipality,
            amount_php, status, date_released. Re-uploading a file with the same
            project_key values updates those rows instead of duplicating them.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="csv">
            <TabsList>
              <TabsTrigger value="csv">CSV Upload</TabsTrigger>
              <TabsTrigger value="manual">Manual Entry</TabsTrigger>
            </TabsList>
            <TabsContent value="csv">
              <ImportCsvForm />
            </TabsContent>
            <TabsContent value="manual">
              <ManualEntryForm />
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}
