// CSV Import page for bulk data migration
// Based on design_guidelines.md enterprise SaaS patterns

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Upload, FileText, AlertCircle, CheckCircle, XCircle, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";

type EntityType = "accounts" | "contacts" | "leads" | "opportunities" | "activities";

interface ImportResult {
  total: number;
  success: number;
  failed: number;
  errors: Array<{
    row: number;
    error: string;
    data: any;
  }>;
}

export default function ImportPage() {
  const { toast } = useToast();
  const [entityType, setEntityType] = useState<EntityType>("accounts");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);

  const importMutation = useMutation({
    mutationFn: async ({ file, entity }: { file: File; entity: EntityType }) => {
      // Fetch CSRF token before making the import request
      const csrfRes = await fetch("/api/csrf-token", {
        credentials: "include",
      });
      
      if (!csrfRes.ok) {
        throw new Error("Failed to get CSRF token");
      }
      
      const { csrfToken } = await csrfRes.json();
      
      // Prepare FormData with file
      const formData = new FormData();
      formData.append("file", file);
      
      // Make import request with CSRF token in header
      const res = await fetch(`/api/import/${entity}`, {
        method: "POST",
        credentials: "include",
        headers: {
          "X-CSRF-Token": csrfToken,
        },
        body: formData,
      });
      
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || "Import failed");
      }
      
      return await res.json();
    },
    onSuccess: (data: ImportResult) => {
      setResult(data);
      if (data.failed === 0) {
        toast({ title: `Successfully imported ${data.success} records` });
      } else {
        toast({
          title: `Import completed with errors`,
          description: `${data.success} succeeded, ${data.failed} failed`,
          variant: "destructive",
        });
      }
    },
    onError: (error: Error) => {
      toast({ title: "Import failed", description: error.message, variant: "destructive" });
    },
  });

  const handleFileChange = (selectedFile: File | null) => {
    setFile(selectedFile);
    setResult(null);
    
    if (selectedFile) {
      const reader = new FileReader();
      reader.onload = (e) => {
        const text = e.target?.result as string;
        // Show first 5 lines as preview
        const lines = text.split("\n").slice(0, 6).join("\n");
        setPreview(lines);
      };
      reader.readAsText(selectedFile);
    } else {
      setPreview(null);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    
    const droppedFile = e.dataTransfer.files[0];
    if (droppedFile && droppedFile.name.endsWith(".csv")) {
      handleFileChange(droppedFile);
    } else {
      toast({ title: "Invalid file type", description: "Please upload a CSV file", variant: "destructive" });
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = () => {
    setIsDragOver(false);
  };

  const handleImport = () => {
    if (!file) {
      toast({ title: "No file selected", variant: "destructive" });
      return;
    }
    
    importMutation.mutate({ file, entity: entityType });
  };

  const downloadTemplate = () => {
    // Generate CSV template based on entity type
    let headers = "";
    switch (entityType) {
      case "accounts":
        headers = "id,name,type,industry,website,phone,billingAddress,shippingAddress";
        break;
      case "contacts":
        headers = "id,firstName,lastName,email,phone,title,accountId";
        break;
      case "leads":
        headers = "id,firstName,lastName,company,email,phone,topic,status,source,externalId,sourceSystem,sourceRecordId,importStatus,importNotes";
        break;
      case "opportunities":
        headers = "id,name,accountId,amount,stage,probability,closeDate";
        break;
      case "activities":
        headers = "id,type,subject,dueAt,completedAt,relatedType,relatedId,notes";
        break;
    }
    
    const blob = new Blob([headers + "\n"], { type: "text/csv" });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${entityType}-template.csv`;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);
    
    toast({ title: "Template downloaded" });
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold text-foreground">CSV Import</h1>
        <p className="text-muted-foreground">Bulk import data from CSV files</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Upload CSV File</CardTitle>
          <CardDescription>
            Select the entity type and upload a CSV file to import records
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-4">
            <div className="flex-1">
              <label className="text-sm font-medium mb-2 block">Entity Type</label>
              <Select value={entityType} onValueChange={(v) => setEntityType(v as EntityType)}>
                <SelectTrigger data-testid="select-entity-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="accounts">Accounts</SelectItem>
                  <SelectItem value="contacts">Contacts</SelectItem>
                  <SelectItem value="leads">Leads</SelectItem>
                  <SelectItem value="opportunities">Opportunities</SelectItem>
                  <SelectItem value="activities">Activities</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end">
              <Button variant="outline" onClick={downloadTemplate} data-testid="button-download-template">
                <Download className="h-4 w-4 mr-2" />
                Download Template
              </Button>
            </div>
          </div>

          <div
            className={`border-2 border-dashed rounded-md p-8 text-center transition-colors ${
              isDragOver ? "border-primary bg-accent/50" : "border-border"
            }`}
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            data-testid="dropzone-upload"
          >
            {file ? (
              <div className="flex flex-col items-center gap-2">
                <FileText className="h-12 w-12 text-primary" />
                <p className="font-medium">{file.name}</p>
                <p className="text-sm text-muted-foreground">{(file.size / 1024).toFixed(2)} KB</p>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleFileChange(null)}
                  data-testid="button-remove-file"
                >
                  Remove
                </Button>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-2">
                <Upload className="h-12 w-12 text-muted-foreground" />
                <p className="font-medium">Drag and drop CSV file here</p>
                <p className="text-sm text-muted-foreground">or</p>
                <Button variant="outline" asChild>
                  <label htmlFor="file-upload" className="cursor-pointer">
                    Browse Files
                    <input
                      id="file-upload"
                      type="file"
                      accept=".csv"
                      className="hidden"
                      onChange={(e) => handleFileChange(e.target.files?.[0] || null)}
                      data-testid="input-file-upload"
                    />
                  </label>
                </Button>
              </div>
            )}
          </div>

          {preview && (
            <div>
              <label className="text-sm font-medium mb-2 block">Preview (first 5 rows)</label>
              <pre className="bg-muted p-4 rounded-md text-sm overflow-x-auto" data-testid="preview-csv">
                {preview}
              </pre>
            </div>
          )}

          <div className="flex gap-2">
            <Button
              onClick={handleImport}
              disabled={!file || importMutation.isPending}
              data-testid="button-import"
            >
              {importMutation.isPending ? "Importing..." : "Import Data"}
            </Button>
            {file && !importMutation.isPending && (
              <Button
                variant="outline"
                onClick={() => {
                  setFile(null);
                  setPreview(null);
                  setResult(null);
                }}
                data-testid="button-reset"
              >
                Reset
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {result && (
        <Card>
          <CardHeader>
            <CardTitle>Import Results</CardTitle>
            <CardDescription>Summary of the import operation</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-3 gap-4">
              <div className="flex items-center gap-2">
                <FileText className="h-5 w-5 text-muted-foreground" />
                <div>
                  <p className="text-2xl font-semibold">{result.total}</p>
                  <p className="text-sm text-muted-foreground">Total Records</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <CheckCircle className="h-5 w-5 text-green-500" />
                <div>
                  <p className="text-2xl font-semibold text-green-500">{result.success}</p>
                  <p className="text-sm text-muted-foreground">Successful</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <XCircle className="h-5 w-5 text-red-500" />
                <div>
                  <p className="text-2xl font-semibold text-red-500">{result.failed}</p>
                  <p className="text-sm text-muted-foreground">Failed</p>
                </div>
              </div>
            </div>

            {result.failed > 0 && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>Import Errors</AlertTitle>
                <AlertDescription>
                  {result.failed} record(s) failed to import. See details below.
                </AlertDescription>
              </Alert>
            )}

            {result.errors.length > 0 && (
              <div>
                <h3 className="font-semibold mb-2">Error Details</h3>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Row</TableHead>
                      <TableHead>Error</TableHead>
                      <TableHead>Data</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {result.errors.map((error, idx) => (
                      <TableRow key={idx}>
                        <TableCell>
                          <Badge variant="destructive">{error.row}</Badge>
                        </TableCell>
                        <TableCell className="font-mono text-sm">{error.error}</TableCell>
                        <TableCell>
                          <pre className="text-xs overflow-x-auto max-w-md">
                            {JSON.stringify(error.data, null, 2)}
                          </pre>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Import Guidelines</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <ul className="list-disc list-inside space-y-1">
            <li>CSV file must have a header row with column names</li>
            <li><strong className="text-foreground">Custom IDs are preserved:</strong> If migrating from Dynamics 365 or other systems, include your existing IDs in the CSV to maintain references in downstream systems. Leave empty for auto-generation.</li>
            <li>Required fields must be filled (firstName, lastName for contacts/leads)</li>
            <li>Dates should be in ISO 8601 format (YYYY-MM-DD or YYYY-MM-DDTHH:mm:ss)</li>
            <li>For relationships, use the ID of the related record (e.g., accountId for contacts)</li>
            <li>All imported records will be assigned to you as the owner</li>
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
