import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useRoute, useLocation } from "wouter";
import { Loader2, X } from "lucide-react";
import { DetailPageLayout, DetailSection, DetailField } from "@/components/detail-page-layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { Activity, Account, Contact, Opportunity, Lead, InsertActivity } from "@shared/schema";
import { insertActivitySchema } from "@shared/schema";
import { AssociationManager, Association } from "@/components/association-manager";
import { Badge } from "@/components/ui/badge";

interface ActivityAssociation {
  id: string;
  activityId: string;
  entityType: string;
  entityId: string;
  createdAt: string;
  entityName: string;
}

export default function ActivityDetailPage() {
  const [, params] = useRoute("/activities/:id");
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const activityId = params?.id;
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [editAssociations, setEditAssociations] = useState<Association[]>([]);

  const { data: activity, isLoading: activityLoading } = useQuery<Activity>({
    queryKey: ["/api/activities", activityId],
    enabled: !!activityId,
  });

  const { data: relatedData, isLoading: relatedLoading } = useQuery<{
    relatedEntity: {
      type: "Account" | "Contact" | "Opportunity" | "Lead";
      data: Account | Contact | Opportunity | Lead;
    } | null;
  }>({
    queryKey: ["/api/activities", activityId, "related"],
    enabled: !!activityId,
  });

  const { data: associations = [], isLoading: associationsLoading } = useQuery<ActivityAssociation[]>({
    queryKey: ["/api/activities", activityId, "associations"],
    enabled: !!activityId,
  });

  const deleteAssociationMutation = useMutation({
    mutationFn: async (associationId: string) => {
      await apiRequest("DELETE", `/api/activity-associations/${associationId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/activities", activityId, "associations"] });
      toast({ title: "Association removed successfully" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to remove association", description: error.message, variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (data: Partial<InsertActivity>) => {
      const res = await apiRequest("PATCH", `/api/activities/${activityId}`, data);
      return await res.json();
    },
    onSuccess: async () => {
      // Sync associations
      const currentAssociationIds = new Set(
        associations.map((a) => `${a.entityType}-${a.entityId}`)
      );
      const newAssociationIds = new Set(
        editAssociations.map((a) => `${a.entityType}-${a.entityId}`)
      );

      // Delete removed associations
      for (const assoc of associations) {
        const key = `${assoc.entityType}-${assoc.entityId}`;
        if (!newAssociationIds.has(key)) {
          try {
            await apiRequest("DELETE", `/api/activity-associations/${assoc.id}`);
          } catch (error) {
            console.error("Failed to delete association:", error);
          }
        }
      }

      // Add new associations
      for (const newAssoc of editAssociations) {
        const key = `${newAssoc.entityType}-${newAssoc.entityId}`;
        if (!currentAssociationIds.has(key)) {
          try {
            await apiRequest("POST", `/api/activities/${activityId}/associations`, {
              entityType: newAssoc.entityType,
              entityId: newAssoc.entityId,
            });
          } catch (error) {
            console.error("Failed to create association:", error);
          }
        }
      }

      queryClient.invalidateQueries({ queryKey: ["/api/activities", activityId] });
      queryClient.invalidateQueries({ queryKey: ["/api/activities"] });
      queryClient.invalidateQueries({ queryKey: ["/api/activities", activityId, "associations"] });
      toast({ title: "Activity updated successfully" });
      setIsEditDialogOpen(false);
    },
    onError: (error: Error) => {
      toast({ title: "Failed to update activity", description: error.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("DELETE", `/api/activities/${activityId}`);
      return await res.json();
    },
    onSuccess: () => {
      toast({ title: "Activity deleted successfully" });
      setLocation("/activities");
    },
    onError: (error: Error) => {
      toast({ title: "Failed to delete activity", description: error.message, variant: "destructive" });
    },
  });

  const form = useForm<InsertActivity>({
    resolver: zodResolver(insertActivitySchema),
    defaultValues: {
      id: activity?.id || "",
      type: activity?.type || "call",
      subject: activity?.subject || "",
      status: activity?.status || "pending",
      priority: activity?.priority || "medium",
      dueAt: activity?.dueAt || null,
      completedAt: activity?.completedAt || null,
      ownerId: activity?.ownerId || "",
      relatedType: activity?.relatedType || "",
      relatedId: activity?.relatedId || "",
      notes: activity?.notes || "",
    },
  });

  const onSubmit = (data: InsertActivity) => {
    const submitData = {
      ...data,
      dueAt: data.dueAt ? new Date(data.dueAt).toISOString() : null,
      completedAt: data.completedAt ? new Date(data.completedAt).toISOString() : null,
    };
    updateMutation.mutate(submitData as any);
  };

  if (activityLoading || relatedLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!activity) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-muted-foreground">Activity not found</p>
      </div>
    );
  }

  const getStatusVariant = (status: string) => {
    if (status === "completed") return "default";
    if (status === "in_progress") return "secondary";
    return "outline";
  };

  const getRelatedEntityInfo = () => {
    if (!relatedData?.relatedEntity) return null;

    const { type, data } = relatedData.relatedEntity;
    
    if (type === "Account") {
      const account = data as Account;
      return {
        type: "Account",
        name: account.name,
        link: `/accounts/${account.id}`,
      };
    } else if (type === "Contact") {
      const contact = data as Contact;
      return {
        type: "Contact",
        name: `${contact.firstName} ${contact.lastName}`,
        link: `/contacts/${contact.id}`,
      };
    } else if (type === "Opportunity") {
      const opp = data as Opportunity;
      return {
        type: "Opportunity",
        name: opp.name,
        link: `/opportunities/${opp.id}`,
      };
    } else if (type === "Lead") {
      const lead = data as Lead;
      return {
        type: "Lead",
        name: `${lead.firstName} ${lead.lastName}`,
        link: `/leads/${lead.id}`,
      };
    }
    return null;
  };

  const relatedEntityInfo = getRelatedEntityInfo();

  return (
    <DetailPageLayout
      title={activity.subject}
      subtitle={activity.id}
      backLink="/activities"
      backLabel="Activities"
      status={activity.status}
      statusVariant={getStatusVariant(activity.status)}
      onEdit={() => {
        form.reset({
          id: activity.id,
          type: activity.type,
          subject: activity.subject,
          status: activity.status,
          priority: activity.priority,
          dueAt: activity.dueAt ? new Date(activity.dueAt).toISOString().split('T')[0] : null,
          completedAt: activity.completedAt ? new Date(activity.completedAt).toISOString().split('T')[0] : null,
          ownerId: activity.ownerId,
          relatedType: activity.relatedType || "",
          relatedId: activity.relatedId || "",
          notes: activity.notes || "",
        } as any);
        setEditAssociations(
          associations.map((a) => ({
            entityType: a.entityType,
            entityId: a.entityId,
            displayName: a.entityName,
          }))
        );
        setIsEditDialogOpen(true);
      }}
      onDelete={() => {
        setIsDeleteDialogOpen(true);
      }}
    >
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <DetailSection title="Activity Information">
            <DetailField label="Subject" value={activity.subject} />
            <DetailField label="Activity ID" value={activity.id} />
            <DetailField label="Type" value={activity.type} />
            <DetailField label="Status" value={activity.status} />
            <DetailField label="Priority" value={activity.priority} />
            <DetailField label="Due Date" value={activity.dueAt ? new Date(activity.dueAt).toISOString() : null} type="date" />
          </DetailSection>

          {activity.notes && (
            <DetailSection title="Notes">
              <div className="col-span-full">
                <p className="text-sm whitespace-pre-wrap">{activity.notes}</p>
              </div>
            </DetailSection>
          )}
        </div>

        <div className="space-y-6">
          {relatedEntityInfo && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg font-semibold">Related {relatedEntityInfo.type}</CardTitle>
              </CardHeader>
              <CardContent>
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full justify-start"
                  onClick={() => setLocation(relatedEntityInfo.link)}
                  data-testid={`link-related-${relatedEntityInfo.type.toLowerCase()}`}
                >
                  {relatedEntityInfo.name}
                </Button>
              </CardContent>
            </Card>
          )}

          {associations.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg font-semibold">Associated Records</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {associations.map((assoc) => (
                    <div key={assoc.id} className="flex items-center justify-between p-2 border rounded-md">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline">{assoc.entityType}</Badge>
                        <Button
                          variant="link"
                          size="sm"
                          className="h-auto p-0 text-sm"
                          onClick={() => setLocation(`/${assoc.entityType.toLowerCase()}s/${assoc.entityId}`)}
                          data-testid={`link-association-${assoc.id}`}
                        >
                          {assoc.entityName}
                        </Button>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => deleteAssociationMutation.mutate(assoc.id)}
                        data-testid={`button-delete-association-${assoc.id}`}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* Edit Dialog */}
      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Edit Activity</DialogTitle>
            <DialogDescription>Make changes to the activity</DialogDescription>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField
                control={form.control}
                name="type"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Type *</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger data-testid="select-edit-activity-type">
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
                control={form.control}
                name="subject"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Subject *</FormLabel>
                    <FormControl>
                      <Input placeholder="Follow-up call with client" {...field} data-testid="input-edit-activity-subject" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="grid grid-cols-3 gap-4">
                <FormField
                  control={form.control}
                  name="status"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Status *</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger data-testid="select-edit-activity-status">
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
                  control={form.control}
                  name="priority"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Priority *</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger data-testid="select-edit-activity-priority">
                            <SelectValue placeholder="Select priority" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="low">Low</SelectItem>
                          <SelectItem value="medium">Medium</SelectItem>
                          <SelectItem value="high">High</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="dueAt"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Due Date</FormLabel>
                      <FormControl>
                        <Input 
                          type="date" 
                          value={field.value || ""}
                          onChange={(e) => field.onChange(e.target.value || null)}
                          data-testid="input-edit-activity-due-date"
                          className="w-full"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="relatedType"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Related To</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value || undefined}>
                        <FormControl>
                          <SelectTrigger data-testid="select-edit-related-type">
                            <SelectValue placeholder="Select type" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="Account">Account</SelectItem>
                          <SelectItem value="Contact">Contact</SelectItem>
                          <SelectItem value="Lead">Lead</SelectItem>
                          <SelectItem value="Opportunity">Opportunity</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="relatedId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Related ID</FormLabel>
                      <FormControl>
                        <Input placeholder="ACCT-2025-00001" {...field} value={field.value || ""} data-testid="input-edit-related-id" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <FormField
                control={form.control}
                name="notes"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Notes</FormLabel>
                    <FormControl>
                      <Textarea placeholder="Add additional details..." {...field} value={field.value || ""} data-testid="input-edit-activity-notes" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <AssociationManager
                associations={editAssociations}
                onChange={setEditAssociations}
                className="mt-4"
              />
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setIsEditDialogOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={updateMutation.isPending} data-testid="button-submit-edit-activity">
                  {updateMutation.isPending ? "Updating..." : "Update Activity"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Activity</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this activity? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteMutation.mutate()}
              disabled={deleteMutation.isPending}
              data-testid="button-confirm-delete"
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteMutation.isPending ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </DetailPageLayout>
  );
}
