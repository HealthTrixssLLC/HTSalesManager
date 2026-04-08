import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Loader2, CheckCircle, XCircle, Clock, ChevronDown, ChevronUp, AlertTriangle, ExternalLink, FileText } from "lucide-react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import type { LeadGenerationRun, IcpProfile, User } from "@shared/schema";

interface ResearchDocument {
  id: string;
  documentType: string;
  title: string;
  content: string;
  sourceAgentPhase: string | null;
}

interface DuplicateMatch {
  type: string;
  id: string;
  name: string;
  matchedOn: string;
}

interface CandidateRow {
  id: string;
  status: string;
  tier: string | null;
  duplicateClass: string;
  verificationStatus: string;
  runId: string;
  candidateAccountId: string | null;
  candidateContactId: string | null;
  accountName?: string;
  contactName?: string;
  contactTitle?: string;
  score?: { totalScore: number; maxScore: number } | null;
  runName?: string;
  createdAt: string;
}

const statusColors: Record<string, string> = {
  pending_review: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
  approved: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300",
  rejected: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300",
  deferred: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
};

const duplicateColors: Record<string, string> = {
  unique: "bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-400",
  possible_duplicate: "bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-400",
  confirmed_duplicate: "bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400",
};

const DOCUMENT_TYPE_LABELS: Record<string, string> = {
  company_overview: "Company Overview",
  strategic_approach: "Strategic Approach",
  contact_brief: "Contact Brief",
  communication_draft: "Communication Draft",
  manual_note: "Manual Note",
};

const DOCUMENT_TYPE_COLORS: Record<string, string> = {
  company_overview: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300",
  strategic_approach: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300",
  contact_brief: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300",
  communication_draft: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
  manual_note: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
};

function IcpFitScore({ score }: { score: { totalScore: number; maxScore: number } | null | undefined }) {
  if (!score) return <span className="text-muted-foreground text-xs">—</span>;
  const pct = score.maxScore > 0 ? Math.round((score.totalScore / score.maxScore) * 100) : 0;
  const color = pct >= 70 ? "text-green-600 dark:text-green-400" : pct >= 40 ? "text-amber-600 dark:text-amber-400" : "text-red-600 dark:text-red-400";
  return (
    <div className="flex items-center gap-1.5" data-testid="icp-fit-score">
      <span className={`text-sm font-bold ${color}`}>{pct}%</span>
      <span className="text-xs text-muted-foreground">({score.totalScore}/{score.maxScore})</span>
    </div>
  );
}

function DuplicateWarningBadge({ duplicateClass, candidateId }: { duplicateClass: string; candidateId: string }) {
  const { data: dupCheck } = useQuery<{ matches: DuplicateMatch[] }>({
    queryKey: ["/api/lead-gen/candidates", candidateId, "duplicate-check"],
    queryFn: async () => {
      const res = await fetch(`/api/lead-gen/candidates/${candidateId}/duplicate-check`, { credentials: "include" });
      if (!res.ok) return { matches: [] };
      return res.json();
    },
    enabled: duplicateClass !== "unique",
  });

  if (duplicateClass === "unique") return null;

  const matchCount = dupCheck?.matches?.length ?? 0;
  return (
    <div className="flex items-center gap-1" data-testid={`duplicate-warning-${candidateId}`}>
      <AlertTriangle className={`h-3.5 w-3.5 ${duplicateClass === "confirmed_duplicate" ? "text-red-600" : "text-amber-500"}`} />
      <span className={`text-xs font-medium px-1.5 py-0.5 rounded ${duplicateColors[duplicateClass]}`}>
        {duplicateClass.replace(/_/g, " ")}
        {matchCount > 0 && ` (${matchCount} match${matchCount > 1 ? "es" : ""})`}
      </span>
    </div>
  );
}

