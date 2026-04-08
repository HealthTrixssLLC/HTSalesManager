import { useState, useCallback, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest, fetchCsrfToken } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import {
  FileText, FileImage, FileSpreadsheet, FileCode, File,
  Upload, Download, Trash2, Paperclip,
} from "lucide-react";
import { format } from "date-fns";

interface DocumentRecord {
  id: string;
  entityType: string;
  entityId: string;
  fileName: string;
  contentType: string;
  size: number;
  uploadedBy: string;
  uploaderName: string;
  createdAt: string;
}

interface DocumentsSectionProps {
  entityType: "lead" | "account" | "contact" | "opportunity";
  entityId: string;
  /** Override the default role-based edit permission check. If provided, this value takes precedence. */
  canEdit?: boolean;
}

function getFileIcon(contentType: string) {
  if (contentType.startsWith("image/")) return FileImage;
  if (contentType.includes("spreadsheet") || contentType.includes("excel") || contentType.includes("csv")) return FileSpreadsheet;
  if (contentType.includes("pdf") || contentType.includes("word") || contentType.includes("document") || contentType.includes("text")) return FileText;
  if (contentType.includes("json") || contentType.includes("xml") || contentType.includes("html") || contentType.includes("javascript")) return FileCode;
  return File;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatFileName(name: string, maxLen = 40): string {
  if (name.length <= maxLen) return name;
  const ext = name.lastIndexOf(".");
  if (ext > 0) {
    const extension = name.slice(ext);
    const base = name.slice(0, maxLen - extension.length - 3);
    return `${base}...${extension}`;
  }
  return `${name.slice(0, maxLen - 3)}...`;
}

export function DocumentsSection({ entityType, entityId, canEdit: canEditProp }: DocumentsSectionProps) {
  const { user } = useAuth();
  const userRoles = (user?.roles ?? []).map((r: { name: string }) => r.name);
  const roleBasedEdit = userRoles.some((r) => ["Admin", "SalesManager", "SalesRep"].includes(r));
  const canEdit = canEditProp !== undefined ? canEditProp : roleBasedEdit;
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [deleteDocId, setDeleteDocId] = useState<string | null>(null);

  const queryKey = ["/api/documents", entityType, entityId];

  const { data: documents = [], isLoading } = useQuery<DocumentRecord[]>({
    queryKey,
    queryFn: async () => {
      const res = await fetch(`/api/documents?entityType=${entityType}&entityId=${entityId}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch documents");
      return res.json();
    },
  });

  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const csrfToken = await fetchCsrfToken();
      const formData = new FormData();
      formData.append("file", file);
      formData.append("entityType", entityType);
      formData.append("entityId", entityId);
      const res = await fetch("/api/documents/upload", {
        method: "POST",
        body: formData,
        credentials: "include",
        headers: { "X-CSRF-Token": csrfToken },
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Upload failed" }));
        throw new Error(err.error || "Upload failed");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      toast({ title: "Document uploaded successfully" });
    },
    onError: (error: Error) => {
      toast({ title: "Upload failed", description: error.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("DELETE", `/api/documents/${id}`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Delete failed" }));
        throw new Error(err.error || "Delete failed");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      toast({ title: "Document deleted" });
      setDeleteDocId(null);
    },
    onError: (error: Error) => {
      toast({ title: "Delete failed", description: error.message, variant: "destructive" });
      setDeleteDocId(null);
    },
  });

  const handleFiles = useCallback((files: FileList | null) => {
    if (!files || files.length === 0) return;
    for (let i = 0; i < files.length; i++) {
      uploadMutation.mutate(files[i]);
    }
  }, [uploadMutation]);

  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };
  const onDragLeave = () => setIsDragging(false);
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    handleFiles(e.dataTransfer.files);
  };

  const handleDownload = (doc: DocumentRecord) => {
    const a = document.createElement("a");
    a.href = `/api/documents/${doc.id}/download`;
    a.download = doc.fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const docToDelete = documents.find((d) => d.id === deleteDocId);

  return (
    <Card data-testid="section-documents">
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
        <CardTitle className="flex items-center gap-2">
          <Paperclip className="h-4 w-4" />
          Documents
        </CardTitle>
        {canEdit && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploadMutation.isPending}
            data-testid="button-upload-document"
          >
            <Upload className="h-4 w-4 mr-1" />
            Upload
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => handleFiles(e.target.files)}
          data-testid="input-document-file"
        />

        {canEdit && (
          <div
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onDrop={onDrop}
            onClick={() => fileInputRef.current?.click()}
            className={`border-2 border-dashed rounded-md p-4 text-center cursor-pointer transition-colors ${
              isDragging
                ? "border-primary bg-primary/5"
                : "border-muted-foreground/30 hover:border-muted-foreground/60"
            }`}
            data-testid="dropzone-documents"
          >
            <Upload className="h-5 w-5 mx-auto mb-1 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              {uploadMutation.isPending ? "Uploading..." : "Drag & drop files here, or click to browse"}
            </p>
          </div>
        )}

        {isLoading ? (
          <div className="space-y-2">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : documents.length === 0 ? (
          <p className="text-sm text-muted-foreground py-2" data-testid="text-no-documents">
            No documents attached yet.
          </p>
        ) : (
          <div className="space-y-1">
            {documents.map((doc) => {
              const Icon = getFileIcon(doc.contentType);
              return (
                <div
                  key={doc.id}
                  className="flex items-center gap-2 p-2 rounded-md hover-elevate group"
                  data-testid={`document-item-${doc.id}`}
                >
                  <Icon className="h-5 w-5 shrink-0 text-muted-foreground" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate" title={doc.fileName} data-testid={`text-doc-name-${doc.id}`}>
                      {formatFileName(doc.fileName)}
                    </p>
                    <p className="text-xs text-muted-foreground" data-testid={`text-doc-meta-${doc.id}`}>
                      {formatFileSize(doc.size)} &middot; {doc.uploaderName} &middot;{" "}
                      {format(new Date(doc.createdAt), "MMM d, yyyy")}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleDownload(doc)}
                      title="Download"
                      data-testid={`button-download-doc-${doc.id}`}
                    >
                      <Download className="h-4 w-4" />
                    </Button>
                    {canEdit && (
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setDeleteDocId(doc.id)}
                        title="Delete"
                        data-testid={`button-delete-doc-${doc.id}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>

      <AlertDialog open={!!deleteDocId} onOpenChange={(open) => !open && setDeleteDocId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Document</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{docToDelete?.fileName}"? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteDocId && deleteMutation.mutate(deleteDocId)}
              className="bg-destructive text-destructive-foreground"
              data-testid="button-confirm-delete-doc"
            >
              {deleteMutation.isPending ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
