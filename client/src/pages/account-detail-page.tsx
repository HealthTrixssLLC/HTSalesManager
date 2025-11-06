import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRoute, useLocation } from "wouter";
import { Loader2 } from "lucide-react";
import { DetailPageLayout, DetailSection, DetailField } from "@/components/detail-page-layout";
import { RelatedEntitiesSection } from "@/components/related-entities-section";
import { CommentSystem } from "@/components/comment-system";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TagSelector } from "@/components/tag-selector";
import type { Tag } from "@/components/ui/tag-badge";
import type { Account, Contact, Opportunity, Activity } from "@shared/schema";

export default function AccountDetailPage() {
  const [, params] = useRoute("/accounts/:id");
  const [, setLocation] = useLocation();
  const accountId = params?.id;
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
      onEdit={() => {
        // TODO: Open edit dialog
      }}
      onDelete={() => {
        // TODO: Show delete confirmation
      }}
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
    </DetailPageLayout>
  );
}
