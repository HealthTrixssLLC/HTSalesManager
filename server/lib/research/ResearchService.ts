import { AzureWebSearchProvider, isAzureWebSearchConfigured } from "./providers/AzureWebSearchProvider";
import type { ResearchProvider, ResearchMode, ResearchResult, ResearchRequest, Citation } from "./types";

export class ResearchService {
  private provider: ResearchProvider | null = null;
  private mode: ResearchMode = "none";
  private configError: string | null = null;

  constructor() {
    if (isAzureWebSearchConfigured()) {
      const p = new AzureWebSearchProvider();
      const err = p.validateConfig();
      if (!err) {
        this.provider = p;
        this.mode = "azure_web_search";
      } else {
        this.configError = err;
        console.warn("[ResearchService] Azure web search config error:", err);
      }
    }
  }

  getMode(): ResearchMode {
    return this.mode;
  }

  isConfigured(): boolean {
    return this.provider !== null;
  }

  getConfigError(): string | null {
    return this.configError;
  }

  /**
   * Run a research request and return structured results with citations.
   * The mode on ResearchRequest (market_research vs company_discovery) can be used
   * by consumers to adjust how results are processed.
   */
  async run(request: ResearchRequest): Promise<ResearchResult> {
    const { query, maxResults } = request;

    if (!this.provider) {
      return { companies: [], rawSearchResults: [], citations: [] };
    }

    try {
      const rawResults = await this.provider.search(query);
      const limited = maxResults ? rawResults.slice(0, maxResults) : rawResults;

      const allCitations: Citation[] = [];
      for (const r of limited) {
        if (r.citations) {
          for (const c of r.citations) {
            if (c.url && !allCitations.some(ex => ex.url === c.url)) {
              allCitations.push(c);
            }
          }
        }
      }

      return {
        companies: [],
        rawSearchResults: limited.map(r => ({ title: r.title, url: r.url, snippet: r.snippet })),
        citations: allCitations,
      };
    } catch (err) {
      console.warn("[ResearchService] Search failed:", err instanceof Error ? err.message : err);
      return { companies: [], rawSearchResults: [], citations: [] };
    }
  }

  async search(query: string): Promise<{ title: string; url: string; snippet: string }[]> {
    if (!this.provider) {
      return [];
    }
    try {
      const results = await this.provider.search(query);
      return results.map(r => ({ title: r.title, url: r.url, snippet: r.snippet }));
    } catch (err) {
      console.warn("[ResearchService] Search failed:", err instanceof Error ? err.message : err);
      return [];
    }
  }

  /**
   * Search with full citation provenance. Unlike `search()`, this does NOT swallow errors —
   * errors are propagated to the caller so the pipeline can fail visibly.
   */
  async searchWithCitations(query: string): Promise<{ title: string; url: string; snippet: string; citations?: Citation[] }[]> {
    if (!this.provider) {
      return [];
    }
    return this.provider.search(query);
  }
}

export const researchService = new ResearchService();
