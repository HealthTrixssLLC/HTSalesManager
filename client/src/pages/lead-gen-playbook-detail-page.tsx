import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useParams, useLocation } from "wouter";
import { Loader2, Plus, ArrowLeft, Trash2, GripVertical } from "lucide-react";
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
import type { TaskPlaybook, TaskPlaybookStep } from "@shared/schema";

interface PlaybookDetail extends TaskPlaybook {
  steps: TaskPlaybookStep[];
}

export default function LeadGenPlaybookDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [isStepDialogOpen, setIsStepDialogOpen] = useState(false);
  const [stepForm, setStepForm] = useState({
    name: "",
    description: "",
    channel: "email" as string,
    dayOffset: "0",
    activityType: "task" as string,
    stepOrder: "1",
  });

  const { data: playbook, isLoading } = useQuery<PlaybookDetail>({
    queryKey: ["/api/lead-gen/playbooks", id],
    queryFn: async () => {
      const res = await fetch(`/api/lead-gen/playbooks/${id}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load playbook");
      return res.json();
    },
  });

  const addStepMutation = useMutation({
    mutationFn: async (data: typeof stepForm) => {
      const payload = {
        name: data.name,
        description: data.description,
        channel: data.channel,
        dayOffset: parseInt(data.dayOffset, 10),
        activityType: data.activityType,
        stepOrder: parseInt(data.stepOrder, 10),
      };
      const res = await apiRequest("POST", `/api/lead-gen/playbooks/${id}/steps`, payload);
      return await res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/lead-gen/playbooks", id] });
      toast({ title: "Step added" });
      setIsStepDialogOpen(false);
      setStepForm({ name: "", description: "", channel: "email", dayOffset: "0", activityType: "task", stepOrder: "1" });
    },
    onError: () => toast({ title: "Failed to add step", variant: "destructive" }),
  });

  const deleteStepMutation = useMutation({
    mutationFn: async (stepId: string) => {
      const res = await apiRequest("DELETE", `/api/lead-gen/playbook-steps/${stepId}`);
      return await res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/lead-gen/playbooks", id] });
      toast({ title: "Step removed" });
    },
    onError: () => toast({ title: "Failed to remove step", variant: "destructive" }),
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full p-12">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!playbook) {
    return (
      <div className="p-6">
        <p className="text-muted-foreground">Playbook not found.</p>
        <Button variant="outline" className="mt-4" onClick={() => setLocation("/lead-gen/playbooks")}>Back to Playbooks</Button>
      </div>
    );
  }

  const nextStepOrder = (playbook.steps?.length || 0) + 1;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-3 flex-wrap">
        <Button variant="ghost" size="icon" onClick={() => setLocation("/lead-gen/playbooks")} data-testid="button-back-playbooks">
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex-1">
          <h1 className="text-2xl font-semibold">{playbook.name}</h1>
          {playbook.description && <p className="text-muted-foreground">{playbook.description}</p>}
        </div>
        <Badge variant={playbook.isActive ? "default" : "secondary"} data-testid="badge-playbook-status">
          {playbook.isActive ? "Active" : "Inactive"}
        </Badge>
      </div>

      <div className="flex items-center justify-between">
        <h2 className="text-lg font-medium">Steps ({playbook.steps?.length ?? 0})</h2>
        <Button onClick={() => { setStepForm(f => ({ ...f, stepOrder: String(nextStepOrder) })); setIsStepDialogOpen(true); }} data-testid="button-add-step">
          <Plus className="h-4 w-4 mr-2" />
          Add Step
        </Button>
      </div>

      {(!playbook.steps || playbook.steps.length === 0) ? (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            No steps yet. Add the first outreach step to this playbook.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {playbook.steps.map((step, idx) => (
            <Card key={step.id} data-testid={`card-step-${step.id}`}>
              <CardHeader className="flex flex-row items-center gap-3 pb-2">
                <GripVertical className="h-4 w-4 text-muted-foreground shrink-0" />
                <div className="flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-sm">Step {step.stepOrder}: {step.name}</span>
                    <Badge variant="outline" className="text-xs">{step.channel}</Badge>
                    <Badge variant="outline" className="text-xs">{step.activityType}</Badge>
                    <span className="text-xs text-muted-foreground">Day +{step.dayOffset}</span>
                  </div>
                  {step.description && <p className="text-sm text-muted-foreground mt-1">{step.description}</p>}
                </div>
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => deleteStepMutation.mutate(step.id)}
                  disabled={deleteStepMutation.isPending}
                  data-testid={`button-delete-step-${step.id}`}
                >
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </CardHeader>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={isStepDialogOpen} onOpenChange={setIsStepDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add Playbook Step</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Step Name *</Label>
              <Input value={stepForm.name} onChange={e => setStepForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Initial LinkedIn Connection" data-testid="input-step-name" />
            </div>
            <div>
              <Label>Description</Label>
              <Textarea value={stepForm.description} onChange={e => setStepForm(f => ({ ...f, description: e.target.value }))} data-testid="input-step-description" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Channel</Label>
                <Select value={stepForm.channel} onValueChange={v => setStepForm(f => ({ ...f, channel: v }))}>
                  <SelectTrigger data-testid="select-step-channel"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="email">Email</SelectItem>
                    <SelectItem value="linkedin">LinkedIn</SelectItem>
                    <SelectItem value="call">Call</SelectItem>
                    <SelectItem value="event">Event</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Activity Type</Label>
                <Select value={stepForm.activityType} onValueChange={v => setStepForm(f => ({ ...f, activityType: v }))}>
                  <SelectTrigger data-testid="select-step-activity-type"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="task">Task</SelectItem>
                    <SelectItem value="email">Email</SelectItem>
                    <SelectItem value="call">Call</SelectItem>
                    <SelectItem value="meeting">Meeting</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Day Offset</Label>
                <Input type="number" min="0" value={stepForm.dayOffset} onChange={e => setStepForm(f => ({ ...f, dayOffset: e.target.value }))} data-testid="input-step-day-offset" />
              </div>
              <div>
                <Label>Step Order</Label>
                <Input type="number" min="1" value={stepForm.stepOrder} onChange={e => setStepForm(f => ({ ...f, stepOrder: e.target.value }))} data-testid="input-step-order" />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsStepDialogOpen(false)}>Cancel</Button>
            <Button onClick={() => addStepMutation.mutate(stepForm)} disabled={addStepMutation.isPending || !stepForm.name.trim()} data-testid="button-submit-step">
              {addStepMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Add Step
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
