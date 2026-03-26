import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Loader2, CheckCircle, XCircle, Clock } from "lucide-react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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

interface CandidateRow {
  id: string;
  status: string;
  tier: string | null;
  duplicateClass: string;
  verificationStatus: string;
  runId: string;
  accountName?: string;
  contactName?: string;
  score?: { totalScore: number; maxScore: number } | null;
  runName?: string;
  createdAt: string;
}

const statusColors: Record<string, string> = {
  pending_review: "bg-amber-100 text-amber-700",
  approved: "bg-green-100 text-green-700",
  rejected: "bg-red-100 text-red-700",
  deferred: "bg-gray-100 text-gray-600",
};

const duplicateColors: Record<string, string> = {
  unique: "bg-green-50 text-green-700",
  possible_duplicate: "bg-amber-50 text-amber-700",
  confirmed_duplicate: "bg-red-50 text-red-700",
};

const verificationColors: Record<string, string> = {
  unverified: "bg-gray-100 text-gray-600",
  partial: "bg-blue-100 text-blue-700",
  verified: "bg-green-100 text-green-700",
};

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
        <span>{totalCandidates} candidates</span>
        {canDecide && candidates && candidates.length > 0 && (
          <Button variant="ghost" size="sm" onClick={selectAll} data-testid="button-select-all">Select All</Button>
        )}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b">
              <th className="w-10 py-3 px-4" />
              <th className="text-left py-3 px-4 font-medium text-muted-foreground">Account</th>
              <th className="text-left py-3 px-4 font-medium text-muted-foreground">Contact</th>
              <th className="text-left py-3 px-4 font-medium text-muted-foreground">Score</th>
              <th className="text-left py-3 px-4 font-medium text-muted-foreground">Tier</th>
              <th className="text-left py-3 px-4 font-medium text-muted-foreground">Verification</th>
              <th className="text-left py-3 px-4 font-medium text-muted-foreground">Duplicate</th>
              <th className="text-left py-3 px-4 font-medium text-muted-foreground">Status</th>
              <th className="text-left py-3 px-4 font-medium text-muted-foreground">Run</th>
              <th className="py-3 px-4" />
            </tr>
          </thead>
          <tbody>
            {(!candidates || candidates.length === 0) ? (
              <tr>
                <td colSpan={10} className="py-12 text-center text-muted-foreground">
                  No candidates match the current filters.
                </td>
              </tr>
            ) : candidates.map(c => (
                  <tr key={c.id} className="border-b" data-testid={`row-candidate-${c.id}`}>
                    <td className="py-3 px-4">
                      <Checkbox
                        checked={selectedIds.has(c.id)}
                        onCheckedChange={() => toggleSelection(c.id)}
                        data-testid={`checkbox-candidate-${c.id}`}
                      />
                    </td>
                    <td className="py-3 px-4 font-medium">{c.accountName || "—"}</td>
                    <td className="py-3 px-4">{c.contactName || "—"}</td>
                    <td className="py-3 px-4">
                      {c.score ? `${c.score.totalScore}/${c.score.maxScore}` : "—"}
                    </td>
                    <td className="py-3 px-4">{c.tier ? c.tier.replace("_", " ") : "—"}</td>
                    <td className="py-3 px-4">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium ${verificationColors[c.verificationStatus] || "bg-gray-100 text-gray-600"}`} data-testid={`badge-verification-${c.id}`}>
                        {c.verificationStatus.replace(/_/g, " ")}
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium ${duplicateColors[c.duplicateClass] || ""}`}>
                        {c.duplicateClass.replace(/_/g, " ")}
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium ${statusColors[c.status] || ""}`}>
                        {c.status.replace("_", " ")}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-muted-foreground text-xs">{c.runName || "—"}</td>
                    <td className="py-3 px-4">
                      <Button size="sm" variant="outline" onClick={() => setLocation(`/lead-gen/candidates/${c.id}`)} data-testid={`button-review-candidate-${c.id}`}>
                        Review
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

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