function ResearchDocsSummary({ candidateAccountId, candidateContactId, candidateLeadId }: {
  candidateAccountId: string | null;
  candidateContactId: string | null;
  candidateLeadId: string;
}) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const queries = [
    candidateAccountId ? { key: `candidate_account:${candidateAccountId}`, entityType: "candidate_account", entityId: candidateAccountId } : null,
    candidateContactId ? { key: `candidate_contact:${candidateContactId}`, entityType: "candidate_contact", entityId: candidateContactId } : null,
    { key: `candidate_lead:${candidateLeadId}`, entityType: "candidate_lead", entityId: candidateLeadId },
  ].filter(Boolean) as Array<{ key: string; entityType: string; entityId: string }>;

  const { data: allDocs = [] } = useQuery<ResearchDocument[]>({
    queryKey: ["/api/research-documents/bulk", candidateAccountId, candidateContactId, candidateLeadId],
    queryFn: async () => {
      const results = await Promise.all(
        queries.map(q =>
          fetch(`/api/research-documents?entityType=${q.entityType}&entityId=${q.entityId}`, { credentials: "include" })
            .then(r => r.ok ? r.json() : [])
        )
      );
      return (results as ResearchDocument[][]).flat();
    },
    enabled: !!candidateLeadId,
  });

  if (allDocs.length === 0) return null;

  const priorityTypes = ["company_overview", "strategic_approach", "contact_brief", "communication_draft"];
  const relevantDocs = allDocs.filter(d => priorityTypes.includes(d.documentType));

  if (relevantDocs.length === 0) return null;

  return (
    <div className="mt-3 space-y-2">
      <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <FileText className="h-3 w-3" />
        Research Documents ({relevantDocs.length})
      </div>
      <div className="space-y-1.5">
        {relevantDocs.slice(0, 4).map(doc => {
          const isExp = expanded[doc.id];
          return (
            <div key={doc.id} className="border rounded-md bg-muted/30" data-testid={`inline-doc-${doc.id}`}>
              <button
                className="w-full flex items-center justify-between gap-2 px-3 py-2 text-left"
                onClick={() => setExpanded(prev => ({ ...prev, [doc.id]: !prev[doc.id] }))}
                data-testid={`toggle-doc-${doc.id}`}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span className={`text-xs font-medium px-1.5 py-0.5 rounded shrink-0 ${DOCUMENT_TYPE_COLORS[doc.documentType] ?? "bg-gray-100 text-gray-600"}`}>
                    {DOCUMENT_TYPE_LABELS[doc.documentType] ?? doc.documentType}
                  </span>
                  <span className="text-xs text-foreground truncate">{doc.title}</span>
                </div>
                {isExp ? <ChevronUp className="h-3.5 w-3.5 shrink-0 text-muted-foreground" /> : <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
              </button>
              {isExp && (
                <div className="px-3 pb-2 text-xs text-muted-foreground whitespace-pre-wrap border-t pt-2" data-testid={`doc-content-inline-${doc.id}`}>
                  {doc.content.length > 500 ? doc.content.slice(0, 500) + "…" : doc.content}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

interface IndividualActionProps {
  candidateId: string;
  isPendingReview: boolean;
  canDecide: boolean;
  onActionComplete: () => void;
}

function IndividualActions({ candidateId, isPendingReview, canDecide, onActionComplete }: IndividualActionProps) {
  const { toast } = useToast();
  const [actionDialog, setActionDialog] = useState<"approve" | "reject" | "defer" | null>(null);
  const [note, setNote] = useState("");

  const actionMutation = useMutation({
    mutationFn: async ({ action, note: n }: { action: string; note: string }) => {
      const res = await apiRequest("POST", `/api/lead-gen/candidates/${candidateId}/${action}`, { note: n });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Action failed");
      }
      return await res.json();
    },
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ["/api/lead-gen/candidates"] });
      queryClient.invalidateQueries({ queryKey: ["/api/lead-gen/dashboard"] });
      toast({ title: `Candidate ${vars.action}ed` });
      setActionDialog(null);
      setNote("");
      onActionComplete();
    },
    onError: (err: Error) => toast({ title: "Action failed", description: err.message, variant: "destructive" }),
  });

  if (!isPendingReview || !canDecide) return null;

  return (
    <>
      <div className="flex items-center gap-2 flex-wrap mt-3">
        <Button size="sm" onClick={() => setActionDialog("approve")} data-testid={`button-approve-${candidateId}`}>
          <CheckCircle className="h-3.5 w-3.5 mr-1" />
          Approve
        </Button>
        <Button size="sm" variant="outline" onClick={() => setActionDialog("reject")} data-testid={`button-reject-${candidateId}`}>
          <XCircle className="h-3.5 w-3.5 mr-1" />
          Reject
        </Button>
        <Button size="sm" variant="outline" onClick={() => setActionDialog("defer")} data-testid={`button-defer-${candidateId}`}>
          <Clock className="h-3.5 w-3.5 mr-1" />
          Defer
        </Button>
      </div>

      <Dialog open={!!actionDialog} onOpenChange={() => { setActionDialog(null); setNote(""); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {actionDialog === "approve" && "Approve Candidate"}
              {actionDialog === "reject" && "Reject Candidate"}
              {actionDialog === "defer" && "Defer Candidate"}
            </DialogTitle>
          </DialogHeader>
          <div>
            <Label>Note (optional)</Label>
            <Textarea value={note} onChange={e => setNote(e.target.value)} placeholder="Add a note..." data-testid="input-individual-action-note" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setActionDialog(null); setNote(""); }}>Cancel</Button>
            <Button
              onClick={() => actionMutation.mutate({ action: actionDialog!, note })}
              disabled={actionMutation.isPending}
              data-testid="button-confirm-individual-action"
            >
              {actionMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Confirm
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export default function LeadGenReviewPage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { user } = useAuth();
  const userRoles = (user?.roles ?? []).map(r => r.name);
  const canDecide = userRoles.some(r => ["Admin", "SalesManager", "SalesOperator", "Reviewer"].includes(r));
  const [filters, setFilters] = useState({ tier: "all", status: "pending_review", runId: "all", icpId: "all", ownerId: "all", duplicateClass: "all" });
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkAction, setBulkAction] = useState<"approve" | "reject" | "defer" | null>(null);
  const [bulkNote, setBulkNote] = useState("");
  const [page, setPage] = useState(1);
  const [expandedCards, setExpandedCards] = useState<Set<string>>(new Set());
  const PAGE_SIZE = 25;

  const queryParams = new URLSearchParams();
  if (filters.tier && filters.tier !== "all") queryParams.set("tier", filters.tier);
  if (filters.status && filters.status !== "all") queryParams.set("status", filters.status);
  if (filters.runId && filters.runId !== "all") queryParams.set("runId", filters.runId);
  if (filters.icpId && filters.icpId !== "all") queryParams.set("icpId", filters.icpId);
  if (filters.ownerId && filters.ownerId !== "all") queryParams.set("ownerId", filters.ownerId);
  if (filters.duplicateClass && filters.duplicateClass !== "all") queryParams.set("duplicateClass", filters.duplicateClass);
  queryParams.set("page", String(page));
  queryParams.set("limit", String(PAGE_SIZE));

  interface CandidatePageResponse { candidates: CandidateRow[]; total: number; page: number; limit: number; }
  const { data: pageData, isLoading } = useQuery<CandidatePageResponse>({
    queryKey: ["/api/lead-gen/candidates", queryParams.toString()],
    queryFn: async () => {
      const res = await fetch(`/api/lead-gen/candidates?${queryParams.toString()}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load candidates");
      return res.json();
    },
  });
  const candidates = pageData?.candidates;
  const totalCandidates = pageData?.total ?? 0;
  const totalPages = Math.ceil(totalCandidates / PAGE_SIZE);

  const { data: runs } = useQuery<LeadGenerationRun[]>({
    queryKey: ["/api/lead-gen/runs"],
  });

  const { data: icps } = useQuery<IcpProfile[]>({
    queryKey: ["/api/lead-gen/icps"],
  });

  const { data: users } = useQuery<User[]>({
    queryKey: ["/api/users"],
  });

  const bulkMutation = useMutation({
    mutationFn: async ({ action, candidateIds, note }: { action: string; candidateIds: string[]; note: string }) => {
      const res = await apiRequest("POST", `/api/lead-gen/candidates/bulk-${action}`, { candidateIds, note });
      return await res.json();
    },
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ["/api/lead-gen/candidates"] });
      queryClient.invalidateQueries({ queryKey: ["/api/lead-gen/dashboard"] });
      toast({ title: `Bulk ${vars.action} completed` });
      setSelectedIds(new Set());
      setBulkAction(null);
      setBulkNote("");
    },
    onError: () => toast({ title: "Bulk action failed", variant: "destructive" }),
  });

  const toggleSelection = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
  };

  const selectAll = () => {
    if (candidates) setSelectedIds(new Set(candidates.map(c => c.id)));
  };

  const clearAll = () => setSelectedIds(new Set());

  const toggleCardExpand = (id: string) => {
    setExpandedCards(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full p-12">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Review Queue</h1>
          <p className="text-muted-foreground">Review and action candidate leads</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <Select value={filters.status} onValueChange={v => { setFilters(f => ({ ...f, status: v })); setPage(1); }}>
          <SelectTrigger className="w-44" data-testid="select-filter-status">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="pending_review">Pending Review</SelectItem>
            <SelectItem value="approved">Approved</SelectItem>
            <SelectItem value="rejected">Rejected</SelectItem>
            <SelectItem value="deferred">Deferred</SelectItem>
          </SelectContent>
        </Select>
        <Select value={filters.tier} onValueChange={v => { setFilters(f => ({ ...f, tier: v })); setPage(1); }}>
          <SelectTrigger className="w-36" data-testid="select-filter-tier">
            <SelectValue placeholder="Tier" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Tiers</SelectItem>
            <SelectItem value="tier_1">Tier 1</SelectItem>
            <SelectItem value="tier_2">Tier 2</SelectItem>
            <SelectItem value="tier_3">Tier 3</SelectItem>
          </SelectContent>
        </Select>
        <Select value={filters.icpId} onValueChange={v => { setFilters(f => ({ ...f, icpId: v })); setPage(1); }}>
          <SelectTrigger className="w-52" data-testid="select-filter-icp">
            <SelectValue placeholder="All ICPs" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All ICPs</SelectItem>
            {icps?.map(icp => <SelectItem key={icp.id} value={icp.id}>{icp.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filters.runId} onValueChange={v => { setFilters(f => ({ ...f, runId: v })); setPage(1); }}>
          <SelectTrigger className="w-48" data-testid="select-filter-run">
            <SelectValue placeholder="All Runs" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Runs</SelectItem>
            {runs?.map(r => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filters.ownerId} onValueChange={v => { setFilters(f => ({ ...f, ownerId: v })); setPage(1); }}>
          <SelectTrigger className="w-44" data-testid="select-filter-owner">
            <SelectValue placeholder="All Owners" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Owners</SelectItem>
            {users?.map(u => <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filters.duplicateClass} onValueChange={v => { setFilters(f => ({ ...f, duplicateClass: v })); setPage(1); }}>
          <SelectTrigger className="w-52" data-testid="select-filter-duplicate-class">
            <SelectValue placeholder="Duplicate Class" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Duplicate Classes</SelectItem>
            <SelectItem value="unique">Unique</SelectItem>
            <SelectItem value="possible_duplicate">Possible Duplicate</SelectItem>
            <SelectItem value="confirmed_duplicate">Confirmed Duplicate</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Bulk action bar */}
      {selectedIds.size > 0 && canDecide && (
        <div className="flex items-center gap-3 p-3 bg-muted rounded-md flex-wrap" data-testid="bulk-action-bar">
          <span className="text-sm font-medium">{selectedIds.size} selected</span>
          <Button size="sm" variant="outline" onClick={clearAll} data-testid="button-clear-selection">Clear</Button>
          <Button size="sm" onClick={() => setBulkAction("approve")} data-testid="button-bulk-approve">
            <CheckCircle className="h-4 w-4 mr-1" />
            Approve All
          </Button>
          <Button size="sm" variant="outline" onClick={() => setBulkAction("reject")} data-testid="button-bulk-reject">
            <XCircle className="h-4 w-4 mr-1" />
            Reject All
          </Button>
          <Button size="sm" variant="outline" onClick={() => setBulkAction("defer")} data-testid="button-bulk-defer">
            <Clock className="h-4 w-4 mr-1" />
            Defer All
          </Button>
        </div>
      )}

      <div className="flex items-center gap-3 text-sm text-muted-foreground">
        <span data-testid="total-candidates-count">{totalCandidates} candidates</span>
        {canDecide && candidates && candidates.length > 0 && (
          <Button variant="ghost" size="sm" onClick={selectAll} data-testid="button-select-all">Select All</Button>
        )}
      </div>

      {/* Candidate Cards */}
      {(!candidates || candidates.length === 0) ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            No candidates match the current filters.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {candidates.map(c => {
            const isExpanded = expandedCards.has(c.id);
            const isPending = c.status === "pending_review";
            const pct = c.score ? Math.round((c.score.totalScore / c.score.maxScore) * 100) : null;

            return (
              <Card key={c.id} data-testid={`card-candidate-${c.id}`} className="transition-all">
                <CardContent className="pt-4 pb-3">
                  <div className="flex items-start gap-3">
                    {/* Selection checkbox */}
                    {isPending && canDecide && (
                      <div className="mt-0.5 shrink-0">
                        <Checkbox
                          checked={selectedIds.has(c.id)}
                          onCheckedChange={() => toggleSelection(c.id)}
                          data-testid={`checkbox-candidate-${c.id}`}
                        />
                      </div>
                    )}

                    {/* Main content */}
                    <div className="flex-1 min-w-0">
                      {/* Top row: company name + badges */}
                      <div className="flex items-start justify-between gap-2 flex-wrap">
                        <div className="min-w-0">
                          <h3 className="font-semibold text-base truncate" data-testid={`company-name-${c.id}`}>
                            {c.accountName || "Unknown Company"}
                          </h3>
                          {c.contactName && (
                            <p className="text-sm text-muted-foreground" data-testid={`contact-name-${c.id}`}>
                              {c.contactName}
                              {c.contactTitle && <span className="ml-1">&bull; {c.contactTitle}</span>}
                            </p>
                          )}
                        </div>
                        <div className="flex items-center gap-2 flex-wrap shrink-0">
                          {c.tier && (
                            <Badge variant="outline" className="text-xs" data-testid={`badge-tier-${c.id}`}>
                              {c.tier.replace("_", " ")}
                            </Badge>
                          )}
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium ${statusColors[c.status] || ""}`} data-testid={`badge-status-${c.id}`}>
                            {c.status.replace(/_/g, " ")}
                          </span>
                        </div>
                      </div>

                      {/* Second row: ICP score + run + duplicate */}
                      <div className="flex items-center gap-4 mt-2 flex-wrap">
                        <div className="flex items-center gap-1.5 text-xs">
                          <span className="text-muted-foreground">ICP Fit:</span>
                          <IcpFitScore score={c.score} />
                        </div>
                        {c.runName && (
                          <span className="text-xs text-muted-foreground" data-testid={`run-name-${c.id}`}>
                            Run: {c.runName}
                          </span>
                        )}
                        <DuplicateWarningBadge duplicateClass={c.duplicateClass} candidateId={c.id} />
                      </div>

                      {/* Expandable: Research docs */}
                      {isExpanded && (
                        <ResearchDocsSummary
                          candidateAccountId={c.candidateAccountId}
                          candidateContactId={c.candidateContactId}
                          candidateLeadId={c.id}
                        />
                      )}

                      {/* Actions row */}
                      <div className="flex items-center gap-2 mt-3 flex-wrap">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => toggleCardExpand(c.id)}
                          data-testid={`button-expand-${c.id}`}
                        >
                          {isExpanded ? <ChevronUp className="h-3.5 w-3.5 mr-1" /> : <ChevronDown className="h-3.5 w-3.5 mr-1" />}
                          {isExpanded ? "Less" : "Research Docs"}
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setLocation(`/lead-gen/candidates/${c.id}`)}
                          data-testid={`button-review-candidate-${c.id}`}
                        >
                          <ExternalLink className="h-3.5 w-3.5 mr-1" />
                          Full Review
                        </Button>
                        <IndividualActions
                          candidateId={c.id}
                          isPendingReview={isPending}
                          canDecide={canDecide}
                          onActionComplete={() => {
                            queryClient.invalidateQueries({ queryKey: ["/api/lead-gen/candidates"] });
                          }}
                        />
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Pagination */}
      <div className="flex items-center justify-between gap-3 pt-2">
        <span className="text-sm text-muted-foreground">
          Page {page} of {Math.max(1, totalPages)} &mdash; {totalCandidates} total
        </span>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} data-testid="button-page-prev">
            Previous
          </Button>
          <Button size="sm" variant="outline" onClick={() => setPage(p => p + 1)} disabled={page >= totalPages} data-testid="button-page-next">
            Next
          </Button>
        </div>
      </div>

      {/* Bulk action confirmation dialog */}
      <Dialog open={!!bulkAction} onOpenChange={() => setBulkAction(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm Bulk {bulkAction ? bulkAction.charAt(0).toUpperCase() + bulkAction.slice(1) : ""}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">This will {bulkAction} {selectedIds.size} candidate(s).</p>
          <div>
            <Label>Note (optional)</Label>
            <Textarea value={bulkNote} onChange={e => setBulkNote(e.target.value)} placeholder="Add a note..." data-testid="input-bulk-note" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkAction(null)}>Cancel</Button>
            <Button
              onClick={() => bulkMutation.mutate({ action: bulkAction!, candidateIds: Array.from(selectedIds), note: bulkNote })}
              disabled={bulkMutation.isPending}
              data-testid="button-confirm-bulk-action"
            >
              {bulkMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Confirm
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
