import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { FileText, Plus, Trash2, ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";

export type DocumentEntityType =
  | "candidate_account"
  | "candidate_contact"
  | "candidate_lead"
  | "lead"
  | "account"
  | "contact"
  | "opportunity";

export type DocumentType =
  | "company_overview"
  | "strategic_approach"
  | "contact_brief"
  | "communication_draft"
  | "manual_note";

export interface ResearchDocument {
  id: string;
  entityType: DocumentEntityType;
  entityId: string;
  documentType: DocumentType;
  title: string;
  content: string;
  sourceAgentPhase: string | null;
  runId: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

const DOCUMENT_TYPE_LABELS: Record<DocumentType, string> = {
  company_overview: "Company Overview",
  strategic_approach: "Strategic Approach",
  contact_brief: "Contact Brief",
  communication_draft: "Communication Draft",
  manual_note: "Manual Note",
};

const DOCUMENT_TYPE_COLORS: Record<DocumentType, string> = {
  company_overview: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300",
  strategic_approach: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300",
  contact_brief: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300",
  communication_draft: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
  manual_note: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
};

interface Props {
  entityType: DocumentEntityType;
  entityId: string;
  canManage?: boolean;
  className?: string;
  "data-testid"?: string;
}

export function ResearchDocumentsPanel({ entityType, entityId, canManage = true, className, "data-testid": dataTestId }: Props) {
  const { toast } = useToast();
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [addOpen, setAddOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [form, setForm] = useState({
    documentType: "manual_note" as DocumentType,
    title: "",
    content: "",
  });

  const { data: documents = [], isLoading } = useQuery<ResearchDocument[]>({
    queryKey: ["/api/research-documents", entityType, entityId],
    queryFn: async () => {
      const res = await fetch(`/api/research-documents?entityType=${entityType}&entityId=${entityId}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load documents");
      return res.json();
    },
    enabled: !!entityId,
  });

  const addMutation = useMutation({
    mutationFn: async (data: typeof form) => {
      const res = await apiRequest("POST", "/api/research-documents", {
        ...data,
        entityType,
        entityId,
      });
      return await res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/research-documents", entityType, entityId] });
      toast({ title: "Document added" });
      setAddOpen(false);
      setForm({ documentType: "manual_note", title: "", content: "" });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to add document", description: err.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("DELETE", `/api/research-documents/${id}`);
      return await res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/research-documents", entityType, entityId] });
      toast({ title: "Document deleted" });
      setDeleteId(null);
    },
    onError: (err: Error) => {
      toast({ title: "Failed to delete document", description: err.message, variant: "destructive" });
    },
  });

  const toggleExpand = (id: string) => {
    setExpanded(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const grouped = documents.reduce<Record<DocumentType, ResearchDocument[]>>((acc, doc) => {
    const key = doc.documentType;
    if (!acc[key]) acc[key] = [];
    acc[key].push(doc);
    return acc;
  }, {} as Record<DocumentType, ResearchDocument[]>);

  const orderedTypes: DocumentType[] = ["company_overview", "strategic_approach", "contact_brief", "communication_draft", "manual_note"];

  return (
    <Card className={className} data-testid={dataTestId}>
      <CardHeader className="flex flex-row items-center justify-between gap-2 pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <FileText className="w-4 h-4" />
          Research &amp; Intelligence
          {documents.length > 0 && (
            <Badge variant="secondary" className="ml-1" data-testid="research-docs-count">
              {documents.length}
            </Badge>
          )}
        </CardTitle>
        {canManage && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => setAddOpen(true)}
            data-testid="button-add-research-doc"
          >
            <Plus className="w-3 h-3 mr-1" />
            Add Note
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading documents...</p>
        ) : documents.length === 0 ? (
          <p className="text-sm text-muted-foreground" data-testid="research-docs-empty">
            No research documents attached.
          </p>
        ) : (
          <div className="space-y-4">
            {orderedTypes.map(type => {
              const docs = grouped[type];
              if (!docs || docs.length === 0) return null;
              return (
                <div key={type}>
                  <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                    {DOCUMENT_TYPE_LABELS[type]}
                  </h4>
                  <div className="space-y-2">
                    {docs.map(doc => {
                      const isExpanded = expanded[doc.id];
                      return (
                        <div
                          key={doc.id}
                          className="border rounded-md"
                          data-testid={`research-doc-${doc.id}`}
                        >
                          <div className="flex items-start justify-between gap-2 p-3">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap mb-1">
                                <span
                                  className={`text-xs font-medium px-2 py-0.5 rounded-full ${DOCUMENT_TYPE_COLORS[doc.documentType]}`}
                                  data-testid={`doc-type-badge-${doc.id}`}
                                >
                                  {DOCUMENT_TYPE_LABELS[doc.documentType]}
                                </span>
                                {doc.sourceAgentPhase && (
                                  <span className="text-xs text-muted-foreground">
                                    via {doc.sourceAgentPhase}
                                  </span>
                                )}
                                <span className="text-xs text-muted-foreground">
                                  {new Date(doc.createdAt).toLocaleDateString()}
                                </span>
                              </div>
                              <p className="text-sm font-medium truncate" data-testid={`doc-title-${doc.id}`}>
                                {doc.title}
                              </p>
                              {isExpanded && (
                                <p
                                  className="text-sm text-muted-foreground mt-2 whitespace-pre-wrap"
                                  data-testid={`doc-content-${doc.id}`}
                                >
                                  {doc.content}
                                </p>
                              )}
                            </div>
                            <div className="flex items-center gap-1 flex-shrink-0">
                              <Button
                                size="icon"
                                variant="ghost"
                                onClick={() => toggleExpand(doc.id)}
                                data-testid={`button-toggle-doc-${doc.id}`}
                                title={isExpanded ? "Collapse" : "Expand"}
                              >
                                {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                              </Button>
                              {canManage && (
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  onClick={() => setDeleteId(doc.id)}
                                  data-testid={`button-delete-doc-${doc.id}`}
                                  title="Delete document"
                                >
                                  <Trash2 className="w-4 h-4 text-destructive" />
                                </Button>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Manual Note</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1">
              <Label htmlFor="doc-type">Document Type</Label>
              <Select
                value={form.documentType}
                onValueChange={v => setForm(f => ({ ...f, documentType: v as DocumentType }))}
              >
                <SelectTrigger id="doc-type" data-testid="select-doc-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {orderedTypes.map(t => (
                    <SelectItem key={t} value={t}>{DOCUMENT_TYPE_LABELS[t]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="doc-title">Title</Label>
              <Input
                id="doc-title"
                value={form.title}
                onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                placeholder="Document title"
                data-testid="input-doc-title"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="doc-content">Content</Label>
              <Textarea
                id="doc-content"
                value={form.content}
                onChange={e => setForm(f => ({ ...f, content: e.target.value }))}
                placeholder="Enter document content..."
                rows={6}
                data-testid="input-doc-content"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>Cancel</Button>
            <Button
              onClick={() => addMutation.mutate(form)}
              disabled={!form.title.trim() || !form.content.trim() || addMutation.isPending}
              data-testid="button-save-research-doc"
            >
              {addMutation.isPending ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteId} onOpenChange={open => !open && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Document</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this document? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteId && deleteMutation.mutate(deleteId)}
              data-testid="button-confirm-delete-doc"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
