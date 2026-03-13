import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";

interface QuickLogActivityProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  relatedType: "Account" | "Contact" | "Opportunity" | "Lead";
  relatedId: string;
  relatedName: string;
}

export function QuickLogActivity({ open, onOpenChange, relatedType, relatedId, relatedName }: QuickLogActivityProps) {
  const [subject, setSubject] = useState("");
  const [type, setType] = useState("task");
  const [priority, setPriority] = useState("medium");
  const [dueAt, setDueAt] = useState("");
  const [ownerId, setOwnerId] = useState("");
  const [notes, setNotes] = useState("");
  const { toast } = useToast();

  const { data: users } = useQuery<Array<{ id: string; name: string }>>({
    queryKey: ["/api/users"],
    enabled: open,
  });

  const resetForm = () => {
    setSubject("");
    setType("task");
    setPriority("medium");
    setDueAt("");
    setOwnerId("");
    setNotes("");
  };

  const mutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/activities", {
        id: "",
        subject, type, priority, status: "pending",
        relatedType, relatedId,
        dueAt: dueAt ? new Date(dueAt) : null,
        ownerId: ownerId || null,
        notes: notes || null,
      });
      return await res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/activities"] });
      const entityKey = relatedType === "Opportunity" ? "opportunities" : relatedType.toLowerCase() + "s";
      queryClient.invalidateQueries({ queryKey: [`/api/${entityKey}`, relatedId, "related"] });
      toast({ title: "Activity logged successfully" });
      resetForm();
      onOpenChange(false);
    },
    onError: (error: Error) => {
      toast({ title: "Failed to log activity", description: error.message, variant: "destructive" });
    },
  });

  return (
    <Sheet open={open} onOpenChange={(v) => { if (!v) resetForm(); onOpenChange(v); }}>
      <SheetContent className="sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Log Activity</SheetTitle>
          <SheetDescription>
            Quick-log an activity for {relatedName}
          </SheetDescription>
        </SheetHeader>
        <div className="space-y-4 mt-4">
          <div>
            <Label>Subject *</Label>
            <Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Follow up call" className="mt-1.5" data-testid="input-quick-log-subject" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Type</Label>
              <Select value={type} onValueChange={setType}>
                <SelectTrigger className="mt-1.5" data-testid="select-quick-log-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="task">Task</SelectItem>
                  <SelectItem value="call">Call</SelectItem>
                  <SelectItem value="email">Email</SelectItem>
                  <SelectItem value="meeting">Meeting</SelectItem>
                  <SelectItem value="note">Note</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Priority</Label>
              <Select value={priority} onValueChange={setPriority}>
                <SelectTrigger className="mt-1.5" data-testid="select-quick-log-priority">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">Low</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <Label>Due Date</Label>
            <Input type="datetime-local" value={dueAt} onChange={(e) => setDueAt(e.target.value)} className="mt-1.5" data-testid="input-quick-log-due" />
          </div>
          <div>
            <Label>Assignee</Label>
            <Select value={ownerId} onValueChange={setOwnerId}>
              <SelectTrigger className="mt-1.5" data-testid="select-quick-log-assignee">
                <SelectValue placeholder="Select assignee (optional)" />
              </SelectTrigger>
              <SelectContent>
                {users?.map((u) => (
                  <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Notes</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Details about this activity..." className="mt-1.5" rows={3} data-testid="textarea-quick-log-notes" />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button onClick={() => mutation.mutate()} disabled={!subject.trim() || mutation.isPending} data-testid="button-submit-quick-log">
              {mutation.isPending ? "Logging..." : "Log Activity"}
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
