/** Canonical comment parent labels stored in comments.entity. */
export const COMMENT_ENTITIES = ["Account", "Contact", "Lead", "Opportunity", "Activity"] as const;
export type CommentEntity = (typeof COMMENT_ENTITIES)[number];

const PATH_TO_CANONICAL: Record<string, CommentEntity> = {
  accounts: "Account",
  account: "Account",
  Account: "Account",
  contacts: "Contact",
  contact: "Contact",
  Contact: "Contact",
  leads: "Lead",
  lead: "Lead",
  Lead: "Lead",
  opportunities: "Opportunity",
  opportunity: "Opportunity",
  Opportunity: "Opportunity",
  activities: "Activity",
  activity: "Activity",
  Activity: "Activity",
};

const LEGACY_ALIASES: Record<CommentEntity, string[]> = {
  Account: ["accounts", "account", "Account"],
  Contact: ["contacts", "contact", "Contact"],
  Lead: ["leads", "lead", "Lead"],
  Opportunity: ["opportunities", "opportunity", "Opportunity"],
  Activity: ["activities", "activity", "Activity"],
};

export function canonicalizeCommentEntity(raw: string | undefined): CommentEntity | null {
  if (!raw) return null;
  return PATH_TO_CANONICAL[raw] ?? null;
}

/** All historical spellings for a canonical entity, used when reading mixed rows. */
export function commentEntityAliases(canonical: CommentEntity): string[] {
  return LEGACY_ALIASES[canonical];
}
