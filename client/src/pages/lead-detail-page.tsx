import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useRoute, useLocation } from "wouter";
import { Loader2, ArrowRight } from "lucide-react";
import { DetailPageLayout, DetailSection, DetailField } from "@/components/detail-page-layout";
import { RelatedEntitiesSection } from "@/components/related-entities-section";
import { CommentSystem } from "@/components/comment-system";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { TagSelector } from "@/components/tag-selector";
import type { Tag } from "@/components/ui/tag-badge";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import type { Lead, Activity, Account, Contact, Opportunity, InsertLead } from "@shared/schema";
import { insertLeadSchema } from "@shared/schema";

export default function LeadDetailPage() {
  const [, params] = useRoute("/leads/:id");
  const [, setLocation] = useLocation();
  const leadId = params?.id;
  const { toast } = useToast();
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [selectedTags, setSelectedTags] = useState<Tag[]>([]);

  const { data: lead, isLoading: leadLoading } = useQuery<Lead>({
    queryKey: ["/api/leads", leadId],
    enabled: !!leadId,
  });

  const { data: tags = [], isLoading: tagsLoading } = useQuery<Tag[]>({
    queryKey: ["tags", "leads", leadId],
    queryFn: async () => {
      const res = await fetch(`/api/leads/${leadId}/tags`);
      if (!res.ok) throw new Error("Failed to fetch tags");
      return res.json();
    },
    enabled: !!leadId,
  });

  const { data: relatedData, isLoading: relatedLoading } = useQuery<{
    activities: { items: Activity[]; total: number };
    convertedAccount?: Account;
    convertedContact?: Contact;
    convertedOpportunity?: Opportunity;
  }>({
    queryKey: ["/api/leads", leadId, "related"],
    enabled: !!leadId,
  });

  // Edit mutation
  const editMutation = useMutation({
    mutationFn: async (data: InsertLead) => {
      const res = await apiRequest("PATCH", `/api/leads/${leadId}`, data);
      return await res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/leads", leadId] });
      queryClient.invalidateQueries({ queryKey: ["/api/leads"] });
      toast({ title: "Lead updated successfully" });
      setIsEditDialogOpen(false);
    },
    onError: (error: Error) => {
      toast({ title: "Failed to update lead", description: error.message, variant: "destructive" });
    },
  });

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("DELETE", `/api/leads/${leadId}`);
      return await res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/leads"] });
      toast({ title: "Lead deleted successfully" });
      setLocation("/leads");
    },
    onError: (error: Error) => {
      toast({ title: "Failed to delete lead", description: error.message, variant: "destructive" });
    },
  });

  // Form for editing
  const form = useForm<InsertLead>({
    resolver: zodResolver(insertLeadSchema),
    defaultValues: {
      id: "",
      firstName: "",
      lastName: "",
      company: "",
      email: "",
      phone: "",
      topic: "",
      status: "new",
      source: undefined,
      rating: undefined,
      ownerId: undefined,
    },
  });

  // Update form when lead data loads or dialog opens
  useEffect(() => {
    if (lead && isEditDialogOpen) {
      form.reset({
        id: lead.id,
        firstName: lead.firstName,
        lastName: lead.lastName,
        company: lead.company || "",
        email: lead.email || "",
        phone: lead.phone || "",
        topic: lead.topic || "",
        status: lead.status,
        source: lead.source || undefined,
        rating: lead.rating || undefined,
        ownerId: lead.ownerId || undefined,
      });
    }
  }, [lead, isEditDialogOpen, form]);

  const onSubmitEdit = (data: InsertLead) => {
    editMutation.mutate(data);
  };

  const handleDelete = () => {
    deleteMutation.mutate();
  };

  if (leadLoading || relatedLoading || tagsLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!lead) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-muted-foreground">Lead not found</p>
      </div>
    );
  }

  const fullName = `${lead.firstName} ${lead.lastName}`;
  const isConverted = lead.status === "converted";

  const getStatusVariant = (status: string) => {
    if (status === "converted") return "default";
    if (status === "qualified") return "secondary";
    return "outline";
  };

  return (
    <>
      <DetailPageLayout
        title={fullName}
        subtitle={lead.id}
        backLink="/leads"
        backLabel="Leads"
        status={lead.status}
        statusVariant={getStatusVariant(lead.status)}
        onEdit={() => setIsEditDialogOpen(true)}
        onDelete={() => setIsDeleteDialogOpen(true)}
      >
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            <DetailSection title="Lead Information">
              <DetailField label="First Name" value={lead.firstName} />
              <DetailField label="Last Name" value={lead.lastName} />
              <DetailField label="Lead ID" value={lead.id} />
              <DetailField label="Status" value={lead.status} />
              <DetailField label="Company" value={lead.company} />
              <DetailField label="Email" value={lead.email} type="email" />
              <DetailField label="Phone" value={lead.phone} type="phone" />
              <DetailField label="Topic" value={lead.topic} />
              <DetailField label="Source" value={lead.source} />
            </DetailSection>

            <Card data-testid="section-tags">
              <CardHeader>
                <CardTitle>Tags</CardTitle>
              </CardHeader>
              <CardContent>
                <TagSelector
                  selectedTags={tags}
                  onTagsChange={setSelectedTags}
                  entity="leads"
                  entityId={lead.id}
                />
              </CardContent>
            </Card>

            <CommentSystem entity="leads" entityId={lead.id} />
          </div>

          <div className="space-y-6">
            {!isConverted && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg font-semibold">Actions</CardTitle>
                </CardHeader>
                <CardContent>
                  <Button
                    className="w-full"
                    onClick={() => setLocation(`/lead-conversion?leadId=${lead.id}`)}
                    data-testid="button-convert-lead"
                  >
                    Convert Lead
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </Button>
                </CardContent>
              </Card>
            )}

            {isConverted && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg font-semibold">Conversion Results</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {relatedData?.convertedAccount && (
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">Account Created</p>
                      <Button
                        variant="outline"
                        size="sm"
                        className="w-full justify-start"
                        onClick={() => setLocation(`/accounts/${relatedData.convertedAccount?.id}`)}
                        data-testid="link-converted-account"
                      >
                        {relatedData.convertedAccount.name}
                      </Button>
                    </div>
                  )}
                  {relatedData?.convertedContact && (
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">Contact Created</p>
                      <Button
                        variant="outline"
                        size="sm"
                        className="w-full justify-start"
                        onClick={() => setLocation(`/contacts/${relatedData.convertedContact?.id}`)}
                        data-testid="link-converted-contact"
                      >
                        {`${relatedData.convertedContact.firstName} ${relatedData.convertedContact.lastName}`}
                      </Button>
                    </div>
                  )}
                  {relatedData?.convertedOpportunity && (
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">Opportunity Created</p>
                      <Button
                        variant="outline"
                        size="sm"
                        className="w-full justify-start"
                        onClick={() => setLocation(`/opportunities/${relatedData.convertedOpportunity?.id}`)}
                        data-testid="link-converted-opportunity"
                      >
                        {relatedData.convertedOpportunity.name}
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            <RelatedEntitiesSection
              title="Activities"
              entities={relatedData?.activities.items || []}
              entityType="activities"
              emptyMessage="No activities logged"
            />
          </div>
        </div>
      </DetailPageLayout>

    {/* Edit Dialog */}
    <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit Lead</DialogTitle>
          <DialogDescription>Update lead information</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmitEdit)} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="firstName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>First Name *</FormLabel>
                    <FormControl>
                      <Input placeholder="John" {...field} data-testid="input-edit-first-name" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="lastName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Last Name *</FormLabel>
                    <FormControl>
                      <Input placeholder="Doe" {...field} data-testid="input-edit-last-name" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <FormField
              control={form.control}
              name="company"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Company</FormLabel>
                  <FormControl>
                    <Input placeholder="Acme Corp" {...field} value={field.value || ""} data-testid="input-edit-company" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email</FormLabel>
                    <FormControl>
                      <Input type="email" placeholder="john@example.com" {...field} value={field.value || ""} data-testid="input-edit-email" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="phone"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Phone</FormLabel>
                    <FormControl>
                      <Input placeholder="+1 (555) 123-4567" {...field} value={field.value || ""} data-testid="input-edit-phone" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <FormField
              control={form.control}
              name="topic"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Topic</FormLabel>
                  <FormControl>
                    <Input placeholder="Lead topic or description" {...field} value={field.value || ""} data-testid="input-edit-topic" />
                  </FormControl>
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
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger data-testid="select-edit-status">
                          <SelectValue placeholder="Select status" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="new">New</SelectItem>
                        <SelectItem value="contacted">Contacted</SelectItem>
                        <SelectItem value="qualified">Qualified</SelectItem>
                        <SelectItem value="unqualified">Unqualified</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="source"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Source</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value || undefined}>
                      <FormControl>
                        <SelectTrigger data-testid="select-edit-source">
                          <SelectValue placeholder="Select source" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="website">Website</SelectItem>
                        <SelectItem value="referral">Referral</SelectItem>
                        <SelectItem value="phone">Phone</SelectItem>
                        <SelectItem value="email">Email</SelectItem>
                        <SelectItem value="event">Event</SelectItem>
                        <SelectItem value="partner">Partner</SelectItem>
                        <SelectItem value="other">Other</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <FormField
              control={form.control}
              name="rating"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Rating</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value || undefined}>
                    <FormControl>
                      <SelectTrigger data-testid="select-edit-rating">
                        <SelectValue placeholder="Select rating" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="hot">Hot</SelectItem>
                      <SelectItem value="warm">Warm</SelectItem>
                      <SelectItem value="cold">Cold</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setIsEditDialogOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={editMutation.isPending} data-testid="button-submit-edit">
                {editMutation.isPending ? "Saving..." : "Save Changes"}
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
          <AlertDialogTitle>Are you sure?</AlertDialogTitle>
          <AlertDialogDescription>
            This will permanently delete the lead "{fullName}". This action cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleDelete}
            disabled={deleteMutation.isPending}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            data-testid="button-confirm-delete"
          >
            {deleteMutation.isPending ? "Deleting..." : "Delete"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    </>
  );
}
