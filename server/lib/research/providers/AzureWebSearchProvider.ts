import type { ResearchProvider, ResearchMode, Citation } from "../types";

export class AzureWebSearchProvider implements ResearchProvider {
  readonly mode: ResearchMode = "azure_web_search";
  private apiKey: string;
  private baseUrl: string;
  private model: string;

  constructor() {
    const apiKey = process.env.AZURE_OPENAI_API_KEY;
    const baseUrl = process.env.AZURE_OPENAI_BASE_URL;
    const model = process.env.AZURE_OPENAI_MODEL;

    const missing: string[] = [];
    if (!apiKey) missing.push("AZURE_OPENAI_API_KEY");
    if (!baseUrl) missing.push("AZURE_OPENAI_BASE_URL");
    if (!model) missing.push("AZURE_OPENAI_MODEL");
    if (missing.length > 0) {
      throw new Error(
        `Azure OpenAI web search requires these environment variables: ${missing.join(", ")}. ` +
        `Configure them in Admin Console → AI Configuration → Web Search Provider.`
      );
    }

    this.apiKey = apiKey!;
    this.baseUrl = baseUrl!.replace(/\/+$/, "");
    this.model = model!;
  }

  validateConfig(): string | null {
    return null;
  }

  async search(query: string): Promise<{ title: string; url: string; snippet: string; citations?: Citation[] }[]> {

    const apiVersion = "2025-03-01-preview";
    const url = `${this.baseUrl}/openai/responses?api-version=${apiVersion}`;

    const body = {
      model: this.model,
      tools: [{ type: "web_search" }],
      input: query,
    };

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "api-key": this.apiKey,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      let reason = `HTTP ${response.status}`;
      if (response.status === 401) reason = "Invalid or expired API key";
      else if (response.status === 403) reason = "Access denied — check model permissions";
      else if (response.status === 429) reason = "Rate limit exceeded";
      else if (response.status === 404) reason = "Endpoint or model not found — check AZURE_OPENAI_BASE_URL and AZURE_OPENAI_MODEL";
      throw new Error(`Azure OpenAI web search failed: ${reason}. Details: ${errorText.slice(0, 300)}`);
    }

    const data = await response.json() as {
      output?: Array<{
        type: string;
        content?: Array<{
          type: string;
          text?: string;
          annotations?: Array<{
            type: string;
            url?: string;
            title?: string;
            start_index?: number;
            end_index?: number;
          }>;
        }>;
      }>;
    };

    const results: { title: string; url: string; snippet: string; citations: Citation[] }[] = [];

    for (const outputItem of data.output || []) {
      if (outputItem.type === "message" && Array.isArray(outputItem.content)) {
        for (const contentItem of outputItem.content) {
          if (contentItem.type === "output_text" && contentItem.text) {
            const text = contentItem.text;
            const annotations = contentItem.annotations || [];

            for (const annotation of annotations) {
              if (annotation.type === "url_citation" && annotation.url && annotation.title) {
                const citation: Citation = { title: annotation.title, url: annotation.url };

                const snippet = annotation.start_index !== undefined && annotation.end_index !== undefined
                  ? text.slice(annotation.start_index, annotation.end_index).slice(0, 300)
                  : text.slice(0, 300);

                results.push({
                  title: annotation.title,
                  url: annotation.url,
                  snippet,
                  citations: [citation],
                });
              }
            }

            // Fallback: if no URL citations found, include the full text result without URL
            // so the LLM still has context (but no citation provenance)
            if (results.length === 0 && text.trim()) {
              results.push({
                title: "Azure Web Search Summary",
                url: "",
                snippet: text.slice(0, 500),
                citations: [],
              });
            }
          }
        }
      }
    }

    return results;
  }
}

export function isAzureWebSearchConfigured(): boolean {
  return !!(
    process.env.AZURE_OPENAI_API_KEY &&
    process.env.AZURE_OPENAI_BASE_URL &&
    process.env.AZURE_OPENAI_MODEL
  );
}
