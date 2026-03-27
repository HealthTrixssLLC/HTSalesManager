import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Plus, Loader2, ChevronRight } from "lucide-react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { LeadGenerationRun, IcpProfile, IcpProfileVersion, User, TaskPlaybook } from "@shared/schema";

type PlaybookWithCount = TaskPlaybook & { stepCount: number };

const statusColors: Record<string, string> = {
  draft: "bg-gray-100 text-gray-600",
  active: "bg-blue-100 text-blue-700",
  reviewing: "bg-amber-100 text-amber-700",
  complete: "bg-green-100 text-green-700",
  archived: "bg-gray-200 text-gray-500",
};

export default function LeadGenRunsPage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [form, setForm] = useState({ name: "", description: "", icpProfileId: "", icpVersionId: "", playbookId: "", seedCompanies: "" });

  const { data: runs, isLoading } = useQuery<LeadGenerationRun[]>({
    queryKey: ["/api/lead-gen/runs"],
  });

  const { data: icps } = useQuery<IcpProfile[]>({
    queryKey: ["/api/lead-gen/icps"],
  });

  const { data: users } = useQuery<User[]>({
    queryKey: ["/api/users"],
  });

  const { data: playbooks } = useQuery<PlaybookWithCount[]>({
    queryKey: ["/api/lead-gen/playbooks"],
  });

  const { data: icpVersions } = useQuery<IcpProfileVersion[]>({
    queryKey: ["/api/lead-gen/icps", form.icpProfileId, "versions"],
    enabled: !!form.icpProfileId,
  });

  function handleIcpChange(icpProfileId: string) {
    setForm(f => ({ ...f, icpProfileId, icpVersionId: "" }));
  }

  const createMutation = useMutation({
    mutationFn: async (data: typeof form) => {
      const seedList = data.seedCompanies
        .split("\n")
        .map(s => s.trim())
        .filter(Boolean);
      const payload: Record<string, unknown> = {
        name: data.name,
        description: data.description || undefined,
      };
      if (data.icpProfileId) payload.icpProfileId = data.icpProfileId;
      if (data.icpVersionId) payload.icpVersionId = data.icpVersionId;
      if (data.playbookId) payload.playbookId = data.playbookId;
      if (seedList.length > 0) payload.seedCompanies = seedList;
      const res = await apiRequest("POST", "/api/lead-gen/runs", payload);
      return await res.json();
    },
    onSuccess: (run) => {
      queryClient.invalidateQueries({ queryKey: ["/api/lead-gen/runs"] });
      toast({ title: "Run created" });
      setIsCreateOpen(false);
      setForm({ name: "", description: "", icpProfileId: "", icpVersionId: "", playbookId: "", seedCompanies: "" });
      setLocation(`/lead-gen/runs/${run.id}`);
    },
    onError: () => toast({ title: "Failed to create run", variant: "destructive" }),
  });

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
          <h1 className="text-2xl font-semibold">Lead Generation Runs</h1>
          <p className="text-muted-foreground">Manage your prospecting campaigns</p>
        </div>
        <Button onClick={() => setIsCreateOpen(true)} data-testid="button-create-run">
          <Plus className="h-4 w-4 mr-2" />
          New Run
        </Button>
      </div>

      {(!runs || runs.length === 0) ? (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-muted-foreground mb-4">No runs yet. Create your first lead generation run.</p>
            <Button onClick={() => setIsCreateOpen(true)} data-testid="button-create-first-run">
              <Plus className="h-4 w-4 mr-2" />
              Create Run
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b">
                <th className="text-left py-3 px-4 font-medium text-muted-foreground">Name</th>
                <th className="text-left py-3 px-4 font-medium text-muted-foreground">ICP</th>
                <th className="text-left py-3 px-4 font-medium text-muted-foreground">Owner</th>
                <th className="text-left py-3 px-4 font-medium text-muted-foreground">Status</th>
                <th className="text-left py-3 px-4 font-medium text-muted-foreground">Candidates</th>
                <th className="text-left py-3 px-4 font-medium text-muted-foreground">Reviewed</th>
                <th className="text-left py-3 px-4 font-medium text-muted-foreground">Approved</th>
                <th className="text-left py-3 px-4 font-medium text-muted-foreground">Created</th>
                <th className="py-3 px-4" />
              </tr>
            </thead>
            <tbody>
              {runs.map(run => (
                <tr
                  key={run.id}
                  className="border-b hover-elevate cursor-pointer"
                  onClick={() => setLocation(`/lead-gen/runs/${run.id}`)}
                  data-testid={`row-run-${run.id}`}
                >
                  <td className="py-3 px-4 font-medium">{run.name}</td>
                  <td className="py-3 px-4 text-muted-foreground">
                    {run.icpProfileId ? (icps?.find(i => i.id === run.icpProfileId)?.name ?? "—") : "—"}
                  </td>
                  <td className="py-3 px-4 text-muted-foreground">
                    {run.ownerId ? (users?.find(u => u.id === run.ownerId)?.name ?? run.ownerId.slice(0, 8)) : "—"}
                  </td>
                  <td className="py-3 px-4">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium ${statusColors[run.status] || ""}`} data-testid={`badge-run-status-${run.id}`}>
                      {run.status}
                    </span>
                  </td>
                  <td className="py-3 px-4">{run.candidateCount}</td>
                  <td className="py-3 px-4">{run.reviewedCount}</td>
                  <td className="py-3 px-4">{run.approvedCount}</td>
                  <td className="py-3 px-4 text-muted-foreground">{new Date(run.createdAt).toLocaleDateString()}</td>
                  <td className="py-3 px-4">
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Create Lead Generation Run</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="run-name">Name *</Label>
              <Input
                id="run-name"
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                placeholder="e.g. Q2 Healthcare Outreach"
                data-testid="input-run-name"
              />
            </div>
            <div>
              <Label>Description</Label>
              <Textarea
                value={form.description}
                onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                data-testid="input-run-description"
              />
            </div>
            <div>
              <Label>ICP Profile</Label>
              <Select value={form.icpProfileId} onValueChange={handleIcpChange}>
                <SelectTrigger data-testid="select-run-icp">
                  <SelectValue placeholder="Select an ICP (optional)" />
                </SelectTrigger>
                <SelectContent>
                  {icps?.map(icp => (
                    <SelectItem key={icp.id} value={icp.id}>{icp.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Playbook</Label>
              <Select
                value={form.playbookId || "_none"}
                onValueChange={v => setForm(f => ({ ...f, playbookId: v === "_none" ? "" : v }))}
              >
                <SelectTrigger data-testid="select-run-playbook">
                  <SelectValue placeholder="Select a playbook (optional)" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="_none">None</SelectItem>
                  {(playbooks ?? []).filter(p => p.isActive).map(pb => (
                    <SelectItem key={pb.id} value={pb.id}>
                      {pb.name} ({pb.stepCount} step{pb.stepCount !== 1 ? "s" : ""})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground mt-1">
                When a playbook is linked, Communication Drafting generates one message per step.
              </p>
            </div>
            <div>
              <Label htmlFor="seed-companies">Known Target Companies</Label>
              <Textarea
                id="seed-companies"
                value={form.seedCompanies}
                onChange={e => setForm(f => ({ ...f, seedCompanies: e.target.value }))}
                placeholder={"Acme Health Plan\nUnitedHealthcare\nHumana"}
                rows={4}
                data-testid="input-seed-companies"
              />
              <p className="text-xs text-muted-foreground mt-1">
                One company per line. These are added directly as target accounts, bypassing the search step.
              </p>
            </div>
            {form.icpProfileId && (
              <div>
                <Label>ICP Version</Label>
                <Select
                  value={form.icpVersionId}
                  onValueChange={v => setForm(f => ({ ...f, icpVersionId: v }))}
                >
                  <SelectTrigger data-testid="select-run-icp-version">
                    <SelectValue placeholder="Select a version (optional)" />
                  </SelectTrigger>
                  <SelectContent>
                    {(icpVersions ?? []).length === 0 ? (
                      <SelectItem value="_none" disabled>No versions available</SelectItem>
                    ) : (
                      (icpVersions ?? []).map(v => (
                        <SelectItem key={v.id} value={v.id}>
                          v{v.versionNumber}{v.notes ? ` — ${v.notes.slice(0, 40)}` : ""}
                        </SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground mt-1">
                  Link this run to a specific ICP version for scoring reproducibility.
                </p>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsCreateOpen(false)}>Cancel</Button>
            <Button
              onClick={() => createMutation.mutate(form)}
              disabled={createMutation.isPending || !form.name.trim()}
              data-testid="button-submit-create-run"
            >
              {createMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
