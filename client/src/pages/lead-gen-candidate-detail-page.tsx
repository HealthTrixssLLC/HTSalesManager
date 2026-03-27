import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useParams, useLocation } from "wouter";
import { Loader2, ArrowLeft, CheckCircle, XCircle, Clock, ExternalLink, Pencil, Plus, ChevronDown, ChevronUp, Mail, Linkedin, Phone, CheckSquare, Link } from "lucide-react";
import { ResearchDocumentsPanel } from "@/components/research-documents-panel";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import type { TaskPlaybook } from "@shared/schema";

interface Citation {
  title: string;
  url: string;
}

interface CandidateAccount {
  id: string;
  name: string;
  website: string | null;
  industry: string | null;
  companySize: string | null;
  geography: string | null;
  description: string | null;
  citations?: Citation[];
}

interface CandidateContact {
  id: string;
  firstName: string;
  lastName: string;
  title: string | null;
  email: string | null;
  phone: string | null;
}

interface EvidenceSource {
  id: string;
  sourceType: string;
  title: string | null;
  url: string | null;
  content: string | null;
}

interface CandidateScore {
  id: string;
  totalScore: number;
  maxScore: number;
  rationale: string | null;
  industryScore: number | null;
  sizeScore: number | null;
  geoScore: number | null;
  titleScore: number | null;
}

interface ReviewDecision {
  id: string;
  decisionType: string;
  note: string | null;
  createdAt: string;
}

interface PlaybookStep {
  id: string;
  stepOrder: number;
  name: string;
  channel: string;
  activityType: string;
  dayOffset: number;
  description: string | null;
}

interface RunSummary {
  id: string;
  name: string;
  status: string;
}

interface PlaybookStepDraft {
  stepOrder: number;
  stepName: string;
  channel: string;
  dayOffset: number;
  activityType: string;
  subject?: string;
  draftMessage: string;
}

interface LegacyCommunicationPlan {
  channelRecommendation?: string;
  tone?: string;
  objectives?: string[];
  subjectLine?: string;
  draftedMessage?: string;
  followUpSequence?: string[];
}

type CommunicationPlan = PlaybookStepDraft[] | LegacyCommunicationPlan | null;

interface CandidateDetail {
  id: string;
  status: string;
  tier: string | null;
  duplicateClass: string;
  verificationStatus: string;
  reviewNote: string | null;
  runId: string;
  candidateAccountId: string | null;
  candidateContactId: string | null;
  assignedPlaybookId: string | null;
  communicationPlan?: CommunicationPlan;
  account: CandidateAccount | null;
  contacts: CandidateContact[];
  scores: CandidateScore[];
  evidence: EvidenceSource[];
  decisions: ReviewDecision[];
  playbook: TaskPlaybook | null;
  playbookSteps: PlaybookStep[];
  run: RunSummary | null;
  crmLeadId: string | null;
}

const statusColors: Record<string, string> = {
  pending_review: "bg-amber-100 text-amber-700",
  approved: "bg-green-100 text-green-700",
  rejected: "bg-red-100 text-red-700",
  deferred: "bg-gray-100 text-gray-600",
};

const verificationColors: Record<string, string> = {
  unverified: "bg-gray-100 text-gray-600",
  partial: "bg-blue-100 text-blue-700",
  verified: "bg-green-100 text-green-700",
};

function channelIcon(channel: string) {
  const c = (channel ?? "").toLowerCase();
  if (c.includes("email")) return <Mail className="h-4 w-4" />;
  if (c.includes("linkedin")) return <Linkedin className="h-4 w-4" />;
  if (c.includes("phone") || c.includes("call")) return <Phone className="h-4 w-4" />;
  return <CheckSquare className="h-4 w-4" />;
}

