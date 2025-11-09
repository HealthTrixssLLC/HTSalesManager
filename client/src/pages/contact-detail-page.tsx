import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useRoute } from "wouter";
import { Loader2 } from "lucide-react";
import { DetailPageLayout, DetailSection, DetailField } from "@/components/detail-page-layout";
import { RelatedEntitiesSection } from "@/components/related-entities-section";
import { CommentSystem } from "@/components/comment-system";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TagSelector } from "@/components/tag-selector";
import type { Tag } from "@/components/ui/tag-badge";
import type { Contact, Account, Opportunity, Activity, InsertContact } from "@shared/schema";
import { insertContactSchema } from "@shared/schema";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";

export default function ContactDetailPage() {
  const [, params] = useRoute("/contacts/:id");
  const contactId = params?.id;
  const [selectedTags, setSelectedTags] = useState<Tag[]>([]);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const { toast } = useToast();

  const { data: contact, isLoading: contactLoading } = useQuery<Contact>({
    queryKey: ["/api/contacts", contactId],
    enabled: !!contactId,
  });

  const { data: tags = [], isLoading: tagsLoading } = useQuery<Tag[]>({
    queryKey: ["tags", "contacts", contactId],
    queryFn: async () => {
      const res = await fetch(`/api/contacts/${contactId}/tags`);
      if (!res.ok) throw new Error("Failed to fetch tags");
      return res.json();
    },
    enabled: !!contactId,
  });

  const { data: relatedData, isLoading: relatedLoading } = useQuery<{
    account: { items: Account[]; total: number };
    opportunities: { items: Opportunity[]; total: number };
    activities: { items: Activity[]; total: number };
  }>({
    queryKey: ["/api/contacts", contactId, "related"],
    enabled: !!contactId,
  });

  const { data: accounts } = useQuery<Array<{ id: string; name: string }>>({
    queryKey: ["/api/accounts"],
  });

  const { data: users } = useQuery<Array<{ id: string; name: string }>>({
    queryKey: ["/api/users"],
  });

  const updateMutation = useMutation({
    mutationFn: async (data: InsertContact) => {
      const res = await apiRequest("PATCH", `/api/contacts/${contactId}`, data);
      return await res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/contacts", contactId] });
      queryClient.invalidateQueries({ queryKey: ["/api/contacts"] });
      toast({ title: "Contact updated successfully" });
      setIsEditDialogOpen(false);
    },
    onError: (error: Error) => {
      toast({ title: "Failed to update contact", description: error.message, variant: "destructive" });
    },
  });

  const form = useForm<InsertContact>({
    resolver: zodResolver(insertContactSchema.omit({ id: true })),
    defaultValues: {
      firstName: "",
      lastName: "",
      email: "",
      phone: "",
      mobile: "",
      title: "",
      department: "",
      mailingStreet: "",
      mailingCity: "",
      mailingState: "",
      mailingPostalCode: "",
      mailingCountry: "",
      description: "",
      accountId: null,
      ownerId: "",
    },
  });

  const onSubmit = (data: InsertContact) => {
    updateMutation.mutate(data);
  };

  const openEditDialog = () => {
    if (contact) {
      form.reset({
        firstName: contact.firstName,
        lastName: contact.lastName,
        email: contact.email || "",
        phone: contact.phone || "",
        mobile: contact.mobile || "",
        title: contact.title || "",
        department: contact.department || "",
        mailingStreet: contact.mailingStreet || "",
        mailingCity: contact.mailingCity || "",
        mailingState: contact.mailingState || "",
        mailingPostalCode: contact.mailingPostalCode || "",
        mailingCountry: contact.mailingCountry || "",
        description: contact.description || "",
        accountId: contact.accountId || null,
        ownerId: contact.ownerId || "",
      });
      setIsEditDialogOpen(true);
    }
  };

  if (contactLoading || relatedLoading || tagsLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!contact) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-muted-foreground">Contact not found</p>
      </div>
    );
  }

  const fullName = `${contact.firstName} ${contact.lastName}`;
  const account = relatedData?.account.items[0];

  return (
    <>
    <DetailPageLayout
      title={fullName}
      subtitle={contact.id}
      backLink="/contacts"
      backLabel="Contacts"
      onEdit={openEditDialog}
      onDelete={() => {
        // TODO: Show delete confirmation
      }}
    >
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <DetailSection title="Contact Information">
            <DetailField label="First Name" value={contact.firstName} />
            <DetailField label="Last Name" value={contact.lastName} />
            <DetailField label="Contact ID" value={contact.id} />
            <DetailField label="Title" value={contact.title} />
            <DetailField label="Email" value={contact.email} type="email" />
            <DetailField label="Phone" value={contact.phone} type="phone" />
            <DetailField label="Mobile" value={contact.mobile} type="phone" />
            <DetailField label="Department" value={contact.department} />
          </DetailSection>

          <DetailSection title="Address Information">
            <DetailField label="Mailing Street" value={contact.mailingStreet} />
            <DetailField label="Mailing City" value={contact.mailingCity} />
            <DetailField label="Mailing State" value={contact.mailingState} />
            <DetailField label="Mailing Postal Code" value={contact.mailingPostalCode} />
            <DetailField label="Mailing Country" value={contact.mailingCountry} />
          </DetailSection>

          {contact.description && (
            <DetailSection title="Description">
              <div className="col-span-full">
                <p className="text-sm whitespace-pre-wrap">{contact.description}</p>
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
                entity="contacts"
                entityId={contact.id}
              />
            </CardContent>
          </Card>

          <CommentSystem entity="Contact" entityId={contact.id} />
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
            title="Opportunities"
            entities={relatedData?.opportunities.items || []}
            entityType="opportunities"
            emptyMessage="No opportunities found"
          />

          <RelatedEntitiesSection
            title="Activities"
            entities={relatedData?.activities.items || []}
            entityType="activities"
            emptyMessage="No activities logged"
          />
        </div>
      </div>
    </DetailPageLayout>

    <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit Contact</DialogTitle>
          <DialogDescription>Update contact information</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="firstName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>First Name *</FormLabel>
                    <FormControl>
                      <Input {...field} data-testid="input-edit-first-name" />
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
                      <Input {...field} data-testid="input-edit-last-name" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email</FormLabel>
                    <FormControl>
                      <Input type="email" {...field} value={field.value || ""} data-testid="input-edit-email" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="title"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Job Title</FormLabel>
                    <FormControl>
                      <Input {...field} value={field.value || ""} data-testid="input-edit-title" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="grid grid-cols-3 gap-4">
              <FormField
                control={form.control}
                name="phone"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Phone</FormLabel>
                    <FormControl>
                      <Input {...field} value={field.value || ""} data-testid="input-edit-phone" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="mobile"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Mobile</FormLabel>
                    <FormControl>
                      <Input {...field} value={field.value || ""} data-testid="input-edit-mobile" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="department"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Department</FormLabel>
                    <FormControl>
                      <Input {...field} value={field.value || ""} data-testid="input-edit-department" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="accountId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Account</FormLabel>
                  <Select
                    value={field.value || "none"}
                    onValueChange={(value) => field.onChange(value === "none" ? null : value)}
                  >
                    <FormControl>
                      <SelectTrigger data-testid="select-edit-account">
                        <SelectValue placeholder="Select account" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="none">None</SelectItem>
                      {accounts?.map((account) => (
                        <SelectItem key={account.id} value={account.id}>
                          {account.name}
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
              name="ownerId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Owner</FormLabel>
                  <Select
                    value={field.value || ""}
                    onValueChange={field.onChange}
                  >
                    <FormControl>
                      <SelectTrigger data-testid="select-edit-owner">
                        <SelectValue placeholder="Select owner" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {users?.map((user) => (
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

            <div className="space-y-4">
              <h3 className="text-sm font-medium">Mailing Address</h3>
              <FormField
                control={form.control}
                name="mailingStreet"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Street</FormLabel>
                    <FormControl>
                      <Input {...field} value={field.value || ""} data-testid="input-edit-mailing-street" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="grid grid-cols-3 gap-4">
                <FormField
                  control={form.control}
                  name="mailingCity"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>City</FormLabel>
                      <FormControl>
                        <Input {...field} value={field.value || ""} data-testid="input-edit-mailing-city" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="mailingState"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>State</FormLabel>
                      <FormControl>
                        <Input {...field} value={field.value || ""} data-testid="input-edit-mailing-state" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="mailingPostalCode"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Postal Code</FormLabel>
                      <FormControl>
                        <Input {...field} value={field.value || ""} data-testid="input-edit-mailing-postal-code" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <FormField
                control={form.control}
                name="mailingCountry"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Country</FormLabel>
                    <FormControl>
                      <Input {...field} value={field.value || ""} data-testid="input-edit-mailing-country" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Description</FormLabel>
                  <FormControl>
                    <Textarea {...field} value={field.value || ""} rows={4} data-testid="textarea-edit-description" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setIsEditDialogOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={updateMutation.isPending} data-testid="button-submit-edit-contact">
                {updateMutation.isPending ? "Updating..." : "Update Contact"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
    </>
  );
}
