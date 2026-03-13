import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useRoute, useLocation } from "wouter";
import { Loader2, Check, ChevronsUpDown, Plus, X, Users } from "lucide-react";
import { DetailPageLayout, DetailSection, DetailField } from "@/components/detail-page-layout";
import { RelatedEntitiesSection } from "@/components/related-entities-section";
import { CommentSystem } from "@/components/comment-system";
import { QuickLogActivity } from "@/components/quick-log-activity";
import { GlobalQuickAdd } from "@/components/global-quick-add";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Switch } from "@/components/ui/switch";
import { TagSelector } from "@/components/tag-selector";
import type { Tag } from "@/components/ui/tag-badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { Opportunity, Account, Contact, Activity, InsertOpportunity, InsertActivity } from "@shared/schema";
import { insertOpportunitySchema, insertActivitySchema } from "@shared/schema";
import { z } from "zod";

export default function OpportunityDetailPage() {
  const [, params] = useRoute("/opportunities/:id");
  const [, setLocation] = useLocation();
  const opportunityId = params?.id;
  const { toast } = useToast();
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [selectedTags, setSelectedTags] = useState<Tag[]>([]);
  const [isCreateActivityDialogOpen, setIsCreateActivityDialogOpen] = useState(false);
  const [isLogActivityOpen, setIsLogActivityOpen] = useState(false);
  const [editRepSearchOpen, setEditRepSearchOpen] = useState(false);
  const [isQuickAddOpen, setIsQuickAddOpen] = useState(false);
  const [quickAddTab, setQuickAddTab] = useState<"contact" | "activity">("activity");
  const [newResourceUserId, setNewResourceUserId] = useState("");
  const [newResourceRole, setNewResourceRole] = useState("");
  const [resourceUserSearchOpen, setResourceUserSearchOpen] = useState(false);

  const { data: opportunity, isLoading: oppLoading } = useQuery<Opportunity>({
    queryKey: ["/api/opportunities", opportunityId],
    enabled: !!opportunityId,
  });

  const { data: tags = [], isLoading: tagsLoading } = useQuery<Tag[]>({
    queryKey: ["/api/opportunities", opportunityId, "tags"],
    queryFn: async () => {
      const res = await fetch(`/api/opportunities/${opportunityId}/tags`);
      if (!res.ok) throw new Error("Failed to fetch tags");
      return res.json();
    },
    enabled: !!opportunityId,
  });

  const { data: relatedData, isLoading: relatedLoading } = useQuery<{
    account: { items: Account[]; total: number };
    contacts: { items: Contact[]; total: number };
    activities: { items: Activity[]; total: number };
  }>({
    queryKey: ["/api/opportunities", opportunityId, "related"],
    enabled: !!opportunityId,
  });

  const { data: users = [] } = useQuery<Array<{ id: string; name: string; email: string }>>({
    queryKey: ["/api/users"],
  });

  type OpportunityResourceWithUser = {
    id: string;
    opportunityId: string;
    userId: string;
    role: string;
    userName: string;
    userEmail: string;
    createdAt: string;
  };

  const { data: resources = [] } = useQuery<OpportunityResourceWithUser[]>({
    queryKey: ["/api/opportunities", opportunityId, "resources"],
    enabled: !!opportunityId,
  });

  const addResourceMutation = useMutation({
    mutationFn: async ({ userId, role }: { userId: string; role: string }) => {
      const res = await apiRequest("POST", `/api/opportunities/${opportunityId}/resources`, { userId, role });
      return await res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/opportunities", opportunityId, "resources"] });
      toast({ title: "Resource assigned successfully" });
      setNewResourceUserId("");
      setNewResourceRole("");
    },
    onError: (error: Error) => {
      toast({ title: "Failed to assign resource", description: error.message, variant: "destructive" });
    },
  });

  const removeResourceMutation = useMutation({
    mutationFn: async (resourceId: string) => {
      const res = await apiRequest("DELETE", `/api/opportunity-resources/${resourceId}`);
      return await res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/opportunities", opportunityId, "resources"] });
      toast({ title: "Resource removed successfully" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to remove resource", description: error.message, variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (data: InsertOpportunity & { id: string }) => {
      const res = await apiRequest("PATCH", `/api/opportunities/${data.id}`, data);
      return await res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/opportunities", opportunityId] });
      queryClient.invalidateQueries({ queryKey: ["/api/opportunities"] });
      toast({ title: "Opportunity updated successfully" });
      setIsEditDialogOpen(false);
    },
    onError: (error: Error) => {
      toast({ title: "Failed to update opportunity", description: error.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("DELETE", `/api/opportunities/${opportunityId}`);
      return await res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/opportunities"] });
      toast({ title: "Opportunity deleted successfully" });
      setLocation("/opportunities");
    },
    onError: (error: Error) => {
      toast({ title: "Failed to delete opportunity", description: error.message, variant: "destructive" });
    },
  });

  const createActivityMutation = useMutation({
    mutationFn: async (data: InsertActivity) => {
      const res = await apiRequest("POST", "/api/activities", data);
      return await res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/activities"] });
      queryClient.invalidateQueries({ queryKey: ["/api/opportunities", opportunityId, "related"] });
      toast({ title: "Activity created successfully" });
      setIsCreateActivityDialogOpen(false);
      activityForm.reset();
    },
    onError: (error: Error) => {
      toast({ title: "Failed to create activity", description: error.message, variant: "destructive" });
    },
  });

  // Extend schema to accept date strings from inputs (all date fields)
  const formSchema = insertOpportunitySchema.extend({
    closeDate: z.union([z.date(), z.string(), z.null()]).optional(),
    actualCloseDate: z.union([z.date(), z.string(), z.null()]).optional(),
    estCloseDate: z.union([z.date(), z.string(), z.null()]).optional(),
    implementationStartDate: z.union([z.date(), z.string(), z.null()]).optional(),
    implementationEndDate: z.union([z.date(), z.string(), z.null()]).optional(),
  });

  const form = useForm<InsertOpportunity>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      id: "",
      name: "",
      accountId: "",
      stage: "prospecting",
      amount: "0",
      probability: 0,
      ownerId: "",
      closeDate: null,
      status: null,
      actualCloseDate: null,
      actualRevenue: null,
      estCloseDate: null,
      estRevenue: null,
      rating: null,
      includeInForecast: true,
      implementationStartDate: null,
      implementationEndDate: null,
    },
  });

  const activityFormSchema = insertActivitySchema.omit({ id: true }).extend({
    dueAt: z.union([z.date(), z.string(), z.null()]).optional(),
    completedAt: z.union([z.date(), z.string(), z.null()]).optional(),
    ownerId: z.string().nullable().optional(),
    notes: z.string().nullable().optional(),
  });

  const activityForm = useForm({
    resolver: zodResolver(activityFormSchema),
    defaultValues: {
      type: "task" as const,
      subject: "",
      status: "pending" as const,
      priority: "medium" as const,
      dueAt: null,
      completedAt: null,
      ownerId: null,
      relatedType: "Opportunity",
      relatedId: opportunityId || "",
      notes: null,
    },
  });

  const onActivitySubmit = (data: any) => {
    // Convert date strings to Date objects for the API and handle optional fields
    const submitData: any = { ...data };

    // Remove id field if it exists (backend will auto-generate)
    delete submitData.id;

    // Convert dueAt from string to Date object, or empty string to null
    if (submitData.dueAt === '' || (typeof submitData.dueAt === 'string' && submitData.dueAt.trim() === '')) {
      submitData.dueAt = null;
    } else if (submitData.dueAt && typeof submitData.dueAt === 'string') {
      submitData.dueAt = new Date(submitData.dueAt);
    }

    // Convert completedAt from string to Date object, or empty string to null
    if (submitData.completedAt === '' || (typeof submitData.completedAt === 'string' && submitData.completedAt.trim() === '')) {
      submitData.completedAt = null;
    } else if (submitData.completedAt && typeof submitData.completedAt === 'string') {
      submitData.completedAt = new Date(submitData.completedAt);
    }

    // Convert empty strings and undefined to null for optional fields
    if (!submitData.ownerId || submitData.ownerId === '' || submitData.ownerId === undefined) {
      submitData.ownerId = null;
    }

    if (!submitData.notes || submitData.notes === '' || submitData.notes === undefined) {
      submitData.notes = null;
    }

    createActivityMutation.mutate(submitData);
  };

  const onSubmit = (data: InsertOpportunity) => {
    if (opportunity) {
      // Convert date strings to Date objects for the API
      const submitData: any = { ...data, id: opportunity.id };
      
      // Convert all date fields from strings to Date objects
      // Also handle empty strings by converting them to null
      if (submitData.closeDate) {
        if (typeof submitData.closeDate === 'string' && submitData.closeDate !== '') {
          submitData.closeDate = new Date(submitData.closeDate);
        } else if (submitData.closeDate === '') {
          submitData.closeDate = null;
        }
      }
      
      if (submitData.actualCloseDate) {
        if (typeof submitData.actualCloseDate === 'string' && submitData.actualCloseDate !== '') {
          submitData.actualCloseDate = new Date(submitData.actualCloseDate);
        } else if (submitData.actualCloseDate === '') {
          submitData.actualCloseDate = null;
        }
      }
      
      if (submitData.estCloseDate) {
        if (typeof submitData.estCloseDate === 'string' && submitData.estCloseDate !== '') {
          submitData.estCloseDate = new Date(submitData.estCloseDate);
        } else if (submitData.estCloseDate === '') {
          submitData.estCloseDate = null;
        }
      }

      if (submitData.implementationStartDate) {
        if (typeof submitData.implementationStartDate === 'string' && submitData.implementationStartDate !== '') {
          submitData.implementationStartDate = new Date(submitData.implementationStartDate);
        } else if (submitData.implementationStartDate === '') {
          submitData.implementationStartDate = null;
        }
      }

      if (submitData.implementationEndDate) {
        if (typeof submitData.implementationEndDate === 'string' && submitData.implementationEndDate !== '') {
          submitData.implementationEndDate = new Date(submitData.implementationEndDate);
        } else if (submitData.implementationEndDate === '') {
          submitData.implementationEndDate = null;
        }
      }
      
      updateMutation.mutate(submitData);
    }
  };

  const handleEdit = () => {
    if (opportunity) {
      // Convert Date objects to YYYY-MM-DD strings for date inputs
      const toDateValue = (date: Date | string | null | undefined): Date | null => {
        if (!date) return null;
        try {
          const d = date instanceof Date ? date : new Date(date);
          if (!isNaN(d.getTime())) return d;
        } catch (_e) {}
        return null;
      };

      form.reset({
        id: opportunity.id,
        name: opportunity.name,
        accountId: opportunity.accountId,
        stage: opportunity.stage,
        amount: opportunity.amount || "0",
        probability: opportunity.probability || 0,
        ownerId: opportunity.ownerId,
        closeDate: toDateValue(opportunity.closeDate),
        status: opportunity.status || null,
        actualCloseDate: toDateValue(opportunity.actualCloseDate),
        actualRevenue: opportunity.actualRevenue || null,
        estCloseDate: toDateValue(opportunity.estCloseDate),
        estRevenue: opportunity.estRevenue || null,
        rating: opportunity.rating || null,
        includeInForecast: opportunity.includeInForecast ?? true,
        implementationStartDate: toDateValue(opportunity.implementationStartDate),
        implementationEndDate: toDateValue(opportunity.implementationEndDate),
      });
      setIsEditDialogOpen(true);
    }
  };

  if (oppLoading || relatedLoading || tagsLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!opportunity) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-muted-foreground">Opportunity not found</p>
      </div>
    );
  }

  const getStageVariant = (stage: string) => {
    const lowerStage = stage.toLowerCase();
    if (lowerStage.includes("closed won")) return "default";
    if (lowerStage.includes("closed lost")) return "destructive";
    return "secondary";
  };

  const account = relatedData?.account.items[0];

  return (
    <DetailPageLayout
      title={opportunity.name}
      subtitle={opportunity.id}
      backLink="/opportunities"
      backLabel="Opportunities"
      status={opportunity.stage}
      statusVariant={getStageVariant(opportunity.stage)}
      onEdit={handleEdit}
      onDelete={() => setIsDeleteDialogOpen(true)}
      onLogActivity={() => setIsLogActivityOpen(true)}
      entityType="opportunity"
      entityId={opportunityId || ""}
    >
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <DetailSection title="Opportunity Information">
            <DetailField label="Opportunity Name" value={opportunity.name} />
            <DetailField label="Opportunity ID" value={opportunity.id} />
            <DetailField label="Stage" value={opportunity.stage} />
            <DetailField label="Status" value={opportunity.status} />
            <DetailField label="Rating" value={opportunity.rating} />
            <DetailField label="Amount" value={opportunity.amount} type="currency" />
            <DetailField label="Probability" value={opportunity.probability} type="percent" />
            <DetailField label="Close Date" value={opportunity.closeDate} type="date" />
            <DetailField label="Impl. Start Date" value={opportunity.implementationStartDate} type="date" />
            <DetailField label="Impl. End Date" value={opportunity.implementationEndDate} type="date" />
            <div className="col-span-1">
              <label className="text-sm font-medium text-muted-foreground">Assigned Rep</label>
              <div className="mt-1 flex items-center gap-2" data-testid="field-assigned-rep">
                {(() => {
                  const owner = users.find((u) => u.id === opportunity.ownerId);
                  if (owner) {
                    const initials = owner.name
                      .split(" ")
                      .map((n) => n[0])
                      .join("")
                      .toUpperCase()
                      .slice(0, 2);
                    return (
                      <>
                        <Avatar className="h-6 w-6">
                          <AvatarFallback className="text-xs">{initials}</AvatarFallback>
                        </Avatar>
                        <span className="text-sm">{owner.name}</span>
                      </>
                    );
                  }
                  return <span className="text-sm text-muted-foreground">Unassigned</span>;
                })()}
              </div>
            </div>
            <div className="col-span-full">
              <label className="text-sm font-medium text-muted-foreground">Forecast Status</label>
              <div className="mt-1">
                {opportunity.includeInForecast !== false ? (
                  <Badge variant="outline" className="text-xs" data-testid="badge-forecast-included">
                    ✓ Included in forecast
                  </Badge>
                ) : (
                  <div className="space-y-1">
                    <Badge variant="secondary" className="text-xs" data-testid="badge-forecast-excluded">
                      Excluded from forecast
                    </Badge>
                    <p className="text-xs text-muted-foreground">
                      This opportunity is excluded from all sales metrics, dashboards, and forecast reports.
                    </p>
                  </div>
                )}
              </div>
            </div>
          </DetailSection>

          <Card data-testid="section-tags">
            <CardHeader>
              <CardTitle>Tags</CardTitle>
            </CardHeader>
            <CardContent>
              <TagSelector
                selectedTags={tags}
                onTagsChange={setSelectedTags}
                entity="opportunities"
                entityId={opportunity.id}
              />
            </CardContent>
          </Card>

          <Card data-testid="section-resources">
            <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
              <CardTitle className="flex items-center gap-2">
                <Users className="h-4 w-4" />
                Assigned Resources
              </CardTitle>
            </CardHeader>
            <CardContent>
              {resources.length > 0 ? (
                <div className="space-y-2 mb-4">
                  {resources.map(r => (
                    <div key={r.id} className="flex items-center justify-between gap-2 py-1.5" data-testid={`resource-item-${r.id}`}>
                      <div className="flex items-center gap-2 min-w-0">
                        <Avatar className="h-7 w-7 shrink-0">
                          <AvatarFallback className="text-[10px]">
                            {r.userName.split(" ").map(n => n[0]).join("").toUpperCase().slice(0, 2)}
                          </AvatarFallback>
                        </Avatar>
                        <div className="min-w-0">
                          <p className="text-sm font-medium truncate">{r.userName}</p>
                          <p className="text-xs text-muted-foreground truncate">{r.role}</p>
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => removeResourceMutation.mutate(r.id)}
                        disabled={removeResourceMutation.isPending}
                        data-testid={`button-remove-resource-${r.id}`}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground mb-4" data-testid="text-no-resources">No resources assigned yet.</p>
              )}

              <div className="space-y-2 border-t pt-3">
                <p className="text-xs font-medium text-muted-foreground">Add Resource</p>
                <Popover open={resourceUserSearchOpen} onOpenChange={setResourceUserSearchOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      role="combobox"
                      className={cn("w-full justify-between", !newResourceUserId && "text-muted-foreground")}
                      data-testid="input-resource-user"
                    >
                      {newResourceUserId
                        ? users.find(u => u.id === newResourceUserId)?.name || "Select user"
                        : "Select user..."}
                      <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-[300px] p-0" align="start">
                    <Command>
                      <CommandInput placeholder="Search users..." />
                      <CommandList>
                        <CommandEmpty>No user found.</CommandEmpty>
                        <CommandGroup>
                          {users.map(u => (
                            <CommandItem
                              key={u.id}
                              value={`${u.name} ${u.id}`}
                              onSelect={() => {
                                setNewResourceUserId(u.id);
                                setResourceUserSearchOpen(false);
                              }}
                              data-testid={`resource-user-option-${u.id}`}
                            >
                              <Check className={cn("mr-2 h-4 w-4", newResourceUserId === u.id ? "opacity-100" : "opacity-0")} />
                              {u.name}
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
                <Select value={newResourceRole} onValueChange={setNewResourceRole}>
                  <SelectTrigger data-testid="select-resource-role">
                    <SelectValue placeholder="Select role..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Product Developer">Product Developer</SelectItem>
                    <SelectItem value="Architect">Architect</SelectItem>
                    <SelectItem value="Tech Lead">Tech Lead</SelectItem>
                    <SelectItem value="Project Manager">Project Manager</SelectItem>
                    <SelectItem value="Business Analyst">Business Analyst</SelectItem>
                    <SelectItem value="QA Engineer">QA Engineer</SelectItem>
                  </SelectContent>
                </Select>
                <Button
                  className="w-full"
                  disabled={!newResourceUserId || !newResourceRole || addResourceMutation.isPending}
                  onClick={() => addResourceMutation.mutate({ userId: newResourceUserId, role: newResourceRole })}
                  data-testid="button-add-resource"
                >
                  <Plus className="h-4 w-4 mr-1" />
                  {addResourceMutation.isPending ? "Adding..." : "Add Resource"}
                </Button>
              </div>
            </CardContent>
          </Card>

          <CommentSystem entity="opportunities" entityId={opportunity.id} />
        </div>

        <div className="space-y-6">
          {account && (
            <RelatedEntitiesSection
              title="Account"
              entities={[account]}
              entityType="accounts"
              emptyMessage="No account associated"
            />
          )}

          <RelatedEntitiesSection
            title="Contacts"
            entities={relatedData?.contacts.items || []}
            entityType="contacts"
            emptyMessage="No contacts found"
            onAdd={() => { setQuickAddTab("contact"); setIsQuickAddOpen(true); }}
          />

          <RelatedEntitiesSection
            title="Activities"
            entities={relatedData?.activities.items || []}
            entityType="activities"
            emptyMessage="No activities logged"
            onAdd={() => { setQuickAddTab("activity"); setIsQuickAddOpen(true); }}
          />
        </div>
      </div>

      {/* Edit Dialog */}
      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Opportunity</DialogTitle>
            <DialogDescription>Update opportunity details</DialogDescription>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Opportunity Name *</FormLabel>
                    <FormControl>
                      <Input placeholder="Q1 Healthcare Software License" {...field} data-testid="input-edit-opportunity-name" />
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
                      <Input placeholder="ACT-1002" {...field} data-testid="input-edit-opportunity-account" />
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
                        <Input type="number" placeholder="50000" {...field} value={field.value || ""} data-testid="input-edit-opportunity-amount" />
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
                        <Input
                          type="number"
                          min="0"
                          max="100"
                          placeholder="50"
                          {...field}
                          value={field.value || 0}
                          onChange={(e) => field.onChange(Number(e.target.value))}
                          data-testid="input-edit-opportunity-probability"
                        />
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
                    <FormLabel>Stage *</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value} data-testid="select-edit-opportunity-stage">
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select stage" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="prospecting">Prospecting</SelectItem>
                        <SelectItem value="qualification">Qualification</SelectItem>
                        <SelectItem value="proposal">Proposal</SelectItem>
                        <SelectItem value="negotiation">Negotiation</SelectItem>
                        <SelectItem value="closed_won">Closed Won</SelectItem>
                        <SelectItem value="closed_lost">Closed Lost</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="ownerId"
                render={({ field }) => (
                  <FormItem className="flex flex-col">
                    <FormLabel>Assigned Rep</FormLabel>
                    <Popover open={editRepSearchOpen} onOpenChange={setEditRepSearchOpen}>
                      <PopoverTrigger asChild>
                        <FormControl>
                          <Button
                            variant="outline"
                            role="combobox"
                            aria-expanded={editRepSearchOpen}
                            className={cn(
                              "w-full justify-between",
                              !field.value && "text-muted-foreground"
                            )}
                            data-testid="input-edit-opportunity-rep"
                          >
                            {field.value
                              ? users.find((u) => u.id === field.value)?.name || field.value
                              : "Search for a sales rep..."}
                            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                          </Button>
                        </FormControl>
                      </PopoverTrigger>
                      <PopoverContent className="w-[400px] p-0" align="start">
                        <Command>
                          <CommandInput placeholder="Search by name..." />
                          <CommandList>
                            <CommandEmpty>No user found.</CommandEmpty>
                            <CommandGroup>
                              {users.map((u) => (
                                <CommandItem
                                  key={u.id}
                                  value={`${u.name} ${u.id}`}
                                  onSelect={() => {
                                    form.setValue("ownerId", u.id);
                                    setEditRepSearchOpen(false);
                                  }}
                                  data-testid={`edit-rep-option-${u.id}`}
                                >
                                  <Check
                                    className={cn(
                                      "mr-2 h-4 w-4",
                                      field.value === u.id ? "opacity-100" : "opacity-0"
                                    )}
                                  />
                                  <span>{u.name}</span>
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
              <FormField
                control={form.control}
                name="rating"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Rating</FormLabel>
                    <Select 
                      onValueChange={(value) => field.onChange(value === "none" ? null : value)} 
                      value={field.value || "none"} 
                      data-testid="select-edit-opportunity-rating"
                    >
                      <FormControl>
                        <SelectTrigger>
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
                name="closeDate"
                render={({ field }) => {
                  // Safely convert field value to date string for input
                  let dateString = "";
                  if (field.value) {
                    try {
                      const date = field.value instanceof Date ? field.value : new Date(field.value);
                      if (!isNaN(date.getTime())) {
                        dateString = date.toISOString().split('T')[0];
                      }
                    } catch (e) {
                      // Invalid date, use empty string
                    }
                  }
                  
                  return (
                    <FormItem>
                      <FormLabel>Close Date *</FormLabel>
                      <FormControl>
                        <Input
                          type="date"
                          value={dateString}
                          onChange={(e) => {
                            // Keep as string - will be converted to Date in onSubmit
                            const dateValue = e.target.value;
                            field.onChange(dateValue || null);
                          }}
                          data-testid="input-edit-opportunity-closedate"
                          required
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  );
                }}
              />
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="implementationStartDate"
                  render={({ field }) => {
                    let dateString = "";
                    if (field.value) {
                      try {
                        const date = field.value instanceof Date ? field.value : new Date(field.value as string);
                        if (!isNaN(date.getTime())) {
                          dateString = date.toISOString().split('T')[0];
                        }
                      } catch (e) {}
                    }
                    return (
                      <FormItem>
                        <FormLabel>Implementation Start</FormLabel>
                        <FormControl>
                          <Input
                            type="date"
                            value={dateString}
                            onChange={e => field.onChange(e.target.value || null)}
                            data-testid="input-edit-impl-start-date"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    );
                  }}
                />
                <FormField
                  control={form.control}
                  name="implementationEndDate"
                  render={({ field }) => {
                    let dateString = "";
                    if (field.value) {
                      try {
                        const date = field.value instanceof Date ? field.value : new Date(field.value as string);
                        if (!isNaN(date.getTime())) {
                          dateString = date.toISOString().split('T')[0];
                        }
                      } catch (e) {}
                    }
                    return (
                      <FormItem>
                        <FormLabel>Implementation End</FormLabel>
                        <FormControl>
                          <Input
                            type="date"
                            value={dateString}
                            onChange={e => field.onChange(e.target.value || null)}
                            data-testid="input-edit-impl-end-date"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    );
                  }}
                />
              </div>
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
                        data-testid="switch-edit-include-in-forecast"
                      />
                    </FormControl>
                  </FormItem>
                )}
              />
              <div className="rounded-lg border p-4 space-y-3" data-testid="section-edit-resources">
                <p className="text-sm font-medium">Assigned Resources</p>
                {resources.length > 0 ? (
                  <div className="space-y-2">
                    {resources.map(r => (
                      <div key={r.id} className="flex items-center justify-between gap-2 py-1" data-testid={`edit-resource-item-${r.id}`}>
                        <div className="flex items-center gap-2 min-w-0">
                          <Avatar className="h-6 w-6 shrink-0">
                            <AvatarFallback className="text-[9px]">
                              {r.userName.split(" ").map(n => n[0]).join("").toUpperCase().slice(0, 2)}
                            </AvatarFallback>
                          </Avatar>
                          <span className="text-sm truncate">{r.userName}</span>
                          <Badge variant="secondary">{r.role}</Badge>
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => removeResourceMutation.mutate(r.id)}
                          disabled={removeResourceMutation.isPending}
                          data-testid={`button-edit-remove-resource-${r.id}`}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground" data-testid="text-edit-no-resources">No resources assigned.</p>
                )}
                <div className="flex flex-wrap items-end gap-2 border-t pt-2">
                  <div className="flex-1 min-w-[140px]">
                    <Select value={newResourceUserId} onValueChange={setNewResourceUserId}>
                      <SelectTrigger data-testid="select-edit-resource-user">
                        <SelectValue placeholder="User..." />
                      </SelectTrigger>
                      <SelectContent>
                        {users.map(u => (
                          <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex-1 min-w-[140px]">
                    <Select value={newResourceRole} onValueChange={setNewResourceRole}>
                      <SelectTrigger data-testid="select-edit-resource-role">
                        <SelectValue placeholder="Role..." />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Product Developer">Product Developer</SelectItem>
                        <SelectItem value="Architect">Architect</SelectItem>
                        <SelectItem value="Tech Lead">Tech Lead</SelectItem>
                        <SelectItem value="Project Manager">Project Manager</SelectItem>
                        <SelectItem value="Business Analyst">Business Analyst</SelectItem>
                        <SelectItem value="QA Engineer">QA Engineer</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    disabled={!newResourceUserId || !newResourceRole || addResourceMutation.isPending}
                    onClick={() => addResourceMutation.mutate({ userId: newResourceUserId, role: newResourceRole })}
                    data-testid="button-edit-add-resource"
                  >
                    <Plus className="h-4 w-4 mr-1" />
                    Add
                  </Button>
                </div>
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setIsEditDialogOpen(false)} data-testid="button-cancel-edit">
                  Cancel
                </Button>
                <Button type="submit" disabled={updateMutation.isPending} data-testid="button-save-edit">
                  {updateMutation.isPending ? "Saving..." : "Save Changes"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* Create Activity Dialog */}
      <Dialog open={isCreateActivityDialogOpen} onOpenChange={setIsCreateActivityDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Create New Activity</DialogTitle>
            <DialogDescription>Add a new activity for this opportunity</DialogDescription>
          </DialogHeader>
          <Form {...activityForm}>
            <form onSubmit={activityForm.handleSubmit(onActivitySubmit)} className="space-y-4">
              <FormField
                control={activityForm.control}
                name="type"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Type *</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger data-testid="select-activity-type">
                          <SelectValue placeholder="Select type" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="call">Call</SelectItem>
                        <SelectItem value="email">Email</SelectItem>
                        <SelectItem value="meeting">Meeting</SelectItem>
                        <SelectItem value="task">Task</SelectItem>
                        <SelectItem value="note">Note</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={activityForm.control}
                name="subject"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Subject *</FormLabel>
                    <FormControl>
                      <Input placeholder="Follow-up call..." {...field} data-testid="input-activity-subject" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={activityForm.control}
                  name="status"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Status *</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger data-testid="select-activity-status">
                            <SelectValue placeholder="Select status" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="pending">Pending</SelectItem>
                          <SelectItem value="completed">Completed</SelectItem>
                          <SelectItem value="cancelled">Cancelled</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={activityForm.control}
                  name="priority"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Priority *</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger data-testid="select-activity-priority">
                            <SelectValue placeholder="Select priority" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="high">High</SelectItem>
                          <SelectItem value="medium">Medium</SelectItem>
                          <SelectItem value="low">Low</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={activityForm.control}
                  name="dueAt"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Due Date</FormLabel>
                      <FormControl>
                        <Input 
                          type="datetime-local" 
                          {...field} 
                          value={field.value ? new Date(field.value).toISOString().slice(0, 16) : ""}
                          onChange={(e) => field.onChange(e.target.value ? new Date(e.target.value).toISOString() : null)}
                          data-testid="input-activity-due-date" 
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={activityForm.control}
                  name="ownerId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Owner</FormLabel>
                      <Select 
                        onValueChange={(value) => field.onChange(value || null)} 
                        value={field.value || undefined}
                      >
                        <FormControl>
                          <SelectTrigger data-testid="select-activity-owner">
                            <SelectValue placeholder="Select owner (optional)" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {users.map((user) => (
                            <SelectItem key={user.id} value={user.id}>
                              {user.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <FormField
                control={activityForm.control}
                name="notes"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Notes</FormLabel>
                    <FormControl>
                      <Textarea placeholder="Add additional details..." {...field} value={field.value || ""} data-testid="input-activity-notes" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setIsCreateActivityDialogOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={createActivityMutation.isPending} data-testid="button-submit-activity">
                  {createActivityMutation.isPending ? "Creating..." : "Create Activity"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {opportunityId && (
        <QuickLogActivity
          open={isLogActivityOpen}
          onOpenChange={setIsLogActivityOpen}
          relatedType="Opportunity"
          relatedId={opportunityId}
          relatedName={opportunity.name}
        />
      )}

      <GlobalQuickAdd
        open={isQuickAddOpen}
        onOpenChange={setIsQuickAddOpen}
        defaultTab={quickAddTab}
        context={{ opportunityId: opportunityId || undefined, accountId: opportunity.accountId || undefined, primaryEntityType: "Opportunity", primaryEntityId: opportunityId || undefined }}
      />

      <AlertDialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you sure?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete the opportunity "{opportunity.name}". This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteMutation.mutate()}
              disabled={deleteMutation.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="button-confirm-delete"
            >
              {deleteMutation.isPending ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </DetailPageLayout>
  );
}