function CommunicationPlanPanel({ plan }: { plan: CommunicationPlan }) {
  const [expanded, setExpanded] = useState<number[]>([]);

  if (!plan) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-muted-foreground">
          No communication plan has been generated for this candidate yet.
          Run the Communication Drafting phase to generate one.
        </CardContent>
      </Card>
    );
  }

  if (Array.isArray(plan)) {
    const steps = [...(plan as PlaybookStepDraft[])].sort((a, b) => a.stepOrder - b.stepOrder);
    return (
      <div className="space-y-3" data-testid="communication-plan-steps">
        <p className="text-sm text-muted-foreground">
          Playbook-driven communication plan — {steps.length} step{steps.length !== 1 ? "s" : ""}
        </p>
        {steps.map((step) => {
          const isOpen = expanded.includes(step.stepOrder);
          return (
            <Card key={step.stepOrder} data-testid={`comm-step-${step.stepOrder}`}>
              <CardHeader
                className="py-3 cursor-pointer"
                onClick={() => setExpanded(prev =>
                  prev.includes(step.stepOrder) ? prev.filter(n => n !== step.stepOrder) : [...prev, step.stepOrder]
                )}
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="text-muted-foreground shrink-0">{channelIcon(step.channel)}</span>
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{step.stepName}</p>
                      <p className="text-xs text-muted-foreground">
                        Day {step.dayOffset} · {step.channel} · {step.activityType}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {step.subject && (
                      <span className="text-xs text-muted-foreground hidden sm:block truncate max-w-[200px]">{step.subject}</span>
                    )}
                    {isOpen ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                  </div>
                </div>
              </CardHeader>
              {isOpen && (
                <CardContent className="pt-0 space-y-3">
                  {step.subject && (
                    <div>
                      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">Subject</p>
                      <p className="text-sm">{step.subject}</p>
                    </div>
                  )}
                  <div>
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">Draft Message</p>
                    <pre className="text-sm whitespace-pre-wrap bg-muted/40 rounded-md p-3 font-sans leading-relaxed">{step.draftMessage}</pre>
                  </div>
                </CardContent>
              )}
            </Card>
          );
        })}
      </div>
    );
  }

  const legacy = plan as LegacyCommunicationPlan;
  return (
    <Card data-testid="communication-plan-legacy">
      <CardHeader><CardTitle className="text-base">Communication Plan</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        {legacy.channelRecommendation && (
          <div>
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">Recommended Channel</p>
            <p className="text-sm">{legacy.channelRecommendation}</p>
          </div>
        )}
        {legacy.tone && (
          <div>
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">Tone</p>
            <p className="text-sm">{legacy.tone}</p>
          </div>
        )}
        {legacy.objectives && legacy.objectives.length > 0 && (
          <div>
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">Objectives</p>
            <ul className="list-disc list-inside text-sm space-y-1">
              {legacy.objectives.map((o, i) => <li key={i}>{o}</li>)}
            </ul>
          </div>
        )}
        {legacy.subjectLine && (
          <div>
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">Subject Line</p>
            <p className="text-sm">{legacy.subjectLine}</p>
          </div>
        )}
        {legacy.draftedMessage && (
          <div>
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">Draft Message</p>
            <pre className="text-sm whitespace-pre-wrap bg-muted/40 rounded-md p-3 font-sans leading-relaxed">{legacy.draftedMessage}</pre>
          </div>
        )}
        {legacy.followUpSequence && legacy.followUpSequence.length > 0 && (
          <div>
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">Follow-up Sequence</p>
            <ol className="list-decimal list-inside text-sm space-y-1">
              {legacy.followUpSequence.map((s, i) => <li key={i}>{s}</li>)}
            </ol>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function LeadGenCandidateDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { user } = useAuth();
  const userRoles = (user?.roles ?? []).map(r => r.name);
  const canDecide = userRoles.some(r => ["Admin", "SalesManager", "SalesOperator", "Reviewer"].includes(r));
  const canEdit = canDecide;
  const canAddEvidence = userRoles.some(r => ["Admin", "SalesManager", "SalesOperator"].includes(r));
  const [actionDialog, setActionDialog] = useState<"approve" | "reject" | "defer" | null>(null);
  const [note, setNote] = useState("");
  const [approvalSuccess, setApprovalSuccess] = useState<{ crmLeadId: string } | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [editForm, setEditForm] = useState({ tier: "", playbookId: "", reviewNote: "" });
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const [evidenceForm, setEvidenceForm] = useState({ sourceType: "linkedin", url: "", title: "", content: "" });

  const { data: candidate, isLoading } = useQuery<CandidateDetail>({
    queryKey: ["/api/lead-gen/candidates", id],
    queryFn: async () => {
      const res = await fetch(`/api/lead-gen/candidates/${id}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load candidate");
      return res.json();
    },
  });

  const { data: playbooks } = useQuery<TaskPlaybook[]>({
    queryKey: ["/api/lead-gen/playbooks"],
  });

  const decisionMutation = useMutation({
    mutationFn: async ({ action, note: n }: { action: string; note: string }) => {
      const res = await apiRequest("POST", `/api/lead-gen/candidates/${id}/${action}`, { note: n });
      return await res.json();
    },
    onSuccess: (data, vars) => {
      queryClient.invalidateQueries({ queryKey: ["/api/lead-gen/candidates", id] });
      queryClient.invalidateQueries({ queryKey: ["/api/lead-gen/candidates"] });
      queryClient.invalidateQueries({ queryKey: ["/api/lead-gen/dashboard"] });
      setActionDialog(null);
      setNote("");
      if (vars.action === "approve" && data.crmLeadId) {
        setApprovalSuccess({ crmLeadId: data.crmLeadId });
      } else {
        toast({ title: `Candidate ${vars.action}ed` });
      }
    },
    onError: (err: Error) => toast({ title: "Action failed", description: err.message, variant: "destructive" }),
  });

  const editMutation = useMutation({
    mutationFn: async (data: typeof editForm) => {
      const payload: Record<string, string | null> = {};
      if (data.tier) payload.tier = data.tier;
      if (data.playbookId === "none") payload.assignedPlaybookId = null;
      else if (data.playbookId) payload.assignedPlaybookId = data.playbookId;
      if (data.reviewNote !== undefined) payload.reviewNote = data.reviewNote || null;
      const res = await apiRequest("PATCH", `/api/lead-gen/candidates/${id}`, payload);
      return await res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/lead-gen/candidates", id] });
      toast({ title: "Candidate updated" });
      setEditOpen(false);
    },
    onError: (err: Error) => toast({ title: "Update failed", description: err.message, variant: "destructive" }),
  });

  const openEdit = () => {
    if (!candidate) return;
    setEditForm({
      tier: candidate.tier ?? "",
      playbookId: candidate.assignedPlaybookId ?? "none",
      reviewNote: candidate.reviewNote ?? "",
    });
    setEditOpen(true);
  };

  const addEvidenceMutation = useMutation({
    mutationFn: async (data: typeof evidenceForm) => {
      const res = await apiRequest("POST", `/api/lead-gen/candidates/${id}/evidence`, data);
      return await res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/lead-gen/candidates", id] });
      toast({ title: "Evidence added" });
      setEvidenceOpen(false);
      setEvidenceForm({ sourceType: "linkedin", url: "", title: "", content: "" });
    },
    onError: () => toast({ title: "Failed to add evidence", variant: "destructive" }),
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full p-12">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!candidate) {
    return (
      <div className="p-6">
        <p className="text-muted-foreground">Candidate not found.</p>
        <Button variant="outline" className="mt-4" onClick={() => setLocation("/lead-gen/review")}>Back to Review Queue</Button>
      </div>
    );
  }

  const isPendingReview = candidate.status === "pending_review";

  return (
    <div className="p-6 space-y-6">
      {approvalSuccess && (
        <Alert className="border-green-200 bg-green-50">
          <CheckCircle className="h-4 w-4 text-green-600" />
          <AlertDescription className="flex items-center gap-2">
            Candidate approved and CRM Lead created.
            <Button size="sm" variant="outline" onClick={() => setLocation(`/leads/${approvalSuccess.crmLeadId}`)} data-testid="button-view-crm-lead">
              View Lead <ExternalLink className="h-3 w-3 ml-1" />
            </Button>
          </AlertDescription>
        </Alert>
      )}

      <div className="flex items-center gap-3 flex-wrap">
        <Button variant="ghost" size="icon" onClick={() => setLocation("/lead-gen/review")} data-testid="button-back-review">
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex-1">
          <h1 className="text-2xl font-semibold">
            {candidate.account?.name || "Unknown Account"}
          </h1>
          <p className="text-muted-foreground">
            Run: {candidate.run?.name || "—"}
          </p>
        </div>
        <span
          className={`inline-flex items-center px-2.5 py-1 rounded-md text-xs font-medium ${verificationColors[candidate.verificationStatus] || "bg-gray-100 text-gray-600"}`}
          data-testid="badge-verification-status"
        >
          {candidate.verificationStatus.replace(/_/g, " ")}
        </span>
        <span className={`inline-flex items-center px-2.5 py-1 rounded-md text-xs font-medium ${statusColors[candidate.status] || ""}`} data-testid="badge-candidate-status">
          {candidate.status.replace("_", " ")}
        </span>
        {canEdit && (
          <Button variant="outline" size="sm" onClick={openEdit} data-testid="button-edit-candidate">
            <Pencil className="h-4 w-4 mr-1" />
            Edit
          </Button>
        )}
      </div>

      {/* Decision Actions */}
      {isPendingReview && canDecide && (
        <div className="flex items-center gap-3 p-4 bg-muted rounded-md flex-wrap" data-testid="decision-actions">
          <span className="text-sm font-medium">Decision:</span>
          <Button size="sm" onClick={() => setActionDialog("approve")} data-testid="button-approve">
            <CheckCircle className="h-4 w-4 mr-1" />
            Approve
          </Button>
          <Button size="sm" variant="outline" onClick={() => setActionDialog("reject")} data-testid="button-reject">
            <XCircle className="h-4 w-4 mr-1" />
            Reject
          </Button>
          <Button size="sm" variant="outline" onClick={() => setActionDialog("defer")} data-testid="button-defer">
            <Clock className="h-4 w-4 mr-1" />
            Defer
          </Button>
        </div>
      )}

      {candidate.crmLeadId && (
        <Alert>
          <CheckCircle className="h-4 w-4" />
          <AlertDescription className="flex items-center gap-2">
            This candidate has been converted to a CRM Lead.
            <Button size="sm" variant="outline" onClick={() => setLocation(`/leads/${candidate.crmLeadId}`)} data-testid="button-view-existing-crm-lead">
              View Lead <ExternalLink className="h-3 w-3 ml-1" />
            </Button>
          </AlertDescription>
        </Alert>
      )}

      <Tabs defaultValue="account">
        <TabsList data-testid="tabs-candidate-detail">
          <TabsTrigger value="account" data-testid="tab-account">Account</TabsTrigger>
          <TabsTrigger value="contacts" data-testid="tab-contacts">Contacts & Evidence</TabsTrigger>
          <TabsTrigger value="research" data-testid="tab-research">Research Docs</TabsTrigger>
          <TabsTrigger value="score" data-testid="tab-score">Score Rationale</TabsTrigger>
          <TabsTrigger value="duplicates" data-testid="tab-duplicates">Duplicate Check</TabsTrigger>
          <TabsTrigger value="playbook" data-testid="tab-playbook">Proposed Playbook</TabsTrigger>
          <TabsTrigger value="communication" data-testid="tab-communication">Communication Plan</TabsTrigger>
          <TabsTrigger value="decisions" data-testid="tab-decisions">History</TabsTrigger>
        </TabsList>

        {/* Account */}
        <TabsContent value="account">
          <Card data-testid="panel-account">
            <CardHeader><CardTitle className="text-base">Account Summary</CardTitle></CardHeader>
            <CardContent className="space-y-3 text-sm">
              {candidate.account ? (
                <>
                  <div><span className="font-medium text-muted-foreground">Company:</span> {candidate.account.name}</div>
                  {candidate.account.website && <div><span className="font-medium text-muted-foreground">Website:</span> {candidate.account.website}</div>}
                  {candidate.account.industry && <div><span className="font-medium text-muted-foreground">Industry:</span> {candidate.account.industry}</div>}
                  {candidate.account.companySize && <div><span className="font-medium text-muted-foreground">Size:</span> {candidate.account.companySize}</div>}
                  {candidate.account.geography && <div><span className="font-medium text-muted-foreground">Geography:</span> {candidate.account.geography}</div>}
                  {candidate.account.description && <div><span className="font-medium text-muted-foreground">Description:</span> {candidate.account.description}</div>}
                </>
              ) : (
                <p className="text-muted-foreground">No account information</p>
              )}
              <div><span className="font-medium text-muted-foreground">Tier:</span> {candidate.tier ? candidate.tier.replace("_", " ") : "—"}</div>
              <div><span className="font-medium text-muted-foreground">Verification:</span>{" "}
                <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium ${verificationColors[candidate.verificationStatus] || ""}`}>
                  {candidate.verificationStatus.replace(/_/g, " ")}
                </span>
              </div>
              {candidate.reviewNote && <div><span className="font-medium text-muted-foreground">Note:</span> {candidate.reviewNote}</div>}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Contacts & Evidence */}
        <TabsContent value="contacts" className="space-y-4" data-testid="panel-contacts">
          <Card>
            <CardHeader><CardTitle className="text-base">Contacts</CardTitle></CardHeader>
            <CardContent>
              {candidate.contacts.length === 0 ? (
                <p className="text-sm text-muted-foreground">No contacts</p>
              ) : (
                candidate.contacts.map((c: CandidateContact) => (
                  <div key={c.id} className="text-sm space-y-1 mb-3 pb-3 border-b last:border-0">
                    <p className="font-medium">{c.firstName} {c.lastName}</p>
                    {c.title && <p className="text-muted-foreground">{c.title}</p>}
                    {c.email && <p>{c.email}</p>}
                    {c.phone && <p>{c.phone}</p>}
                  </div>
                ))
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2 flex-wrap">
              <CardTitle className="text-base">Evidence Sources ({candidate.evidence.length})</CardTitle>
              {canAddEvidence && (
                <Button size="sm" variant="outline" onClick={() => setEvidenceOpen(true)} data-testid="button-add-evidence">
                  <Plus className="h-4 w-4 mr-1" /> Add Evidence
                </Button>
              )}
            </CardHeader>
            <CardContent>
              {candidate.evidence.length === 0 ? (
                <p className="text-sm text-muted-foreground">No evidence sources</p>
              ) : (
                candidate.evidence.map((e: EvidenceSource) => (
                  <div key={e.id} className="text-sm mb-3 pb-3 border-b last:border-0">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline">{e.sourceType}</Badge>
                      {e.title && <span className="font-medium">{e.title}</span>}
                    </div>
                    {e.url && <a href={e.url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline text-xs">{e.url}</a>}
                    {e.content && <p className="text-muted-foreground mt-1">{e.content}</p>}
                  </div>
                ))
              )}
            </CardContent>
          </Card>
          {candidate.account?.citations && candidate.account.citations.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Link className="h-4 w-4" />
                  Web Search Citations ({candidate.account.citations.length})
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {candidate.account.citations.map((c: Citation, idx: number) => (
                    <div key={idx} className="flex items-start gap-2 text-sm" data-testid={`citation-item-${idx}`}>
                      <ExternalLink className="h-3.5 w-3.5 mt-0.5 shrink-0 text-muted-foreground" />
                      <div className="min-w-0">
                        {c.title && <p className="font-medium truncate">{c.title}</p>}
                        <a
                          href={c.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-primary hover:underline text-xs break-all"
                          data-testid={`citation-link-${idx}`}
                        >
                          {c.url}
                        </a>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* Research Documents */}
        <TabsContent value="research" data-testid="panel-research">
          {candidate.candidateAccountId && (
            <ResearchDocumentsPanel
              entityType="candidate_account"
              entityId={candidate.candidateAccountId}
              className="mb-4"
            />
          )}
          {candidate.candidateContactId && (
            <ResearchDocumentsPanel
              entityType="candidate_contact"
              entityId={candidate.candidateContactId}
              className="mb-4"
            />
          )}
          <ResearchDocumentsPanel
            entityType="candidate_lead"
            entityId={candidate.id}
          />
        </TabsContent>

        {/* Score Rationale */}
        <TabsContent value="score" data-testid="panel-score">
          <Card>
            <CardHeader><CardTitle className="text-base">Score Rationale</CardTitle></CardHeader>
            <CardContent>
              {candidate.scores.length === 0 ? (
                <p className="text-sm text-muted-foreground">No scoring data</p>
              ) : (
                candidate.scores.map((s: CandidateScore) => (
                  <div key={s.id} className="text-sm space-y-3">
                    <div className="flex items-center gap-3">
                      <span className="text-3xl font-bold">{s.totalScore}</span>
                      <span className="text-muted-foreground">/ {s.maxScore}</span>
                    </div>
                    {s.rationale && <p>{s.rationale}</p>}
                    {s.industryScore !== null && <div><span className="font-medium text-muted-foreground">Industry:</span> {s.industryScore}</div>}
                    {s.sizeScore !== null && <div><span className="font-medium text-muted-foreground">Size:</span> {s.sizeScore}</div>}
                    {s.geoScore !== null && <div><span className="font-medium text-muted-foreground">Geography:</span> {s.geoScore}</div>}
                    {s.titleScore !== null && <div><span className="font-medium text-muted-foreground">Title:</span> {s.titleScore}</div>}
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Duplicate Check */}
        <TabsContent value="duplicates" data-testid="panel-duplicates">
          <Card>
            <CardHeader><CardTitle className="text-base">Duplicate Check Results</CardTitle></CardHeader>
            <CardContent>
              <div className="text-sm space-y-2">
                <div>
                  <span className="font-medium text-muted-foreground">Classification:</span>{" "}
                  <Badge variant={candidate.duplicateClass === "unique" ? "default" : "destructive"}>
                    {candidate.duplicateClass.replace(/_/g, " ")}
                  </Badge>
                </div>
                <p className="text-muted-foreground">
                  {candidate.duplicateClass === "unique" && "No matching records found in the CRM."}
                  {candidate.duplicateClass === "possible_duplicate" && "A possible match was found based on company name."}
                  {candidate.duplicateClass === "confirmed_duplicate" && "An existing lead with the same email address was found."}
                </p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Proposed Playbook */}
        <TabsContent value="playbook" data-testid="panel-playbook">
          <Card>
            <CardHeader><CardTitle className="text-base">Proposed Task Playbook</CardTitle></CardHeader>
            <CardContent>
              {!candidate.playbook ? (
                <p className="text-sm text-muted-foreground">No playbook assigned</p>
              ) : (
                <div className="space-y-4">
                  <div>
                    <p className="font-medium">{candidate.playbook.name}</p>
                    {candidate.playbook.description && <p className="text-sm text-muted-foreground">{candidate.playbook.description}</p>}
                  </div>
                  <div className="space-y-2">
                    {candidate.playbookSteps.map((step: PlaybookStep) => (
                      <div key={step.id} className="flex items-start gap-3 text-sm p-3 border rounded-md">
                        <span className="font-medium text-muted-foreground shrink-0">Day +{step.dayOffset}</span>
                        <div>
                          <p className="font-medium">Step {step.stepOrder}: {step.name}</p>
                          <div className="flex gap-2 mt-1">
                            <Badge variant="outline" className="text-xs">{step.channel}</Badge>
                            <Badge variant="outline" className="text-xs">{step.activityType}</Badge>
                          </div>
                          {step.description && <p className="text-muted-foreground mt-1">{step.description}</p>}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Communication Plan */}
        <TabsContent value="communication" data-testid="panel-communication">
          <CommunicationPlanPanel plan={candidate.communicationPlan ?? null} />
        </TabsContent>

        {/* Decision History */}
        <TabsContent value="decisions" data-testid="panel-decisions">
          <Card>
            <CardHeader><CardTitle className="text-base">Decision History</CardTitle></CardHeader>
            <CardContent>
              {candidate.decisions.length === 0 ? (
                <p className="text-sm text-muted-foreground">No decisions yet</p>
              ) : (
                candidate.decisions.map((d: ReviewDecision) => (
                  <div key={d.id} className="text-sm mb-3 pb-3 border-b last:border-0">
                    <div className="flex items-center gap-2">
                      <Badge variant={d.decisionType === "approve" ? "default" : "outline"}>{d.decisionType}</Badge>
                      <span className="text-muted-foreground text-xs">{new Date(d.createdAt).toLocaleString()}</span>
                    </div>
                    {d.note && <p className="mt-1">{d.note}</p>}
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Decision Action Dialog */}
      <Dialog open={!!actionDialog} onOpenChange={() => setActionDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {actionDialog === "approve" && "Approve Candidate"}
              {actionDialog === "reject" && "Reject Candidate"}
              {actionDialog === "defer" && "Defer Candidate"}
            </DialogTitle>
          </DialogHeader>
          {actionDialog === "approve" && (
            <p className="text-sm text-muted-foreground">
              Approving this candidate will create a CRM Lead and generate tasks from the assigned playbook.
            </p>
          )}
          <div>
            <Label>Note (optional)</Label>
            <Textarea value={note} onChange={e => setNote(e.target.value)} placeholder="Add a note..." data-testid="input-decision-note" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setActionDialog(null)}>Cancel</Button>
            <Button
              onClick={() => decisionMutation.mutate({ action: actionDialog!, note })}
              disabled={decisionMutation.isPending}
              data-testid="button-confirm-decision"
            >
              {decisionMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Confirm
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Candidate Dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Candidate</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Tier</Label>
              <Select value={editForm.tier} onValueChange={v => setEditForm(f => ({ ...f, tier: v }))}>
                <SelectTrigger data-testid="select-edit-tier">
                  <SelectValue placeholder="Select tier" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="tier_1">Tier 1</SelectItem>
                  <SelectItem value="tier_2">Tier 2</SelectItem>
                  <SelectItem value="tier_3">Tier 3</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Task Playbook</Label>
              <Select value={editForm.playbookId} onValueChange={v => setEditForm(f => ({ ...f, playbookId: v }))}>
                <SelectTrigger data-testid="select-edit-playbook">
                  <SelectValue placeholder="No playbook" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  {playbooks?.map(pb => (
                    <SelectItem key={pb.id} value={pb.id}>{pb.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Review Note</Label>
              <Input
                value={editForm.reviewNote}
                onChange={e => setEditForm(f => ({ ...f, reviewNote: e.target.value }))}
                placeholder="Add a review note..."
                data-testid="input-edit-note"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>Cancel</Button>
            <Button
              onClick={() => editMutation.mutate(editForm)}
              disabled={editMutation.isPending}
              data-testid="button-save-edit"
            >
              {editMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add Evidence Dialog */}
      <Dialog open={evidenceOpen} onOpenChange={setEvidenceOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add Evidence Source</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Source Type</Label>
              <Select value={evidenceForm.sourceType} onValueChange={v => setEvidenceForm(f => ({ ...f, sourceType: v }))}>
                <SelectTrigger data-testid="select-evidence-source-type"><SelectValue /></SelectTrigger>
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
              <Label>Title</Label>
              <Input value={evidenceForm.title} onChange={e => setEvidenceForm(f => ({ ...f, title: e.target.value }))} placeholder="Evidence title" data-testid="input-evidence-title" />
            </div>
            <div>
              <Label>URL</Label>
              <Input value={evidenceForm.url} onChange={e => setEvidenceForm(f => ({ ...f, url: e.target.value }))} placeholder="https://..." data-testid="input-evidence-url" />
            </div>
            <div>
              <Label>Notes</Label>
              <Textarea value={evidenceForm.content} onChange={e => setEvidenceForm(f => ({ ...f, content: e.target.value }))} placeholder="Additional context or notes..." data-testid="input-evidence-content" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEvidenceOpen(false)}>Cancel</Button>
            <Button
              onClick={() => addEvidenceMutation.mutate(evidenceForm)}
              disabled={addEvidenceMutation.isPending}
              data-testid="button-submit-evidence"
            >
              {addEvidenceMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Add Evidence
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
