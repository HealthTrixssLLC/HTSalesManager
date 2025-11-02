import { useQuery } from "@tanstack/react-query";
import { useRoute } from "wouter";
import { Loader2 } from "lucide-react";
import { DetailPageLayout, DetailSection, DetailField } from "@/components/detail-page-layout";
import { RelatedEntitiesSection } from "@/components/related-entities-section";
import { CommentSystem } from "@/components/comment-system";
import type { Opportunity, Account, Contact, Activity } from "@shared/schema";

export default function OpportunityDetailPage() {
  const [, params] = useRoute("/opportunities/:id");
  const opportunityId = params?.id;

  const { data: opportunity, isLoading: oppLoading } = useQuery<Opportunity>({
    queryKey: ["/api/opportunities", opportunityId],
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

  if (oppLoading || relatedLoading) {
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
      onEdit={() => {
        // TODO: Open edit dialog
      }}
      onDelete={() => {
        // TODO: Show delete confirmation
      }}
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

          <DetailSection title="Revenue & Dates">
            <DetailField label="Actual Revenue" value={opportunity.actualRevenue} type="currency" />
            <DetailField label="Actual Close Date" value={opportunity.actualCloseDate} type="date" />
            <DetailField label="Est. Revenue" value={opportunity.estRevenue} type="currency" />
            <DetailField label="Est. Close Date" value={opportunity.estCloseDate} type="date" />
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
          />
        </div>
      </div>
    </DetailPageLayout>
  );
}
