export interface Citation {
  title: string;
  url: string;
}

export interface CompanyCandidate {
  name: string;
  domain?: string;
  website?: string;
  industry?: string;
  companySize?: string;
  geography?: string;
  description?: string;
  icpFitRationale?: string;
  companyOverview?: string;
  strategicApproach?: string;
  linkedinUrl?: string;
  citations: Citation[];
}

export interface ResearchResult {
  companies: CompanyCandidate[];
  rawSearchResults: { title: string; url: string; snippet: string }[];
  citations: Citation[];
}

export interface ResearchRequest {
  query: string;
  mode: "market_research" | "company_discovery";
  maxResults?: number;
}

export type ResearchMode = "azure_web_search" | "brave" | "serper" | "none";

export interface ResearchProvider {
  mode: ResearchMode;
  /**
   * Validate that this provider is correctly configured.
   * Returns null if OK, or a human-readable error string if configuration is missing or invalid.
   */
  validateConfig(): string | null;
  /**
   * Perform a web search and return structured results with optional inline citation provenance.
   */
  search(query: string): Promise<{ title: string; url: string; snippet: string; citations?: Citation[] }[]>;
}
