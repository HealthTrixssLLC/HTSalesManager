import { useQuery } from "@tanstack/react-query";
import { useRoute, useLocation } from "wouter";
import { Loader2 } from "lucide-react";
import { DetailPageLayout, DetailSection, DetailField } from "@/components/detail-page-layout";
import { RelatedEntitiesSection } from "@/components/related-entities-section";
import { CommentSystem } from "@/components/comment-system";
import type { Account, Contact, Opportunity, Activity } from "@shared/schema";

export default function AccountDetailPage() {
  const [, params] = useRoute("/accounts/:id");
  const [, setLocation] = useLocation();
  const accountId = params?.id;

  const { data: account, isLoading: accountLoading } = useQuery<Account>({
    queryKey: ["/api/accounts", accountId],
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

  if (accountLoading || relatedLoading) {
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

  const getStatusVariant = (type?: string) => {
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
            <DetailField label="Type" value={account.type} />
            <DetailField label="Industry" value={account.industry} />
            <DetailField label="Website" value={account.website} type="url" />
            <DetailField label="Phone" value={account.phone} type="phone" />
          </DetailSection>

          <DetailSection title="Address Information">
            <DetailField label="Billing Street" value={account.billingStreet} />
            <DetailField label="Billing City" value={account.billingCity} />
            <DetailField label="Billing State" value={account.billingState} />
            <DetailField label="Billing Postal Code" value={account.billingPostalCode} />
            <DetailField label="Billing Country" value={account.billingCountry} />
            <DetailField label="Shipping Street" value={account.shippingStreet} />
            <DetailField label="Shipping City" value={account.shippingCity} />
            <DetailField label="Shipping State" value={account.shippingState} />
            <DetailField label="Shipping Postal Code" value={account.shippingPostalCode} />
            <DetailField label="Shipping Country" value={account.shippingCountry} />
          </DetailSection>

          {account.description && (
            <DetailSection title="Description">
              <div className="col-span-full">
                <p className="text-sm whitespace-pre-wrap">{account.description}</p>
              </div>
            </DetailSection>
          )}

          <CommentSystem entityType="Account" entityId={account.id} />
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
