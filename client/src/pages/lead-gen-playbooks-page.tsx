import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Plus, Loader2, ChevronRight } from "lucide-react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { TaskPlaybook } from "@shared/schema";

export default function LeadGenPlaybooksPage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [form, setForm] = useState({ name: "", description: "" });

  const { data: playbooks, isLoading } = useQuery<TaskPlaybook[]>({
    queryKey: ["/api/lead-gen/playbooks"],
  });

  const createMutation = useMutation({
    mutationFn: async (data: typeof form) => {
      const res = await apiRequest("POST", "/api/lead-gen/playbooks", data);
      return await res.json();
    },
    onSuccess: (pb) => {
      queryClient.invalidateQueries({ queryKey: ["/api/lead-gen/playbooks"] });
      toast({ title: "Playbook created" });
      setIsCreateOpen(false);
      setForm({ name: "", description: "" });
      setLocation(`/lead-gen/playbooks/${pb.id}`);
    },
    onError: () => toast({ title: "Failed to create playbook", variant: "destructive" }),
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
          <h1 className="text-2xl font-semibold">Task Playbooks</h1>
          <p className="text-muted-foreground">Define ordered outreach steps for approved candidates</p>
        </div>
        <Button onClick={() => setIsCreateOpen(true)} data-testid="button-create-playbook">
          <Plus className="h-4 w-4 mr-2" />
          New Playbook
        </Button>
      </div>

      {(!playbooks || playbooks.length === 0) ? (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-muted-foreground mb-4">No playbooks yet. Create your first playbook to get started.</p>
            <Button onClick={() => setIsCreateOpen(true)} data-testid="button-create-first-playbook">
              <Plus className="h-4 w-4 mr-2" />
              Create Playbook
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {playbooks.map(pb => (
            <Card
              key={pb.id}
              className="hover-elevate cursor-pointer"
              onClick={() => setLocation(`/lead-gen/playbooks/${pb.id}`)}
              data-testid={`card-playbook-${pb.id}`}
            >
              <CardHeader className="flex flex-row items-center justify-between gap-2">
                <div>
                  <CardTitle className="text-base">{pb.name}</CardTitle>
                  {pb.description && <p className="text-sm text-muted-foreground mt-1">{pb.description}</p>}
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={pb.isActive ? "default" : "secondary"} data-testid={`badge-playbook-status-${pb.id}`}>
                    {pb.isActive ? "Active" : "Inactive"}
                  </Badge>
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                </div>
              </CardHeader>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Create Task Playbook</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="pb-name">Name *</Label>
              <Input id="pb-name" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Healthcare Outreach Sequence" data-testid="input-playbook-name" />
            </div>
            <div>
              <Label>Description</Label>
              <Textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="Brief description of this playbook" data-testid="input-playbook-description" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsCreateOpen(false)}>Cancel</Button>
            <Button onClick={() => createMutation.mutate(form)} disabled={createMutation.isPending || !form.name.trim()} data-testid="button-submit-create-playbook">
              {createMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
