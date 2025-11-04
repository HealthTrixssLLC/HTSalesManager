// Opportunities Kanban board with drag-and-drop
// Based on design_guidelines.md enterprise SaaS patterns

import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Plus, Loader2, DollarSign, Calendar, Download, MessageSquare, Building2, Filter } from "lucide-react";
import { Opportunity, InsertOpportunity, insertOpportunitySchema } from "@shared/schema";

type OpportunityWithAccount = Opportunity & { accountName: string | null };
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
  const [draggedOpportunity, setDraggedOpportunity] = useState<OpportunityWithAccount | null>(null);
  const [dragOverStage, setDragOverStage] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  
  // Filter states
  const [filterAccount, setFilterAccount] = useState<string>("");
  const [filterCloseDateFrom, setFilterCloseDateFrom] = useState<string>("");
  const [filterCloseDateTo, setFilterCloseDateTo] = useState<string>("");
  const [filterProbabilityMin, setFilterProbabilityMin] = useState<string>("");
  const [filterProbabilityMax, setFilterProbabilityMax] = useState<string>("");
  const [filterRating, setFilterRating] = useState<string>("");

  const { data: opportunities, isLoading } = useQuery<OpportunityWithAccount[]>({
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

  const handleDragStart = (e: React.DragEvent, opp: OpportunityWithAccount) => {
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

  // Get unique accounts for filter dropdown
  const uniqueAccounts = useMemo(() => {
    if (!opportunities) return [];
    const accountMap = new Map<string, string>();
    opportunities.forEach(opp => {
      if (opp.accountName && opp.accountId) {
        accountMap.set(opp.accountId, opp.accountName);
      }
    });
    return Array.from(accountMap.entries()).map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [opportunities]);

  // Apply filters
  const filteredOpportunities = useMemo(() => {
    if (!opportunities) return [];
    
    return opportunities.filter(opp => {
      // Account filter
      if (filterAccount && opp.accountId !== filterAccount) return false;
      
      // Close date range filter - exclude items without dates when filter is active
      if (filterCloseDateFrom || filterCloseDateTo) {
        if (!opp.closeDate) return false; // Exclude if no close date when filter is active
        
        const closeDate = new Date(opp.closeDate);
        
        if (filterCloseDateFrom) {
          const fromDate = new Date(filterCloseDateFrom);
          if (closeDate < fromDate) return false;
        }
        
        if (filterCloseDateTo) {
          const toDate = new Date(filterCloseDateTo);
          if (closeDate > toDate) return false;
        }
      }
      
      // Probability range filter
      if (filterProbabilityMin && opp.probability !== null && opp.probability !== undefined) {
        if (opp.probability < parseInt(filterProbabilityMin)) return false;
      }
      if (filterProbabilityMax && opp.probability !== null && opp.probability !== undefined) {
        if (opp.probability > parseInt(filterProbabilityMax)) return false;
      }
      
      // Rating filter
      if (filterRating && opp.rating !== filterRating) return false;
      
      return true;
    });
  }, [opportunities, filterAccount, filterCloseDateFrom, filterCloseDateTo, filterProbabilityMin, filterProbabilityMax, filterRating]);

  const groupedOpportunities = stages.reduce((acc, stage) => {
    acc[stage.id] = filteredOpportunities?.filter((opp) => opp.stage === stage.id) || [];
    return acc;
  }, {} as Record<string, OpportunityWithAccount[]>);

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
          <Button variant="outline" onClick={() => setShowFilters(!showFilters)} data-testid="button-toggle-filters">
            <Filter className="h-4 w-4 mr-2" />
            {showFilters ? "Hide Filters" : "Show Filters"}
          </Button>
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
                        <Select 
                          onValueChange={(value) => field.onChange(value === "none" ? null : value)} 
                          value={field.value || "none"}
                        >
                          <FormControl>
                            <SelectTrigger data-testid="select-opportunity-rating">
                              <SelectValue placeholder="Select rating" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="none">None</SelectItem>
                            <SelectItem value="hot">Hot</SelectItem>
                            <SelectItem value="warm">Warm</SelectItem>
                            <SelectItem value="cold">Cold</SelectItem>
                          </SelectContent>
                        </Select>
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

      {/* Filters */}
      {showFilters && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Filters</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Account</label>
                <Select value={filterAccount || "all"} onValueChange={(value) => setFilterAccount(value === "all" ? "" : value)}>
                  <SelectTrigger data-testid="select-filter-account">
                    <SelectValue placeholder="All accounts" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All accounts</SelectItem>
                    {uniqueAccounts.map((account) => (
                      <SelectItem key={account.id} value={account.id}>
                        {account.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              
              <div className="space-y-2">
                <label className="text-sm font-medium">Close Date From</label>
                <Input 
                  type="date" 
                  value={filterCloseDateFrom}
                  onChange={(e) => setFilterCloseDateFrom(e.target.value)}
                  data-testid="input-filter-close-date-from"
                />
              </div>
              
              <div className="space-y-2">
                <label className="text-sm font-medium">Close Date To</label>
                <Input 
                  type="date" 
                  value={filterCloseDateTo}
                  onChange={(e) => setFilterCloseDateTo(e.target.value)}
                  data-testid="input-filter-close-date-to"
                />
              </div>
              
              <div className="space-y-2">
                <label className="text-sm font-medium">Probability Min %</label>
                <Input 
                  type="number" 
                  min="0" 
                  max="100" 
                  value={filterProbabilityMin}
                  onChange={(e) => setFilterProbabilityMin(e.target.value)}
                  placeholder="0"
                  data-testid="input-filter-probability-min"
                />
              </div>
              
              <div className="space-y-2">
                <label className="text-sm font-medium">Probability Max %</label>
                <Input 
                  type="number" 
                  min="0" 
                  max="100" 
                  value={filterProbabilityMax}
                  onChange={(e) => setFilterProbabilityMax(e.target.value)}
                  placeholder="100"
                  data-testid="input-filter-probability-max"
                />
              </div>
              
              <div className="space-y-2">
                <label className="text-sm font-medium">Rating</label>
                <Select value={filterRating || "all"} onValueChange={(value) => setFilterRating(value === "all" ? "" : value)}>
                  <SelectTrigger data-testid="select-filter-rating">
                    <SelectValue placeholder="All ratings" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All ratings</SelectItem>
                    <SelectItem value="hot">Hot</SelectItem>
                    <SelectItem value="warm">Warm</SelectItem>
                    <SelectItem value="cold">Cold</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            
            {(filterAccount || filterCloseDateFrom || filterCloseDateTo || filterProbabilityMin || filterProbabilityMax || filterRating) && (
              <div className="flex gap-2 mt-4">
                <Button 
                  variant="outline" 
                  size="sm"
                  onClick={() => {
                    setFilterAccount("");
                    setFilterCloseDateFrom("");
                    setFilterCloseDateTo("");
                    setFilterProbabilityMin("");
                    setFilterProbabilityMax("");
                    setFilterRating("");
                  }}
                  data-testid="button-clear-filters"
                >
                  Clear All Filters
                </Button>
                <Badge variant="secondary">
                  {filteredOpportunities.length} of {opportunities?.length || 0} opportunities
                </Badge>
              </div>
            )}
          </CardContent>
        </Card>
      )}

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
                      {opp.accountName && (
                        <div className="flex items-center gap-1 text-xs text-muted-foreground">
                          <Building2 className="h-3 w-3 flex-shrink-0" />
                          <span className="truncate" data-testid={`text-account-${opp.id}`}>{opp.accountName}</span>
                        </div>
                      )}
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
