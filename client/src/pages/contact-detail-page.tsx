import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRoute } from "wouter";
import { Loader2 } from "lucide-react";
import { DetailPageLayout, DetailSection, DetailField } from "@/components/detail-page-layout";
import { RelatedEntitiesSection } from "@/components/related-entities-section";
import { CommentSystem } from "@/components/comment-system";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TagSelector } from "@/components/tag-selector";
import type { Tag } from "@/components/ui/tag-badge";
import type { Contact, Account, Opportunity, Activity } from "@shared/schema";

export default function ContactDetailPage() {
  const [, params] = useRoute("/contacts/:id");
  const contactId = params?.id;
  const [selectedTags, setSelectedTags] = useState<Tag[]>([]);

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
    <DetailPageLayout
      title={fullName}
      subtitle={contact.id}
      backLink="/contacts"
      backLabel="Contacts"
      onEdit={() => {
        // TODO: Open edit dialog
      }}
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

          <CommentSystem entityType="Contact" entityId={contact.id} />
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
  );
}
