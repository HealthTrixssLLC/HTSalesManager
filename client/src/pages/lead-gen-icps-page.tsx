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
import type { IcpProfile } from "@shared/schema";

export default function LeadGenIcpsPage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [form, setForm] = useState({ name: "", description: "" });

  const { data: profiles, isLoading } = useQuery<IcpProfile[]>({
    queryKey: ["/api/lead-gen/icps"],
  });

  const createMutation = useMutation({
    mutationFn: async (data: typeof form) => {
      const res = await apiRequest("POST", "/api/lead-gen/icps", data);
      return await res.json();
    },
    onSuccess: (profile) => {
      queryClient.invalidateQueries({ queryKey: ["/api/lead-gen/icps"] });
      toast({ title: "ICP Profile created" });
      setIsCreateOpen(false);
      setForm({ name: "", description: "" });
      setLocation(`/lead-gen/icps/${profile.id}`);
    },
    onError: () => toast({ title: "Failed to create ICP profile", variant: "destructive" }),
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
          <h1 className="text-2xl font-semibold">Ideal Customer Profiles</h1>
          <p className="text-muted-foreground">Define and version your target customer criteria</p>
        </div>
        <Button onClick={() => setIsCreateOpen(true)} data-testid="button-create-icp">
          <Plus className="h-4 w-4 mr-2" />
          New ICP
        </Button>
      </div>

      {(!profiles || profiles.length === 0) ? (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-muted-foreground mb-4">No ICP profiles yet. Create your first profile to get started.</p>
            <Button onClick={() => setIsCreateOpen(true)} data-testid="button-create-first-icp">
              <Plus className="h-4 w-4 mr-2" />
              Create ICP Profile
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {profiles.map(profile => (
            <Card
              key={profile.id}
              className="hover-elevate cursor-pointer"
              onClick={() => setLocation(`/lead-gen/icps/${profile.id}`)}
              data-testid={`card-icp-${profile.id}`}
            >
              <CardHeader className="flex flex-row items-center justify-between gap-2">
                <div>
                  <CardTitle className="text-base">{profile.name}</CardTitle>
                  {profile.description && (
                    <p className="text-sm text-muted-foreground mt-1">{profile.description}</p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={profile.isActive ? "default" : "secondary"} data-testid={`badge-status-${profile.id}`}>
                    {profile.isActive ? "Active" : "Inactive"}
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
          <DialogHeader>
            <DialogTitle>Create ICP Profile</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="icp-name">Name *</Label>
              <Input
                id="icp-name"
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                placeholder="e.g. Mid-Market Healthcare Providers"
                data-testid="input-icp-name"
              />
            </div>
            <div>
              <Label htmlFor="icp-description">Description</Label>
              <Textarea
                id="icp-description"
                value={form.description}
                onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                placeholder="Brief description of this ICP"
                data-testid="input-icp-description"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsCreateOpen(false)}>Cancel</Button>
            <Button
              onClick={() => createMutation.mutate(form)}
              disabled={createMutation.isPending || !form.name.trim()}
              data-testid="button-submit-create-icp"
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
