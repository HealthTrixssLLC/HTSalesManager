// Opportunities Kanban board with drag-and-drop
// Based on design_guidelines.md enterprise SaaS patterns

import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Plus, Loader2, DollarSign, Calendar, Download, MessageSquare, Building2, Filter, X, Users, Tags, TrendingUp, Target, Check, ChevronsUpDown } from "lucide-react";
import { Opportunity, InsertOpportunity, insertOpportunitySchema, Account } from "@shared/schema";

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
import { Checkbox } from "@/components/ui/checkbox";
import { CommentSystem } from "@/components/comment-system";
import { BulkTagDialog } from "@/components/bulk-tag-dialog";
import { TagFilterButton } from "@/components/tag-filter-button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

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
  const [accountSearchOpen, setAccountSearchOpen] = useState(false);
  
  // Bulk operations state
  const [selectedOpportunityIds, setSelectedOpportunityIds] = useState<Set<string>>(new Set());
  const [isBulkOwnerDialogOpen, setIsBulkOwnerDialogOpen] = useState(false);
  const [isBulkStageDialogOpen, setIsBulkStageDialogOpen] = useState(false);
  const [isBulkProbabilityDialogOpen, setIsBulkProbabilityDialogOpen] = useState(false);
  const [isBulkTagDialogOpen, setIsBulkTagDialogOpen] = useState(false);
  const [bulkOwnerId, setBulkOwnerId] = useState("");
  const [bulkStage, setBulkStage] = useState("");
  const [bulkProbability, setBulkProbability] = useState("");

  // Filter states
  const [filterAccount, setFilterAccount] = useState<string>("");
  const [filterCloseDateFrom, setFilterCloseDateFrom] = useState<string>("");
  const [filterCloseDateTo, setFilterCloseDateTo] = useState<string>("");
  const [filterProbabilityMin, setFilterProbabilityMin] = useState<string>("");
  const [filterProbabilityMax, setFilterProbabilityMax] = useState<string>("");
  const [filterRating, setFilterRating] = useState<string>("");
  const [filterTagIds, setFilterTagIds] = useState<string[]>([]);
  const [filterIncludeInForecast, setFilterIncludeInForecast] = useState<string>("all");
  const [colorCodeBy, setColorCodeBy] = useState<"rating" | "closeDate" | "probability">("rating");

  const { data: opportunities, isLoading } = useQuery<OpportunityWithAccount[]>({
    queryKey: ["/api/opportunities"],
  });

  const { data: users } = useQuery<Array<{ id: string; name: string }>>({
    queryKey: ["/api/users"],
  });

  // Fetch all accounts for autocomplete
  const { data: accounts } = useQuery<Account[]>({
    queryKey: ["/api/accounts"],
  });

  // Fetch all tags for display
  const { data: allTags } = useQuery<Array<{ id: string; name: string; color: string }>>({
    queryKey: ["/api/tags"],
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

  const bulkUpdateMutation = useMutation({
    mutationFn: async ({ opportunityIds, updates }: { opportunityIds: string[]; updates: any }) => {
      const res = await apiRequest("POST", "/api/opportunities/bulk-update", { opportunityIds, updates });
      return await res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/opportunities"] });
      const countText = data.count !== 1 ? 'opportunities' : 'opportunity';
      toast({ title: `Successfully updated ${data.count} ${countText}` });
      setSelectedOpportunityIds(new Set());
      setIsBulkOwnerDialogOpen(false);
      setIsBulkStageDialogOpen(false);
      setIsBulkProbabilityDialogOpen(false);
      setBulkOwnerId("");
      setBulkStage("");
      setBulkProbability("");
    },
    onError: (error: Error) => {
      toast({ title: "Failed to bulk update opportunities", description: error.message, variant: "destructive" });
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
      actualCloseDate: null,
      actualRevenue: null,
      estCloseDate: null,
      estRevenue: null,
      rating: null,
      includeInForecast: true,
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

  // Bulk selection helpers
  const toggleOpportunitySelection = (opportunityId: string) => {
    const newSelection = new Set(selectedOpportunityIds);
    if (newSelection.has(opportunityId)) {
      newSelection.delete(opportunityId);
    } else {
      newSelection.add(opportunityId);
    }
    setSelectedOpportunityIds(newSelection);
  };

  const selectAllOpportunities = () => {
    if (filteredOpportunities) {
      setSelectedOpportunityIds(new Set(filteredOpportunities.map(o => o.id)));
    }
  };

  const clearSelection = () => {
    setSelectedOpportunityIds(new Set());
  };

  const handleBulkOwner = () => {
    if (!bulkOwnerId) {
      toast({ title: "Please select an owner", variant: "destructive" });
      return;
    }
    bulkUpdateMutation.mutate({
      opportunityIds: Array.from(selectedOpportunityIds),
      updates: { ownerId: bulkOwnerId },
    });
  };

  const handleBulkStage = () => {
    if (!bulkStage) {
      toast({ title: "Please select a stage", variant: "destructive" });
      return;
    }
    bulkUpdateMutation.mutate({
      opportunityIds: Array.from(selectedOpportunityIds),
      updates: { stage: bulkStage },
    });
  };

  const handleBulkProbability = () => {
    const probability = parseInt(bulkProbability);
    if (isNaN(probability) || probability < 0 || probability > 100) {
      toast({ title: "Please enter a valid probability (0-100)", variant: "destructive" });
      return;
    }
    bulkUpdateMutation.mutate({
      opportunityIds: Array.from(selectedOpportunityIds),
      updates: { probability },
    });
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
    
    let result = opportunities.filter(opp => {
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
      
      // Include in Forecast filter
      if (filterIncludeInForecast === "included" && opp.includeInForecast !== true) return false;
      if (filterIncludeInForecast === "excluded" && opp.includeInForecast !== false) return false;
      
      return true;
    });

    // Apply client-side tag filtering using tags from main query
    if (filterTagIds.length > 0) {
      result = result.filter((opp: any) => {
        const oppTags = opp.tags || [];
        const oppTagIds = oppTags.map((tag: any) => tag.id);
        return filterTagIds.some(tagId => oppTagIds.includes(tagId));
      });
    }

    return result;
  }, [opportunities, filterAccount, filterCloseDateFrom, filterCloseDateTo, filterProbabilityMin, filterProbabilityMax, filterRating, filterTagIds, filterIncludeInForecast]);

  const groupedOpportunities = stages.reduce((acc, stage) => {
    acc[stage.id] = filteredOpportunities?.filter((opp) => opp.stage === stage.id) || [];
    return acc;
  }, {} as Record<string, OpportunityWithAccount[]>);

  // Determine card color based on selected attribute
  const getCardColor = (opp: OpportunityWithAccount): string => {
    if (colorCodeBy === "rating") {
      if (!opp.rating) return "border-l-4 border-l-muted";
      switch (opp.rating) {
        case "hot": return "border-l-4 border-l-red-500";
        case "warm": return "border-l-4 border-l-orange-500";
        case "cold": return "border-l-4 border-l-blue-500";
        default: return "border-l-4 border-l-muted";
      }
    }
    
    if (colorCodeBy === "closeDate") {
      if (!opp.closeDate) return "border-l-4 border-l-muted";
      const now = new Date();
      const closeDate = new Date(opp.closeDate);
      const daysUntilClose = Math.ceil((closeDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
      
      if (daysUntilClose < 0) return "border-l-4 border-l-red-500"; // Overdue
      if (daysUntilClose <= 7) return "border-l-4 border-l-orange-500"; // This week
      if (daysUntilClose <= 30) return "border-l-4 border-l-yellow-500"; // This month
      if (daysUntilClose <= 90) return "border-l-4 border-l-green-500"; // Next 3 months
      return "border-l-4 border-l-blue-500"; // Future
    }
    
    if (colorCodeBy === "probability") {
      const prob = opp.probability || 0;
      if (prob >= 75) return "border-l-4 border-l-green-500"; // High
      if (prob >= 50) return "border-l-4 border-l-yellow-500"; // Medium-High
      if (prob >= 25) return "border-l-4 border-l-orange-500"; // Medium-Low
      return "border-l-4 border-l-red-500"; // Low
    }
    
    return "border-l-4 border-l-muted";
  };

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
          <Select value={colorCodeBy} onValueChange={(value: "rating" | "closeDate" | "probability") => setColorCodeBy(value)}>
            <SelectTrigger className="w-[200px]" data-testid="select-color-code">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="rating">Color by Rating</SelectItem>
              <SelectItem value="closeDate">Color by Close Date</SelectItem>
              <SelectItem value="probability">Color by Probability</SelectItem>
            </SelectContent>
          </Select>
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
                    <FormItem className="flex flex-col">
                      <FormLabel>Account *</FormLabel>
                      <Popover open={accountSearchOpen} onOpenChange={setAccountSearchOpen}>
                        <PopoverTrigger asChild>
                          <FormControl>
                            <Button
                              variant="outline"
                              role="combobox"
                              aria-expanded={accountSearchOpen}
                              className={cn(
                                "w-full justify-between",
                                !field.value && "text-muted-foreground"
                              )}
                              data-testid="input-opportunity-account"
                            >
                              {field.value
                                ? accounts?.find((account) => account.id === field.value)?.name || field.value
                                : "Search for an account..."}
                              <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                            </Button>
                          </FormControl>
                        </PopoverTrigger>
                        <PopoverContent className="w-[400px] p-0" align="start">
                          <Command>
                            <CommandInput placeholder="Search by account name or ID..." />
                            <CommandList>
                              <CommandEmpty>No account found.</CommandEmpty>
                              <CommandGroup>
                                {accounts?.map((account) => (
                                  <CommandItem
                                    key={account.id}
                                    value={`${account.name} ${account.id}`}
                                    onSelect={() => {
                                      form.setValue("accountId", account.id);
                                      setAccountSearchOpen(false);
                                    }}
                                    data-testid={`account-option-${account.id}`}
                                  >
                                    <Check
                                      className={cn(
                                        "mr-2 h-4 w-4",
                                        field.value === account.id ? "opacity-100" : "opacity-0"
                                      )}
                                    />
                                    <div className="flex flex-col">
                                      <span className="font-medium">{account.name}</span>
                                      <span className="text-sm text-muted-foreground">{account.id}</span>
                                    </div>
                                  </CommandItem>
                                ))}
                              </CommandGroup>
                            </CommandList>
                          </Command>
                        </PopoverContent>
                      </Popover>
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
                <FormField
                  control={form.control}
                  name="includeInForecast"
                  render={({ field }) => (
                    <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                      <div className="space-y-0.5">
                        <FormLabel className="text-base">Include in Forecast</FormLabel>
                        <div className="text-sm text-muted-foreground">
                          When disabled, this opportunity will be excluded from all sales metrics, dashboards, and forecast reports.
                        </div>
                      </div>
                      <FormControl>
                        <Switch
                          checked={field.value}
                          onCheckedChange={field.onChange}
                          data-testid="switch-include-in-forecast"
                        />
                      </FormControl>
                    </FormItem>
                  )}
                />
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

              <div className="space-y-2">
                <label className="text-sm font-medium">Forecast Status</label>
                <Select value={filterIncludeInForecast} onValueChange={setFilterIncludeInForecast}>
                  <SelectTrigger data-testid="select-filter-forecast-status">
                    <SelectValue placeholder="All opportunities" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All opportunities</SelectItem>
                    <SelectItem value="included">Included in forecast</SelectItem>
                    <SelectItem value="excluded">Excluded from forecast</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Tags</label>
                <TagFilterButton
                  selectedTagIds={filterTagIds}
                  onTagIdsChange={setFilterTagIds}
                />
              </div>
            </div>
            
            {(filterAccount || filterCloseDateFrom || filterCloseDateTo || filterProbabilityMin || filterProbabilityMax || filterRating || filterIncludeInForecast !== "all" || filterTagIds.length > 0) && (
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
                    setFilterTagIds([]);
                    setFilterIncludeInForecast("all");
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

      {/* Bulk Actions Toolbar */}
      {selectedOpportunityIds.size > 0 && (
        <Card data-testid="toolbar-bulk-actions">
          <CardContent className="py-3">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-2">
                <Users className="h-4 w-4 text-muted-foreground" />
                <span className="font-medium">
                  {selectedOpportunityIds.size} {selectedOpportunityIds.size === 1 ? 'opportunity' : 'opportunities'} selected
                </span>
              </div>
              <div className="flex gap-2 flex-wrap">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setIsBulkOwnerDialogOpen(true)}
                  data-testid="button-bulk-owner"
                >
                  <Users className="h-4 w-4 mr-2" />
                  Assign Owner
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setIsBulkStageDialogOpen(true)}
                  data-testid="button-bulk-stage"
                >
                  <TrendingUp className="h-4 w-4 mr-2" />
                  Change Stage
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setIsBulkProbabilityDialogOpen(true)}
                  data-testid="button-bulk-probability"
                >
                  <Target className="h-4 w-4 mr-2" />
                  Change Probability
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setIsBulkTagDialogOpen(true)}
                  data-testid="button-bulk-tags"
                >
                  <Tags className="h-4 w-4 mr-2" />
                  Bulk Add Tags
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={clearSelection}
                  data-testid="button-clear-selection"
                >
                  <X className="h-4 w-4 mr-2" />
                  Clear Selection
                </Button>
              </div>
            </div>
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
                    className={`p-4 hover-elevate cursor-move ${getCardColor(opp)}`}
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
                        <div className="flex items-start gap-2 flex-1 min-w-0">
                          <Checkbox
                            checked={selectedOpportunityIds.has(opp.id)}
                            onCheckedChange={(checked) => {
                              toggleOpportunitySelection(opp.id);
                            }}
                            onClick={(e) => e.stopPropagation()}
                            data-testid={`checkbox-opportunity-${opp.id}`}
                            className="mt-0.5"
                          />
                          <div className="flex-1 min-w-0">
                            <h4 className="font-medium text-sm">{opp.name}</h4>
                            <p className="text-xs text-muted-foreground mt-0.5" data-testid={`text-opportunity-id-${opp.id}`}>
                              {opp.id}
                            </p>
                          </div>
                        </div>
                        <div className="flex gap-1 flex-shrink-0">
                          {opp.rating && (
                            <Badge variant="outline" className="text-xs h-5">
                              {opp.rating}
                            </Badge>
                          )}
                          {opp.includeInForecast === false && (
                            <Badge variant="secondary" className="text-xs h-5" data-testid={`badge-excluded-${opp.id}`}>
                              Excluded
                            </Badge>
                          )}
                        </div>
                      </div>
                      {opp.accountName && (
                        <div className="flex flex-col gap-0.5 text-xs text-muted-foreground">
                          <div className="flex items-center gap-1">
                            <Building2 className="h-3 w-3 flex-shrink-0" />
                            <span className="truncate" data-testid={`text-account-${opp.id}`}>{opp.accountName}</span>
                          </div>
                          <span className="ml-4" data-testid={`text-account-id-${opp.id}`}>{opp.accountId}</span>
                        </div>
                      )}
                      <div className="flex items-center justify-between text-xs text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <DollarSign className="h-3 w-3" />
                          {parseFloat(opp.amount || "0").toLocaleString()}
                        </span>
                        <span>{opp.probability}%</span>
                      </div>
                      {opp.closeDate && (
                        <div className="flex items-center gap-1 text-xs text-muted-foreground">
                          <Calendar className="h-3 w-3" />
                          {new Date(opp.closeDate).toLocaleDateString()}
                        </div>
                      )}
                      <div className="flex gap-1 flex-wrap" data-testid={`tags-${opp.id}`}>
                        {(() => {
                          const oppTags = (opp as any).tags || [];
                          
                          return oppTags.map((tag: any) => (
                            <Badge 
                              key={tag.id} 
                              variant="outline"
                              className="text-xs h-5"
                              style={{ 
                                borderColor: tag.color,
                                color: tag.color,
                              }}
                              data-testid={`tag-badge-${tag.id}`}
                            >
                              {tag.name}
                            </Badge>
                          ));
                        })()}
                      </div>
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

      {/* Bulk Owner Dialog */}
      <Dialog open={isBulkOwnerDialogOpen} onOpenChange={setIsBulkOwnerDialogOpen}>
        <DialogContent data-testid="dialog-bulk-owner">
          <DialogHeader>
            <DialogTitle>Assign Owner to Selected Opportunities</DialogTitle>
            <DialogDescription>
              Assign an owner to {selectedOpportunityIds.size} selected {selectedOpportunityIds.size === 1 ? 'opportunity' : 'opportunities'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Select Owner</label>
              <Select value={bulkOwnerId} onValueChange={setBulkOwnerId}>
                <SelectTrigger data-testid="select-owner">
                  <SelectValue placeholder="Select an owner" />
                </SelectTrigger>
                <SelectContent>
                  {users?.map((user) => (
                    <SelectItem key={user.id} value={user.id}>
                      {user.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsBulkOwnerDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleBulkOwner} disabled={bulkUpdateMutation.isPending} data-testid="button-confirm-owner">
              {bulkUpdateMutation.isPending ? "Updating..." : "Assign Owner"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk Stage Dialog */}
      <Dialog open={isBulkStageDialogOpen} onOpenChange={setIsBulkStageDialogOpen}>
        <DialogContent data-testid="dialog-bulk-stage">
          <DialogHeader>
            <DialogTitle>Change Stage for Selected Opportunities</DialogTitle>
            <DialogDescription>
              Change the stage for {selectedOpportunityIds.size} selected {selectedOpportunityIds.size === 1 ? 'opportunity' : 'opportunities'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Select Stage</label>
              <Select value={bulkStage} onValueChange={setBulkStage}>
                <SelectTrigger data-testid="select-stage">
                  <SelectValue placeholder="Select a stage" />
                </SelectTrigger>
                <SelectContent>
                  {stages.map((stage) => (
                    <SelectItem key={stage.id} value={stage.id}>
                      {stage.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsBulkStageDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleBulkStage} disabled={bulkUpdateMutation.isPending} data-testid="button-confirm-stage">
              {bulkUpdateMutation.isPending ? "Updating..." : "Change Stage"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk Probability Dialog */}
      <Dialog open={isBulkProbabilityDialogOpen} onOpenChange={setIsBulkProbabilityDialogOpen}>
        <DialogContent data-testid="dialog-bulk-probability">
          <DialogHeader>
            <DialogTitle>Change Probability for Selected Opportunities</DialogTitle>
            <DialogDescription>
              Set the probability for {selectedOpportunityIds.size} selected {selectedOpportunityIds.size === 1 ? 'opportunity' : 'opportunities'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Probability (%)</label>
              <Input
                type="number"
                min="0"
                max="100"
                value={bulkProbability}
                onChange={(e) => setBulkProbability(e.target.value)}
                placeholder="Enter probability (0-100)"
                data-testid="input-probability"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsBulkProbabilityDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleBulkProbability} disabled={bulkUpdateMutation.isPending} data-testid="button-confirm-probability">
              {bulkUpdateMutation.isPending ? "Updating..." : "Change Probability"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk Tag Dialog */}
      <BulkTagDialog
        open={isBulkTagDialogOpen}
        onOpenChange={setIsBulkTagDialogOpen}
        selectedIds={Array.from(selectedOpportunityIds)}
        entity="opportunities"
        dataTestId="dialog-bulk-tags"
        onSuccess={() => {
          setSelectedOpportunityIds(new Set());
          setIsBulkTagDialogOpen(false);
        }}
      />
    </div>
  );
}
