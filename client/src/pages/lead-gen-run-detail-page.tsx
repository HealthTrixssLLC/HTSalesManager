import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useParams, useLocation } from "wouter";
import { Loader2, Plus, ArrowLeft, Play, ArrowRight, CheckCircle2, RefreshCw, AlertCircle, CheckCircle, Circle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { LeadGenerationRun, CandidateLead, TaskPlaybook } from "@shared/schema";

interface EnrichedCandidate extends CandidateLead {
  accountName?: string | null;
  contactName?: string | null;
  contactEmail?: string | null;
  contactTitle?: string | null;
}

interface PhaseLogEntry {
  phase: string;
  status: "running" | "success" | "error" | "skipped";
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  error?: string;
  errorMessage?: string;
}

type RunDetail = Omit<LeadGenerationRun, "phaseLog"> & {
  candidates: EnrichedCandidate[];
  phaseLog?: PhaseLogEntry[] | null;
};

const statusColors: Record<string, string> = {
  draft: "bg-gray-100 text-gray-600",
  active: "bg-blue-100 text-blue-700",
  reviewing: "bg-amber-100 text-amber-700",
  complete: "bg-green-100 text-green-700",
  archived: "bg-gray-200 text-gray-500",
  error: "bg-red-100 text-red-700",
};

const candidateStatusColors: Record<string, string> = {
  pending_review: "bg-amber-100 text-amber-700",
  approved: "bg-green-100 text-green-700",
  rejected: "bg-red-100 text-red-700",
  deferred: "bg-gray-100 text-gray-600",
};

const NEXT_STATUS_LABEL: Record<string, string> = {
  active: "Move to Reviewing",
  reviewing: "Mark Complete",
};

const NEXT_STATUS_ICON: Record<string, typeof ArrowRight> = {
  active: ArrowRight,
  reviewing: CheckCircle2,
};

const PIPELINE_PHASES = [
  { key: "market_research", label: "Market Research" },
  { key: "company_discovery", label: "Company Discovery" },
  { key: "contact_discovery", label: "Contact Discovery" },
  { key: "strategy", label: "Strategy" },
  { key: "communication_drafting", label: "Communication Drafting" },
];

export default function LeadGenRunDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [isCandidateDialogOpen, setIsCandidateDialogOpen] = useState(false);
  const [candidateForm, setCandidateForm] = useState({
    accountName: "",
    accountWebsite: "",
    accountIndustry: "",
    contactFirstName: "",
    contactLastName: "",
    contactEmail: "",
    contactTitle: "",
    tier: "tier_1",
    playbookId: "",
    evidenceUrl: "",
    evidenceSourceType: "manual",
    evidenceDescription: "",
  });

  const { data: run, isLoading } = useQuery<RunDetail>({
    queryKey: ["/api/lead-gen/runs", id],
    queryFn: async () => {
      const res = await fetch(`/api/lead-gen/runs/${id}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load run");
      return res.json();
    },
    refetchInterval: (query) => {
      const data = query.state.data as RunDetail | undefined;
      if (!data) return false;
      // Poll every 4 seconds while run is active and pipeline is running (has currentPhase but no error)
      if (data.status === "active" && data.currentPhase && !data.errorPhase && data.currentPhase !== "complete") {
        return 4000;
      }
      return false;
    },
  });

  const { data: playbooks } = useQuery<TaskPlaybook[]>({
    queryKey: ["/api/lead-gen/playbooks"],
  });

  const startRunMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/lead-gen/runs/${id}/start`, {});
      return await res.json();
    },
    onSuccess: (data: { candidatesGenerated?: number }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/lead-gen/runs", id] });
      queryClient.invalidateQueries({ queryKey: ["/api/lead-gen/runs"] });
      const count = data.candidatesGenerated ?? 0;
      toast({
        title: "Run started!",
        description: count > 0
          ? `${count} candidate${count !== 1 ? "s" : ""} auto-generated from ICP criteria.`
          : "No matching candidates found in CRM. Use 'Stage Candidate' to add them manually.",
      });
    },
    onError: (err: Error) => toast({ title: "Failed to start run", description: err.message, variant: "destructive" }),
  });

  const advanceStatusMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/lead-gen/runs/${id}/advance-status`, {});
      return await res.json();
    },
    onSuccess: (data: LeadGenerationRun) => {
      queryClient.invalidateQueries({ queryKey: ["/api/lead-gen/runs", id] });
      queryClient.invalidateQueries({ queryKey: ["/api/lead-gen/runs"] });
      toast({ title: `Run moved to ${data.status}` });
    },
    onError: (err: Error) => toast({ title: "Failed to advance run status", description: err.message, variant: "destructive" }),
  });

  const addCandidateMutation = useMutation({
    mutationFn: async (data: typeof candidateForm) => {
      let candidateAccountId: string | undefined;
      if (data.accountName) {
        const acctRes = await apiRequest("POST", `/api/lead-gen/runs/${id}/candidate-accounts`, {
          name: data.accountName,
          website: data.accountWebsite || undefined,
          industry: data.accountIndustry || undefined,
        });
        const acct = await acctRes.json();
        candidateAccountId = acct.id;
      }

      let candidateContactId: string | undefined;
      if (data.contactFirstName && data.contactLastName) {
        const contactRes = await apiRequest("POST", `/api/lead-gen/runs/${id}/candidate-contacts`, {
          candidateAccountId: candidateAccountId || undefined,
          firstName: data.contactFirstName,
          lastName: data.contactLastName,
          email: data.contactEmail || undefined,
          title: data.contactTitle || undefined,
        });
        const contact = await contactRes.json();
        candidateContactId = contact.id;
      }

      const payload: Record<string, string | undefined> = {
        candidateAccountId: candidateAccountId || undefined,
        candidateContactId: candidateContactId || undefined,
        tier: data.tier || undefined,
        assignedPlaybookId: data.playbookId || undefined,
      };
      const res = await apiRequest("POST", `/api/lead-gen/runs/${id}/candidates`, payload);
      const candidate = await res.json();

      if (data.evidenceUrl) {
        await apiRequest("POST", `/api/lead-gen/candidates/${candidate.id}/evidence`, {
          sourceType: data.evidenceSourceType,
          url: data.evidenceUrl,
          content: data.evidenceDescription || undefined,
        });
      }

      return candidate;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/lead-gen/runs", id] });
      toast({ title: "Candidate staged" });
      setIsCandidateDialogOpen(false);
      setCandidateForm({
        accountName: "", accountWebsite: "", accountIndustry: "",
        contactFirstName: "", contactLastName: "", contactEmail: "", contactTitle: "",
        tier: "tier_1", playbookId: "",
        evidenceUrl: "", evidenceSourceType: "manual", evidenceDescription: "",
      });
    },
    onError: () => toast({ title: "Failed to stage candidate", variant: "destructive" }),
  });

  const retryPhaseMutation = useMutation({
    mutationFn: async (phase: string) => {
      const res = await apiRequest("POST", `/api/lead-gen/runs/${id}/retry-phase`, { startFromPhase: phase });
      return await res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/lead-gen/runs", id] });
      toast({ title: "Pipeline retrying", description: "The AI pipeline is running again from the failed phase." });
    },
    onError: (err: Error) => toast({ title: "Retry failed", description: err.message, variant: "destructive" }),
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full p-12">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!run) {
    return (
      <div className="p-6">
        <p className="text-muted-foreground">Run not found.</p>
        <Button variant="outline" className="mt-4" onClick={() => setLocation("/lead-gen/runs")}>Back to Runs</Button>
      </div>
    );
  }

  const canAdvance = run.status === "active" || run.status === "reviewing";
  const NextIcon = run.status ? NEXT_STATUS_ICON[run.status] : null;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-3 flex-wrap">
        <Button variant="ghost" size="icon" onClick={() => setLocation("/lead-gen/runs")} data-testid="button-back-runs">
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex-1">
          <h1 className="text-2xl font-semibold">{run.name}</h1>
          {run.description && <p className="text-muted-foreground">{run.description}</p>}
        </div>
        <span className={`inline-flex items-center px-2.5 py-1 rounded-md text-xs font-medium ${statusColors[run.status] || ""}`} data-testid="badge-run-status">
          {run.status}
        </span>
        {run.status === "draft" && (
          <Button onClick={() => startRunMutation.mutate()} disabled={startRunMutation.isPending} data-testid="button-start-run">
            {startRunMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Play className="h-4 w-4 mr-2" />}
            Start Run
          </Button>
        )}
        {canAdvance && NextIcon && (
          <Button
            variant="outline"
            onClick={() => advanceStatusMutation.mutate()}
            disabled={advanceStatusMutation.isPending}
            data-testid="button-advance-run-status"
          >
            {advanceStatusMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <NextIcon className="h-4 w-4 mr-2" />}
            {NEXT_STATUS_LABEL[run.status]}
          </Button>
        )}
      </div>

      {/* Status lifecycle indicator */}
      <div className="flex items-center gap-2 text-xs text-muted-foreground flex-wrap" data-testid="run-lifecycle-indicator">
        {(["draft", "active", "reviewing", "complete"] as const).map((s, i, arr) => (
          <span key={s} className="inline-flex items-center gap-2">
            <span
              className={`px-2 py-0.5 rounded-md font-medium ${s === run.status ? statusColors[s] : "text-muted-foreground"}`}
            >
              {s}
            </span>
            {i < arr.length - 1 && <span className="text-muted-foreground">›</span>}
          </span>
        ))}
        {run.status === "error" && (
          <span className={`ml-2 px-2 py-0.5 rounded-md font-medium ${statusColors.error}`} data-testid="badge-run-error-status">
            error
          </span>
        )}
      </div>

      {/* AI Pipeline Phase Status */}
      {(run.status === "active" || run.status === "error" || run.currentPhase || run.errorPhase) && (
        <Card data-testid="pipeline-phase-status">
          <CardHeader className="pb-2 flex flex-row items-center justify-between gap-2">
            <CardTitle className="text-base">AI Pipeline Status</CardTitle>
            {run.errorPhase && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => retryPhaseMutation.mutate(run.errorPhase!)}
                disabled={retryPhaseMutation.isPending}
                data-testid="button-retry-phase"
              >
                {retryPhaseMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <RefreshCw className="h-4 w-4 mr-2" />}
                Retry from {PIPELINE_PHASES.find(p => p.key === run.errorPhase)?.label ?? run.errorPhase}
              </Button>
            )}
          </CardHeader>
          <CardContent>
            {run.errorPhase && run.errorReason && (
              <div className="flex items-start gap-2 mb-4 p-3 rounded-md bg-destructive/10 text-destructive text-sm" data-testid="pipeline-error-message">
                <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                <div>
                  <span className="font-medium">Pipeline failed at {PIPELINE_PHASES.find(p => p.key === run.errorPhase)?.label ?? run.errorPhase}: </span>
                  {run.errorReason}
                </div>
              </div>
            )}
            <div className="flex flex-wrap gap-3" data-testid="pipeline-phases-list">
              {PIPELINE_PHASES.map(phase => {
                const logEntry = (run.phaseLog as PhaseLogEntry[] | null)?.find(e => e.phase === phase.key);
                const isRunning = logEntry?.status === "running" || (run.currentPhase === phase.key && !logEntry);
                const isError = run.errorPhase === phase.key || logEntry?.status === "error";
                return (
                  <div
                    key={phase.key}
                    className={`flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-md border ${
                      logEntry?.status === "success" ? "border-green-200 bg-green-50 text-green-700 dark:border-green-800 dark:bg-green-950 dark:text-green-400" :
                      isError ? "border-destructive/30 bg-destructive/10 text-destructive" :
                      isRunning ? "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-400" :
                      "border-border text-muted-foreground"
                    }`}
                    data-testid={`phase-${phase.key}`}
                  >
                    {logEntry?.status === "success" ? <CheckCircle className="h-3.5 w-3.5" /> :
                     isError ? <AlertCircle className="h-3.5 w-3.5" /> :
                     isRunning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> :
                     <Circle className="h-3.5 w-3.5" />}
                    {phase.label}
                    {logEntry?.durationMs && (
                      <span className="text-xs opacity-70 ml-1">{(logEntry.durationMs / 1000).toFixed(1)}s</span>
                    )}
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: "Candidates", value: run.candidateCount },
          { label: "Reviewed", value: run.reviewedCount },
          { label: "Approved", value: run.approvedCount },
          { label: "Rejected", value: run.rejectedCount },
        ].map(stat => (
          <Card key={stat.label} data-testid={`stat-${stat.label.toLowerCase()}`}>
            <CardContent className="pt-4 pb-3">
              <p className="text-2xl font-bold">{stat.value}</p>
              <p className="text-sm text-muted-foreground">{stat.label}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Candidates */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-medium">Candidates</h2>
        <Button onClick={() => setIsCandidateDialogOpen(true)} disabled={run.status === "complete" || run.status === "archived"} data-testid="button-add-candidate">
          <Plus className="h-4 w-4 mr-2" />
          Stage Candidate
        </Button>
      </div>

      {(!run.candidates || run.candidates.length === 0) ? (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            No candidates staged yet. Use the button above to add candidates to this run.
          </CardContent>
        </Card>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b">
                <th className="text-left py-3 px-4 font-medium text-muted-foreground">Company</th>
                <th className="text-left py-3 px-4 font-medium text-muted-foreground">Contact</th>
                <th className="text-left py-3 px-4 font-medium text-muted-foreground">Title</th>
                <th className="text-left py-3 px-4 font-medium text-muted-foreground">Status</th>
                <th className="text-left py-3 px-4 font-medium text-muted-foreground">Tier</th>
                <th className="text-left py-3 px-4 font-medium text-muted-foreground">Created</th>
                <th className="py-3 px-4" />
              </tr>
            </thead>
            <tbody>
              {run.candidates.map(c => (
                <tr
                  key={c.id}
                  className="border-b hover-elevate cursor-pointer"
                  onClick={() => setLocation(`/lead-gen/candidates/${c.id}`)}
                  data-testid={`row-candidate-${c.id}`}
                >
                  <td className="py-3 px-4 font-medium">{c.accountName || c.id.slice(0, 8)}</td>
                  <td className="py-3 px-4">{c.contactName || "—"}</td>
                  <td className="py-3 px-4 text-muted-foreground">{c.contactTitle || "—"}</td>
                  <td className="py-3 px-4">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium ${candidateStatusColors[c.status] || ""}`}>
                      {c.status.replace("_", " ")}
                    </span>
                  </td>
                  <td className="py-3 px-4">{c.tier ? c.tier.replace("_", " ") : "—"}</td>
                  <td className="py-3 px-4 text-muted-foreground">{new Date(c.createdAt).toLocaleDateString()}</td>
                  <td className="py-3 px-4">
                    <Button size="sm" variant="outline" onClick={e => { e.stopPropagation(); setLocation(`/lead-gen/candidates/${c.id}`); }} data-testid={`button-review-${c.id}`}>
                      Review
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Stage Candidate Dialog */}
      <Dialog open={isCandidateDialogOpen} onOpenChange={setIsCandidateDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>Stage Candidate</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div>
              <h3 className="font-medium mb-3">Account Information</h3>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Company Name *</Label>
                  <Input value={candidateForm.accountName} onChange={e => setCandidateForm(f => ({ ...f, accountName: e.target.value }))} data-testid="input-candidate-account-name" />
                </div>
                <div>
                  <Label>Website</Label>
                  <Input value={candidateForm.accountWebsite} onChange={e => setCandidateForm(f => ({ ...f, accountWebsite: e.target.value }))} data-testid="input-candidate-website" />
                </div>
                <div>
                  <Label>Industry</Label>
                  <Input value={candidateForm.accountIndustry} onChange={e => setCandidateForm(f => ({ ...f, accountIndustry: e.target.value }))} data-testid="input-candidate-industry" />
                </div>
              </div>
            </div>
            <div>
              <h3 className="font-medium mb-3">Contact Information</h3>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>First Name</Label>
                  <Input value={candidateForm.contactFirstName} onChange={e => setCandidateForm(f => ({ ...f, contactFirstName: e.target.value }))} data-testid="input-candidate-first-name" />
                </div>
                <div>
                  <Label>Last Name</Label>
                  <Input value={candidateForm.contactLastName} onChange={e => setCandidateForm(f => ({ ...f, contactLastName: e.target.value }))} data-testid="input-candidate-last-name" />
                </div>
                <div>
                  <Label>Email</Label>
                  <Input value={candidateForm.contactEmail} onChange={e => setCandidateForm(f => ({ ...f, contactEmail: e.target.value }))} data-testid="input-candidate-email" />
                </div>
                <div>
                  <Label>Title</Label>
                  <Input value={candidateForm.contactTitle} onChange={e => setCandidateForm(f => ({ ...f, contactTitle: e.target.value }))} data-testid="input-candidate-title" />
                </div>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Tier</Label>
                <Select value={candidateForm.tier} onValueChange={v => setCandidateForm(f => ({ ...f, tier: v }))}>
                  <SelectTrigger data-testid="select-candidate-tier"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="tier_1">Tier 1</SelectItem>
                    <SelectItem value="tier_2">Tier 2</SelectItem>
                    <SelectItem value="tier_3">Tier 3</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Task Playbook</Label>
                <Select value={candidateForm.playbookId} onValueChange={v => setCandidateForm(f => ({ ...f, playbookId: v }))}>
                  <SelectTrigger data-testid="select-candidate-playbook"><SelectValue placeholder="Select playbook (optional)" /></SelectTrigger>
                  <SelectContent>
                    {playbooks?.map(pb => (
                      <SelectItem key={pb.id} value={pb.id}>{pb.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <h3 className="font-medium mb-3">Evidence Source (Optional)</h3>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Source Type</Label>
                  <Select value={candidateForm.evidenceSourceType} onValueChange={v => setCandidateForm(f => ({ ...f, evidenceSourceType: v }))}>
                    <SelectTrigger data-testid="select-evidence-type"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="linkedin">LinkedIn</SelectItem>
                      <SelectItem value="website">Website</SelectItem>
                      <SelectItem value="crm">CRM</SelectItem>
                      <SelectItem value="manual">Manual</SelectItem>
                      <SelectItem value="import">Import</SelectItem>
                      <SelectItem value="other">Other</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>URL</Label>
                  <Input value={candidateForm.evidenceUrl} onChange={e => setCandidateForm(f => ({ ...f, evidenceUrl: e.target.value }))} placeholder="https://..." data-testid="input-evidence-url" />
                </div>
                <div className="col-span-2">
                  <Label>Description</Label>
                  <Input value={candidateForm.evidenceDescription} onChange={e => setCandidateForm(f => ({ ...f, evidenceDescription: e.target.value }))} placeholder="Brief description of evidence" data-testid="input-evidence-description" />
                </div>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsCandidateDialogOpen(false)}>Cancel</Button>
            <Button
              onClick={() => addCandidateMutation.mutate(candidateForm)}
              disabled={addCandidateMutation.isPending || !candidateForm.accountName.trim()}
              data-testid="button-submit-stage-candidate"
            >
              {addCandidateMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Stage Candidate
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
