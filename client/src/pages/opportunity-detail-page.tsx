import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useRoute, useLocation } from "wouter";
import { Loader2, Calendar, Phone, Mail, MessageSquare, CheckSquare, FileText } from "lucide-react";
import { DetailPageLayout, DetailSection, DetailField } from "@/components/detail-page-layout";
import { RelatedEntitiesSection } from "@/components/related-entities-section";
import { CommentSystem } from "@/components/comment-system";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { TagSelector } from "@/components/tag-selector";
import type { Tag } from "@/components/ui/tag-badge";
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

  const { data: opportunity, isLoading: oppLoading } = useQuery<Opportunity>({
    queryKey: ["/api/opportunities", opportunityId],
    enabled: !!opportunityId,
  });

  const { data: tags = [], isLoading: tagsLoading } = useQuery<Tag[]>({
    queryKey: ["tags", "opportunities", opportunityId],
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
    },
  });

  const activityFormSchema = insertActivitySchema.extend({
    dueAt: z.union([z.date(), z.string(), z.null()]).optional(),
  });

  const activityForm = useForm<InsertActivity>({
    resolver: zodResolver(activityFormSchema),
    defaultValues: {
      id: "",
      type: "task",
      subject: "",
      status: "pending",
      priority: "medium",
      dueAt: null,
      ownerId: "",
      relatedType: "Opportunity",
      relatedId: opportunityId || "",
      notes: "",
    },
  });

  const onActivitySubmit = (data: InsertActivity) => {
    // Convert date strings to Date objects for the API
    const submitData: any = { ...data };

    // Convert dueAt from string to Date object
    if (submitData.dueAt) {
      if (typeof submitData.dueAt === 'string' && submitData.dueAt !== '') {
        submitData.dueAt = new Date(submitData.dueAt);
      } else if (submitData.dueAt === '') {
        submitData.dueAt = null;
      }
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
      
      updateMutation.mutate(submitData);
    }
  };

  const handleEdit = () => {
    if (opportunity) {
      // Convert Date objects to YYYY-MM-DD strings for date inputs
      const formatDate = (date: Date | null) => {
        if (!date) return null;
        try {
          const d = date instanceof Date ? date : new Date(date);
          if (!isNaN(d.getTime())) {
            return d.toISOString().split('T')[0];
          }
        } catch (e) {
          // Invalid date
        }
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
        closeDate: formatDate(opportunity.closeDate) as any,
        status: opportunity.status || null,
        actualCloseDate: formatDate(opportunity.actualCloseDate) as any,
        actualRevenue: opportunity.actualRevenue || null,
        estCloseDate: formatDate(opportunity.estCloseDate) as any,
        estRevenue: opportunity.estRevenue || null,
        rating: opportunity.rating || null,
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
          </DetailSection>

          {(opportunity.externalId || opportunity.sourceSystem) && (
            <DetailSection title="Import Information">
              <DetailField label="External ID" value={opportunity.externalId} />
              <DetailField label="Source System" value={opportunity.sourceSystem} />
              <DetailField label="Source Record ID" value={opportunity.sourceRecordId} />
              <DetailField label="Import Status" value={opportunity.importStatus} />
              {opportunity.importNotes && (
                <div className="col-span-full">
                  <p className="text-sm text-muted-foreground">{opportunity.importNotes}</p>
                </div>
              )}
            </DetailSection>
          )}

          {opportunity.description && (
            <DetailSection title="Description">
              <div className="col-span-full">
                <p className="text-sm whitespace-pre-wrap">{opportunity.description}</p>
              </div>
            </DetailSection>
          )}

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

          <CommentSystem entityType="Opportunity" entityId={opportunity.id} />
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
          />

          <RelatedEntitiesSection
            title="Activities"
            entities={relatedData?.activities.items || []}
            entityType="activities"
            emptyMessage="No activities logged"
            onAdd={() => {
              // Reset form with opportunity pre-filled
              activityForm.reset({
                id: "",
                type: "task",
                subject: "",
                status: "pending",
                priority: "medium",
                dueAt: null,
                ownerId: "",
                relatedType: "Opportunity",
                relatedId: opportunityId || "",
                notes: "",
              });
              setIsCreateActivityDialogOpen(true);
            }}
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
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
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
                      <FormLabel>Close Date</FormLabel>
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
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  );
                }}
              />
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
                      <FormLabel>Owner *</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value || undefined}>
                        <FormControl>
                          <SelectTrigger data-testid="select-activity-owner">
                            <SelectValue placeholder="Select owner" />
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
