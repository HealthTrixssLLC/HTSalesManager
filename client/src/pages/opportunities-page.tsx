// Opportunities Kanban board with drag-and-drop
// Based on design_guidelines.md enterprise SaaS patterns

import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Plus, Loader2, DollarSign, Calendar, Download, MessageSquare } from "lucide-react";
import { Opportunity, InsertOpportunity, insertOpportunitySchema } from "@shared/schema";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { CommentSystem } from "@/components/comment-system";

const stages = [
  { id: "prospecting", label: "Prospecting", color: "bg-gray-500" },
  { id: "qualification", label: "Qualification", color: "bg-blue-500" },
  { id: "proposal", label: "Proposal", color: "bg-yellow-500" },
  { id: "negotiation", label: "Negotiation", color: "bg-orange-500" },
  { id: "closed_won", label: "Closed Won", color: "bg-green-500" },
  { id: "closed_lost", label: "Closed Lost", color: "bg-red-500" },
];

export default function OpportunitiesPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [commentsOpportunityId, setCommentsOpportunityId] = useState<string | null>(null);
  const [commentsOpportunityName, setCommentsOpportunityName] = useState<string | null>(null);
  const [draggedOpportunity, setDraggedOpportunity] = useState<Opportunity | null>(null);
  const [dragOverStage, setDragOverStage] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const { data: opportunities, isLoading } = useQuery<Opportunity[]>({
    queryKey: ["/api/opportunities"],
  });

  const createMutation = useMutation({
    mutationFn: async (data: InsertOpportunity) => {
      const res = await apiRequest("POST", "/api/opportunities", data);
      return await res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/opportunities"] });
      toast({ title: "Opportunity created successfully" });
      setIsCreateDialogOpen(false);
    },
    onError: (error: Error) => {
      toast({ title: "Failed to create opportunity", description: error.message, variant: "destructive" });
    },
  });

  const updateStageMutation = useMutation({
    mutationFn: async ({ id, stage }: { id: string; stage: string }) => {
      const res = await apiRequest("PATCH", `/api/opportunities/${id}`, { stage });
      return await res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/opportunities"] });
      toast({ title: "Stage updated successfully" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to update stage", description: error.message, variant: "destructive" });
    },
  });

  const form = useForm<InsertOpportunity>({
    resolver: zodResolver(insertOpportunitySchema),
    defaultValues: {
      id: "",
      name: "",
      accountId: "",
      stage: "prospecting",
      amount: "0",
      probability: 0,
      ownerId: user?.id || "",
      closeDate: null,
      status: null,
      actualCloseDate: null,
      actualRevenue: null,
      estCloseDate: null,
      estRevenue: null,
      rating: null,
    },
  });

  const onSubmit = (data: InsertOpportunity) => {
    createMutation.mutate(data);
  };

  const handleExport = async () => {
    try {
      const response = await fetch("/api/export/opportunities", {
        credentials: "include",
      });
      
      if (!response.ok) {
        throw new Error("Export failed");
      }
      
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `opportunities-${Date.now()}.csv`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      
      toast({ title: "Opportunities exported successfully" });
    } catch (error) {
      toast({ title: "Failed to export Opportunities", variant: "destructive" });
    }
  };

  const handleDragStart = (e: React.DragEvent, opp: Opportunity) => {
    setDraggedOpportunity(opp);
    setIsDragging(true);
    e.dataTransfer.effectAllowed = "move";
    e.currentTarget.classList.add("opacity-50");
  };

  const handleDragEnd = (e: React.DragEvent) => {
    e.currentTarget.classList.remove("opacity-50");
    setDraggedOpportunity(null);
    setDragOverStage(null);
    setTimeout(() => setIsDragging(false), 100);
  };

  const handleDragOver = (e: React.DragEvent, stageId: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOverStage(stageId);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    const relatedTarget = e.relatedTarget as HTMLElement;
    if (!e.currentTarget.contains(relatedTarget)) {
      setDragOverStage(null);
    }
  };

  const handleDrop = (e: React.DragEvent, targetStage: string) => {
    e.preventDefault();
    setDragOverStage(null);
    
    if (!draggedOpportunity || draggedOpportunity.stage === targetStage) {
      return;
    }
    
    updateStageMutation.mutate({ 
      id: draggedOpportunity.id, 
      stage: targetStage 
    });
    setDraggedOpportunity(null);
  };

  const groupedOpportunities = stages.reduce((acc, stage) => {
    acc[stage.id] = opportunities?.filter((opp) => opp.stage === stage.id) || [];
    return acc;
  }, {} as Record<string, Opportunity[]>);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-8 w-8 animate-spin text-primary" data-testid="loading-spinner" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-semibold text-foreground">Opportunities</h1>
          <p className="text-muted-foreground">Visual pipeline to track deals and close them faster</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={handleExport} data-testid="button-export-opportunities">
            <Download className="h-4 w-4 mr-2" />
            Export to CSV
          </Button>
          <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
            <DialogTrigger asChild>
              <Button data-testid="button-create-opportunity">
                <Plus className="h-4 w-4 mr-2" />
                New Opportunity
              </Button>
            </DialogTrigger>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>Create New Opportunity</DialogTitle>
              <DialogDescription>Add a new opportunity to your pipeline</DialogDescription>
            </DialogHeader>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <FormField
                  control={form.control}
                  name="id"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Opportunity ID</FormLabel>
                      <FormControl>
                        <Input placeholder="Will be auto-generated if left blank" {...field} data-testid="input-opportunity-id" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Opportunity Name *</FormLabel>
                      <FormControl>
                        <Input placeholder="Q1 Healthcare Software License" {...field} data-testid="input-opportunity-name" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="accountId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Account ID *</FormLabel>
                      <FormControl>
                        <Input placeholder="ACCT-2025-00001" {...field} data-testid="input-opportunity-account" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="amount"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Amount</FormLabel>
                        <FormControl>
                          <Input type="number" placeholder="50000" {...field} value={field.value || ""} data-testid="input-opportunity-amount" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="probability"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Probability (%)</FormLabel>
                        <FormControl>
                          <Input type="number" min="0" max="100" placeholder="50" {...field} value={field.value || 0} onChange={(e) => field.onChange(parseInt(e.target.value) || 0)} data-testid="input-opportunity-probability" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
                <FormField
                  control={form.control}
                  name="stage"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Stage</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger data-testid="select-opportunity-stage">
                            <SelectValue placeholder="Select stage" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {stages.map((stage) => (
                            <SelectItem key={stage.id} value={stage.id}>
                              {stage.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="status"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Status</FormLabel>
                        <FormControl>
                          <Input placeholder="Open, Won, Lost" {...field} value={field.value || ""} data-testid="input-opportunity-status" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="rating"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Rating</FormLabel>
                        <FormControl>
                          <Input placeholder="Hot, Warm, Cold" {...field} value={field.value || ""} data-testid="input-opportunity-rating" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
                <DialogFooter>
                  <Button type="button" variant="outline" onClick={() => setIsCreateDialogOpen(false)}>
                    Cancel
                  </Button>
                  <Button type="submit" disabled={createMutation.isPending} data-testid="button-submit-opportunity">
                    {createMutation.isPending ? "Creating..." : "Create Opportunity"}
                  </Button>
                </DialogFooter>
              </form>
            </Form>
          </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Kanban Board */}
      <div className="flex gap-4 overflow-x-auto pb-4">
        {stages.map((stage) => (
          <div key={stage.id} className="flex-shrink-0 w-80">
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-medium flex items-center gap-2">
                    <Badge className={stage.color}>{stage.label}</Badge>
                    <span className="text-muted-foreground">({groupedOpportunities[stage.id].length})</span>
                  </CardTitle>
                </div>
              </CardHeader>
              <CardContent 
                className={`space-y-3 min-h-[400px] transition-colors ${
                  dragOverStage === stage.id ? "bg-accent/20 border-2 border-dashed border-primary" : ""
                }`}
                onDragOver={(e) => handleDragOver(e, stage.id)}
                onDragLeave={handleDragLeave}
                onDrop={(e) => handleDrop(e, stage.id)}
              >
                {groupedOpportunities[stage.id].map((opp) => (
                  <Card 
                    key={opp.id} 
                    className="p-4 hover-elevate cursor-move" 
                    data-testid={`card-opportunity-${opp.id}`}
                    draggable
                    onDragStart={(e) => handleDragStart(e, opp)}
                    onDragEnd={handleDragEnd}
                    onClick={() => {
                      if (!isDragging) {
                        setLocation(`/opportunities/${opp.id}`);
                      }
                    }}
                  >
                    <div className="space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <h4 className="font-medium text-sm">{opp.name}</h4>
                        {opp.rating && (
                          <Badge variant="outline" className="text-xs h-5">
                            {opp.rating}
                          </Badge>
                        )}
                      </div>
                      <div className="flex items-center justify-between text-xs text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <DollarSign className="h-3 w-3" />
                          ${parseFloat(opp.amount || "0").toLocaleString()}
                        </span>
                        <span>{opp.probability}%</span>
                      </div>
                      {opp.status && (
                        <div className="text-xs text-muted-foreground">
                          Status: {opp.status}
                        </div>
                      )}
                      {opp.closeDate && (
                        <div className="flex items-center gap-1 text-xs text-muted-foreground">
                          <Calendar className="h-3 w-3" />
                          {new Date(opp.closeDate).toLocaleDateString()}
                        </div>
                      )}
                      <div className="flex gap-1 pt-2" onClick={(e) => e.stopPropagation()}>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs"
                          onClick={() => {
                            const currentIndex = stages.findIndex((s) => s.id === stage.id);
                            if (currentIndex > 0) {
                              updateStageMutation.mutate({ id: opp.id, stage: stages[currentIndex - 1].id });
                            }
                          }}
                          disabled={stage.id === "prospecting"}
                        >
                          ←
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs"
                          onClick={() => {
                            setCommentsOpportunityId(opp.id);
                            setCommentsOpportunityName(opp.name);
                          }}
                          data-testid={`button-comments-${opp.id}`}
                        >
                          <MessageSquare className="h-3 w-3" />
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs flex-1"
                          onClick={() => setLocation(`/opportunities/${opp.id}`)}
                        >
                          View
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs"
                          onClick={() => {
                            const currentIndex = stages.findIndex((s) => s.id === stage.id);
                            if (currentIndex < stages.length - 1) {
                              updateStageMutation.mutate({ id: opp.id, stage: stages[currentIndex + 1].id });
                            }
                          }}
                          disabled={stage.id === "closed_won" || stage.id === "closed_lost"}
                        >
                          →
                        </Button>
                      </div>
                    </div>
                  </Card>
                ))}
              </CardContent>
            </Card>
          </div>
        ))}
      </div>

      <Dialog open={commentsOpportunityId !== null} onOpenChange={(open) => !open && setCommentsOpportunityId(null)}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Comments</DialogTitle>
          </DialogHeader>
          {commentsOpportunityId && (
            <CommentSystem
              entity="opportunities"
              entityId={commentsOpportunityId}
              entityName={commentsOpportunityName || undefined}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
