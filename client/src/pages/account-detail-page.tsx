import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useRoute, useLocation } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import { DetailPageLayout, DetailSection, DetailField } from "@/components/detail-page-layout";
import { RelatedEntitiesSection } from "@/components/related-entities-section";
import { CommentSystem } from "@/components/comment-system";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TagSelector } from "@/components/tag-selector";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { Tag } from "@/components/ui/tag-badge";
import { Account, Contact, Opportunity, Activity, InsertAccount, insertAccountSchema, AccountCategory } from "@shared/schema";

export default function AccountDetailPage() {
  const [, params] = useRoute("/accounts/:id");
  const accountId = params?.id;
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [selectedTags, setSelectedTags] = useState<Tag[]>([]);

  const { data: account, isLoading: accountLoading } = useQuery<Account>({
    queryKey: ["/api/accounts", accountId],
    enabled: !!accountId,
  });

  const { data: tags = [], isLoading: tagsLoading } = useQuery<Tag[]>({
    queryKey: ["tags", "accounts", accountId],
    queryFn: async () => {
      const res = await fetch(`/api/accounts/${accountId}/tags`);
      if (!res.ok) throw new Error("Failed to fetch tags");
      return res.json();
    },
    enabled: !!accountId,
  });

  const { data: relatedData, isLoading: relatedLoading } = useQuery<{
    contacts: { items: Contact[]; total: number };
    opportunities: { items: Opportunity[]; total: number };
    activities: { items: Activity[]; total: number };
  }>({
    queryKey: ["/api/accounts", accountId, "related"],
    enabled: !!accountId,
  });

  const { data: categories } = useQuery<AccountCategory[]>({
    queryKey: ["/api/account-categories"],
  });

  const form = useForm<InsertAccount>({
    resolver: zodResolver(insertAccountSchema),
    defaultValues: {
      id: "",
      name: "",
      accountNumber: "",
      category: "",
      type: "customer",
      ownerId: "",
      industry: "",
      website: "",
      phone: "",
      billingAddress: "",
      shippingAddress: "",
      primaryContactName: "",
      primaryContactEmail: "",
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (data: InsertAccount) => {
      const res = await apiRequest("PATCH", `/api/accounts/${accountId}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/accounts", accountId] });
      queryClient.invalidateQueries({ queryKey: ["/api/accounts"] });
      toast({ title: "Account updated successfully" });
      setIsEditDialogOpen(false);
    },
    onError: (error: Error) => {
      toast({ title: "Failed to update account", description: error.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("DELETE", `/api/accounts/${accountId}`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/accounts"] });
      toast({ title: "Account deleted successfully" });
      setLocation("/accounts");
    },
    onError: (error: Error) => {
      toast({ title: "Failed to delete account", description: error.message, variant: "destructive" });
    },
  });

  useEffect(() => {
    if (account && isEditDialogOpen) {
      form.reset({
        id: account.id,
        name: account.name,
        accountNumber: account.accountNumber || "",
        category: account.category || "",
        type: account.type || "customer",
        ownerId: account.ownerId || "",
        industry: account.industry || "",
        website: account.website || "",
        phone: account.phone || "",
        billingAddress: account.billingAddress || "",
        shippingAddress: account.shippingAddress || "",
        primaryContactName: account.primaryContactName || "",
        primaryContactEmail: account.primaryContactEmail || "",
      });
    }
  }, [account, isEditDialogOpen, form]);

  const onSubmit = (data: InsertAccount) => {
    updateMutation.mutate(data);
  };

  if (accountLoading || relatedLoading || tagsLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!account) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-muted-foreground">Account not found</p>
      </div>
    );
  }

  const getStatusVariant = (type?: string | null) => {
    if (!type) return "default";
    if (type.toLowerCase() === "customer") return "default";
    if (type.toLowerCase() === "prospect") return "secondary";
    return "outline";
  };

  return (
    <DetailPageLayout
      title={account.name}
      subtitle={account.id}
      backLink="/accounts"
      backLabel="Accounts"
      status={account.type || undefined}
      statusVariant={getStatusVariant(account.type)}
      onEdit={() => setIsEditDialogOpen(true)}
      onDelete={() => setIsDeleteDialogOpen(true)}
    >
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <DetailSection title="Account Information">
            <DetailField label="Account Name" value={account.name} />
            <DetailField label="Account ID" value={account.id} />
            <DetailField label="Account Number" value={account.accountNumber} />
            <DetailField label="Category" value={account.category} />
            <DetailField label="Type" value={account.type} />
            <DetailField label="Industry" value={account.industry} />
            <DetailField label="Website" value={account.website} type="url" />
            <DetailField label="Phone" value={account.phone} type="phone" />
          </DetailSection>

          <DetailSection title="Primary Contact Information">
            <DetailField label="Primary Contact Name" value={account.primaryContactName} />
            <DetailField label="Primary Contact Email" value={account.primaryContactEmail} type="email" />
          </DetailSection>

          <DetailSection title="Address Information">
            <DetailField label="Billing Address" value={account.billingAddress} />
            <DetailField label="Shipping Address" value={account.shippingAddress} />
          </DetailSection>

          {(account.externalId || account.sourceSystem || account.sourceRecordId || account.importStatus || account.importNotes) && (
            <DetailSection title="Import Information">
              <DetailField label="External ID" value={account.externalId} />
              <DetailField label="Source System" value={account.sourceSystem} />
              <DetailField label="Source Record ID" value={account.sourceRecordId} />
              <DetailField label="Import Status" value={account.importStatus} />
              {account.importNotes && (
                <div className="col-span-full">
                  <p className="text-sm font-medium text-muted-foreground mb-1">Import Notes</p>
                  <p className="text-sm whitespace-pre-wrap">{account.importNotes}</p>
                </div>
              )}
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
                entity="accounts"
                entityId={account.id}
              />
            </CardContent>
          </Card>

          <CommentSystem entity="accounts" entityId={account.id} />
        </div>

        <div className="space-y-6">
          <RelatedEntitiesSection
            title="Contacts"
            entities={relatedData?.contacts.items || []}
            entityType="contacts"
            emptyMessage="No contacts associated with this account"
          />

          <RelatedEntitiesSection
            title="Opportunities"
            entities={relatedData?.opportunities.items || []}
            entityType="opportunities"
            emptyMessage="No opportunities for this account"
          />

          <RelatedEntitiesSection
            title="Activities"
            entities={relatedData?.activities.items || []}
            entityType="activities"
            emptyMessage="No activities logged for this account"
          />
        </div>
      </div>

      {/* Edit Dialog */}
      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Account</DialogTitle>
            <DialogDescription>Update account information</DialogDescription>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Account Name *</FormLabel>
                    <FormControl>
                      <Input placeholder="Acme Corporation" {...field} data-testid="input-edit-account-name" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="accountNumber"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Account Number</FormLabel>
                      <FormControl>
                        <Input placeholder="ACC-12345" {...field} value={field.value || ""} data-testid="input-edit-account-number" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="category"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Category</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value || ""}>
                        <FormControl>
                          <SelectTrigger data-testid="select-edit-account-category">
                            <SelectValue placeholder="Select a category" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {categories?.filter(c => c.isActive).map((category) => (
                            <SelectItem key={category.id} value={category.name}>
                              {category.name}
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
                control={form.control}
                name="type"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Account Type</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value || undefined}>
                      <FormControl>
                        <SelectTrigger data-testid="select-edit-account-type">
                          <SelectValue placeholder="Select type" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="customer">Customer</SelectItem>
                        <SelectItem value="prospect">Prospect</SelectItem>
                        <SelectItem value="partner">Partner</SelectItem>
                        <SelectItem value="vendor">Vendor</SelectItem>
                        <SelectItem value="other">Other</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="industry"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Industry</FormLabel>
                      <FormControl>
                        <Input placeholder="Healthcare" {...field} value={field.value || ""} data-testid="input-edit-account-industry" />
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
                        <Input placeholder="+1 (555) 123-4567" {...field} value={field.value || ""} data-testid="input-edit-account-phone" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <FormField
                control={form.control}
                name="website"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Website</FormLabel>
                    <FormControl>
                      <Input placeholder="https://example.com" {...field} value={field.value || ""} data-testid="input-edit-account-website" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="billingAddress"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Billing Address</FormLabel>
                    <FormControl>
                      <Input placeholder="123 Main St, City, State 12345" {...field} value={field.value || ""} data-testid="input-edit-account-billing" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="shippingAddress"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Shipping Address</FormLabel>
                    <FormControl>
                      <Input placeholder="123 Main St, City, State 12345" {...field} value={field.value || ""} data-testid="input-edit-account-shipping" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="primaryContactName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Primary Contact Name</FormLabel>
                      <FormControl>
                        <Input placeholder="John Doe" {...field} value={field.value || ""} data-testid="input-edit-account-contact-name" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="primaryContactEmail"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Primary Contact Email</FormLabel>
                      <FormControl>
                        <Input placeholder="john@example.com" {...field} value={field.value || ""} data-testid="input-edit-account-contact-email" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setIsEditDialogOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={updateMutation.isPending} data-testid="button-submit-edit">
                  {updateMutation.isPending ? "Saving..." : "Save Changes"}
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
            <AlertDialogTitle>Delete Account</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{account.name}"? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteMutation.mutate()}
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
