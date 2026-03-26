import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useParams, useLocation } from "wouter";
import { Loader2, Plus, ArrowLeft, Edit2, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { IcpProfile, IcpProfileVersion, Offer, TaskPlaybook } from "@shared/schema";

interface ScoringRubric {
  criteria?: { name: string; weight: number }[];
}

function parseScoringRubric(raw: unknown): ScoringRubric {
  if (raw && typeof raw === "object" && "criteria" in raw) return raw as ScoringRubric;
  return {};
}

interface IcpProfileDetail extends IcpProfile {
  versions: IcpProfileVersion[];
  offers: Offer[];
  playbooks: TaskPlaybook[];
}

export default function LeadGenIcpDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const [isVersionDialogOpen, setIsVersionDialogOpen] = useState(false);
  const [isOfferDialogOpen, setIsOfferDialogOpen] = useState(false);
  const [versionForm, setVersionForm] = useState({
    targetIndustries: "",
    targetCompanySizes: "",
    targetGeographies: "",
    targetTitles: "",
    notes: "",
  });
  const [rubricCriteria, setRubricCriteria] = useState([
    { name: "Industry Match", weight: 30 },
    { name: "Company Size", weight: 25 },
    { name: "Geography", weight: 20 },
    { name: "Title Match", weight: 25 },
  ]);
  const [offerForm, setOfferForm] = useState({ name: "", description: "", valueProposition: "" });

  const { data: profile, isLoading } = useQuery<IcpProfileDetail>({
    queryKey: ["/api/lead-gen/icps", id],
    queryFn: async () => {
      const res = await fetch(`/api/lead-gen/icps/${id}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load ICP");
      return res.json();
    },
  });

  const createVersionMutation = useMutation({
    mutationFn: async (data: typeof versionForm) => {
      const totalWeight = rubricCriteria.reduce((sum, c) => sum + (c.weight || 0), 0);
      const payload = {
        targetIndustries: data.targetIndustries ? data.targetIndustries.split(",").map(s => s.trim()).filter(Boolean) : [],
        targetCompanySizes: data.targetCompanySizes ? data.targetCompanySizes.split(",").map(s => s.trim()).filter(Boolean) : [],
        targetGeographies: data.targetGeographies ? data.targetGeographies.split(",").map(s => s.trim()).filter(Boolean) : [],
        targetTitles: data.targetTitles ? data.targetTitles.split(",").map(s => s.trim()).filter(Boolean) : [],
        notes: data.notes,
        scoringRubric: { criteria: rubricCriteria.filter(c => c.name.trim()), totalWeight },
      };
      const res = await apiRequest("POST", `/api/lead-gen/icps/${id}/versions`, payload);
      return await res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/lead-gen/icps", id] });
      toast({ title: "Version created" });
      setIsVersionDialogOpen(false);
      setVersionForm({ targetIndustries: "", targetCompanySizes: "", targetGeographies: "", targetTitles: "", notes: "" });
    },
    onError: () => toast({ title: "Failed to create version", variant: "destructive" }),
  });

  const createOfferMutation = useMutation({
    mutationFn: async (data: typeof offerForm) => {
      const res = await apiRequest("POST", `/api/lead-gen/icps/${id}/offers`, data);
      return await res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/lead-gen/icps", id] });
      toast({ title: "Offer created" });
      setIsOfferDialogOpen(false);
      setOfferForm({ name: "", description: "", valueProposition: "" });
    },
    onError: () => toast({ title: "Failed to create offer", variant: "destructive" }),
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full p-12">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="p-6">
        <p className="text-muted-foreground">ICP profile not found.</p>
        <Button variant="outline" className="mt-4" onClick={() => setLocation("/lead-gen/icps")}>Back to ICPs</Button>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-3 flex-wrap">
        <Button variant="ghost" size="icon" onClick={() => setLocation("/lead-gen/icps")} data-testid="button-back-icps">
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl font-semibold">{profile.name}</h1>
          {profile.description && <p className="text-muted-foreground">{profile.description}</p>}
        </div>
        <Badge variant={profile.isActive ? "default" : "secondary"} data-testid="badge-icp-status">
          {profile.isActive ? "Active" : "Inactive"}
        </Badge>
      </div>

      <Tabs defaultValue="versions">
        <TabsList data-testid="tabs-icp-detail">
          <TabsTrigger value="versions" data-testid="tab-versions">Versions ({profile.versions?.length ?? 0})</TabsTrigger>
          <TabsTrigger value="offers" data-testid="tab-offers">Offers ({profile.offers?.length ?? 0})</TabsTrigger>
          <TabsTrigger value="playbooks" data-testid="tab-playbooks">Playbooks ({profile.playbooks?.length ?? 0})</TabsTrigger>
        </TabsList>

        <TabsContent value="versions" className="space-y-4">
          <div className="flex justify-end">
            <Button onClick={() => setIsVersionDialogOpen(true)} data-testid="button-new-version">
              <Plus className="h-4 w-4 mr-2" />
              New Version
            </Button>
          </div>
          {(!profile.versions || profile.versions.length === 0) ? (
            <Card><CardContent className="py-8 text-center text-muted-foreground">No versions yet. Create the first version to define targeting criteria.</CardContent></Card>
          ) : (
            profile.versions.map(v => (
              <Card key={v.id} data-testid={`card-version-${v.id}`}>
                <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
                  <CardTitle className="text-sm font-medium">Version {v.versionNumber}</CardTitle>
                  <Badge variant={v.isActive ? "default" : "secondary"}>{v.isActive ? "Active" : "Draft"}</Badge>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                  {v.targetIndustries && v.targetIndustries.length > 0 && (
                    <div><span className="font-medium text-muted-foreground">Industries:</span> {v.targetIndustries.join(", ")}</div>
                  )}
                  {v.targetCompanySizes && v.targetCompanySizes.length > 0 && (
                    <div><span className="font-medium text-muted-foreground">Company Sizes:</span> {v.targetCompanySizes.join(", ")}</div>
                  )}
                  {v.targetGeographies && v.targetGeographies.length > 0 && (
                    <div><span className="font-medium text-muted-foreground">Geographies:</span> {v.targetGeographies.join(", ")}</div>
                  )}
                  {v.targetTitles && v.targetTitles.length > 0 && (
                    <div><span className="font-medium text-muted-foreground">Titles:</span> {v.targetTitles.join(", ")}</div>
                  )}
                  {v.notes && <div><span className="font-medium text-muted-foreground">Notes:</span> {v.notes}</div>}
                  {parseScoringRubric(v.scoringRubric).criteria && (
                    <div>
                      <span className="font-medium text-muted-foreground">Scoring Rubric:</span>
                      <div className="mt-1 flex flex-wrap gap-2">
                        {parseScoringRubric(v.scoringRubric).criteria!.map((c, i) => (
                          <span key={i} className="inline-flex items-center gap-1 bg-muted px-2 py-0.5 rounded-md text-xs">
                            {c.name} <span className="font-semibold">{c.weight}%</span>
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            ))
          )}
        </TabsContent>

        <TabsContent value="offers" className="space-y-4">
          <div className="flex justify-end">
            <Button onClick={() => setIsOfferDialogOpen(true)} data-testid="button-new-offer">
              <Plus className="h-4 w-4 mr-2" />
              New Offer
            </Button>
          </div>
          {(!profile.offers || profile.offers.length === 0) ? (
            <Card><CardContent className="py-8 text-center text-muted-foreground">No offers mapped to this ICP yet.</CardContent></Card>
          ) : (
            profile.offers.map(offer => (
              <Card key={offer.id} data-testid={`card-offer-${offer.id}`}>
                <CardHeader>
                  <CardTitle className="text-sm font-medium">{offer.name}</CardTitle>
                </CardHeader>
                {(offer.description || offer.valueProposition) && (
                  <CardContent className="text-sm space-y-1">
                    {offer.description && <p className="text-muted-foreground">{offer.description}</p>}
                    {offer.valueProposition && <p><span className="font-medium">Value Proposition:</span> {offer.valueProposition}</p>}
                  </CardContent>
                )}
              </Card>
            ))
          )}
        </TabsContent>

        <TabsContent value="playbooks" className="space-y-4">
          {(!profile.playbooks || profile.playbooks.length === 0) ? (
            <Card>
              <CardContent className="py-8 text-center text-muted-foreground">
                <p className="mb-4">No playbooks linked to this ICP.</p>
                <Button variant="outline" onClick={() => setLocation("/lead-gen/playbooks")} data-testid="button-go-playbooks">
                  Go to Playbooks
                </Button>
              </CardContent>
            </Card>
          ) : (
            profile.playbooks.map(pb => (
              <Card key={pb.id} className="hover-elevate cursor-pointer" onClick={() => setLocation(`/lead-gen/playbooks/${pb.id}`)} data-testid={`card-playbook-${pb.id}`}>
                <CardHeader>
                  <CardTitle className="text-sm font-medium">{pb.name}</CardTitle>
                  {pb.description && <p className="text-sm text-muted-foreground">{pb.description}</p>}
                </CardHeader>
              </Card>
            ))
          )}
        </TabsContent>
      </Tabs>

      {/* Create Version Dialog */}
      <Dialog open={isVersionDialogOpen} onOpenChange={setIsVersionDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Create ICP Version</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Target Industries <span className="text-muted-foreground text-xs">(comma-separated)</span></Label>
              <Input value={versionForm.targetIndustries} onChange={e => setVersionForm(f => ({ ...f, targetIndustries: e.target.value }))} placeholder="Healthcare, Technology" data-testid="input-target-industries" />
            </div>
            <div>
              <Label>Company Sizes <span className="text-muted-foreground text-xs">(comma-separated)</span></Label>
              <Input value={versionForm.targetCompanySizes} onChange={e => setVersionForm(f => ({ ...f, targetCompanySizes: e.target.value }))} placeholder="SMB, Mid-Market, Enterprise" data-testid="input-target-sizes" />
            </div>
            <div>
              <Label>Geographies <span className="text-muted-foreground text-xs">(comma-separated)</span></Label>
              <Input value={versionForm.targetGeographies} onChange={e => setVersionForm(f => ({ ...f, targetGeographies: e.target.value }))} placeholder="US, Canada" data-testid="input-target-geos" />
            </div>
            <div>
              <Label>Target Titles <span className="text-muted-foreground text-xs">(comma-separated)</span></Label>
              <Input value={versionForm.targetTitles} onChange={e => setVersionForm(f => ({ ...f, targetTitles: e.target.value }))} placeholder="CEO, VP of Sales" data-testid="input-target-titles" />
            </div>
            <div>
              <Label>Notes</Label>
              <Textarea value={versionForm.notes} onChange={e => setVersionForm(f => ({ ...f, notes: e.target.value }))} data-testid="input-version-notes" />
            </div>
            <div>
              <Label className="mb-2 block">Scoring Rubric <span className="text-muted-foreground text-xs">(weights should total 100)</span></Label>
              <div className="space-y-2" data-testid="rubric-criteria-list">
                {rubricCriteria.map((criterion, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <Input
                      className="flex-1"
                      value={criterion.name}
                      onChange={e => setRubricCriteria(prev => prev.map((c, j) => j === i ? { ...c, name: e.target.value } : c))}
                      placeholder="Criterion name"
                      data-testid={`input-rubric-name-${i}`}
                    />
                    <Input
                      className="w-24"
                      type="number"
                      min={0}
                      max={100}
                      value={criterion.weight}
                      onChange={e => setRubricCriteria(prev => prev.map((c, j) => j === i ? { ...c, weight: parseInt(e.target.value, 10) || 0 } : c))}
                      data-testid={`input-rubric-weight-${i}`}
                    />
                    <span className="text-sm text-muted-foreground w-4">%</span>
                    <Button size="icon" variant="ghost" onClick={() => setRubricCriteria(prev => prev.filter((_, j) => j !== i))} data-testid={`button-remove-criterion-${i}`}>
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
                <Button size="sm" variant="outline" onClick={() => setRubricCriteria(prev => [...prev, { name: "", weight: 0 }])} data-testid="button-add-criterion">
                  <Plus className="h-4 w-4 mr-1" />
                  Add Criterion
                </Button>
                <p className="text-xs text-muted-foreground">
                  Total weight: {rubricCriteria.reduce((sum, c) => sum + (c.weight || 0), 0)}%
                </p>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsVersionDialogOpen(false)}>Cancel</Button>
            <Button onClick={() => createVersionMutation.mutate(versionForm)} disabled={createVersionMutation.isPending} data-testid="button-submit-version">
              {createVersionMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Create Version
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create Offer Dialog */}
      <Dialog open={isOfferDialogOpen} onOpenChange={setIsOfferDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Create Offer</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="offer-name">Name *</Label>
              <Input id="offer-name" value={offerForm.name} onChange={e => setOfferForm(f => ({ ...f, name: e.target.value }))} placeholder="Offer name" data-testid="input-offer-name" />
            </div>
            <div>
              <Label>Description</Label>
              <Textarea value={offerForm.description} onChange={e => setOfferForm(f => ({ ...f, description: e.target.value }))} data-testid="input-offer-description" />
            </div>
            <div>
              <Label>Value Proposition</Label>
              <Textarea value={offerForm.valueProposition} onChange={e => setOfferForm(f => ({ ...f, valueProposition: e.target.value }))} data-testid="input-offer-value-proposition" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsOfferDialogOpen(false)}>Cancel</Button>
            <Button onClick={() => createOfferMutation.mutate(offerForm)} disabled={createOfferMutation.isPending || !offerForm.name.trim()} data-testid="button-submit-offer">
              {createOfferMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Create Offer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
