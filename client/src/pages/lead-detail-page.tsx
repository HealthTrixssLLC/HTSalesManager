import { useQuery } from "@tanstack/react-query";
import { useRoute, useLocation } from "wouter";
import { Loader2, ArrowRight } from "lucide-react";
import { DetailPageLayout, DetailSection, DetailField } from "@/components/detail-page-layout";
import { RelatedEntitiesSection } from "@/components/related-entities-section";
import { CommentSystem } from "@/components/comment-system";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { Lead, Activity, Account, Contact, Opportunity } from "@shared/schema";

export default function LeadDetailPage() {
  const [, params] = useRoute("/leads/:id");
  const [, setLocation] = useLocation();
  const leadId = params?.id;

  const { data: lead, isLoading: leadLoading } = useQuery<Lead>({
    queryKey: ["/api/leads", leadId],
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

  if (leadLoading || relatedLoading) {
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
    <DetailPageLayout
      title={fullName}
      subtitle={lead.id}
      backLink="/leads"
      backLabel="Leads"
      status={lead.status}
      statusVariant={getStatusVariant(lead.status)}
      onEdit={() => {
        // TODO: Open edit dialog
      }}
      onDelete={() => {
        // TODO: Show delete confirmation
      }}
    >
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <DetailSection title="Lead Information">
            <DetailField label="First Name" value={lead.firstName} />
            <DetailField label="Last Name" value={lead.lastName} />
            <DetailField label="Lead ID" value={lead.id} />
            <DetailField label="Status" value={lead.status} />
            <DetailField label="Rating" value={lead.rating} />
            <DetailField label="Company" value={lead.company} />
            <DetailField label="Title" value={lead.title} />
            <DetailField label="Email" value={lead.email} type="email" />
            <DetailField label="Phone" value={lead.phone} type="phone" />
            <DetailField label="Website" value={lead.website} type="url" />
            <DetailField label="Industry" value={lead.industry} />
            <DetailField label="Lead Source" value={lead.leadSource} />
          </DetailSection>

          <DetailSection title="Address Information">
            <DetailField label="Street" value={lead.street} />
            <DetailField label="City" value={lead.city} />
            <DetailField label="State" value={lead.state} />
            <DetailField label="Postal Code" value={lead.postalCode} />
            <DetailField label="Country" value={lead.country} />
          </DetailSection>

          {lead.description && (
            <DetailSection title="Description">
              <div className="col-span-full">
                <p className="text-sm whitespace-pre-wrap">{lead.description}</p>
              </div>
            </DetailSection>
          )}

          <CommentSystem entityType="Lead" entityId={lead.id} />
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
  );
}
