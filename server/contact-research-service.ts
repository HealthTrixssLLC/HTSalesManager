import { db, eq, and, desc } from "./db";
import * as schema from "@shared/schema";
import { decryptApiKey, isEncryptedKey } from "./llm-key-utils";
import { isAzureWebSearchConfigured, AzureWebSearchProvider } from "./lib/research/providers/AzureWebSearchProvider";

interface ResolvedLlmConfig {
  provider: string;
  model: string;
  baseUrl: string | null;
  apiVersion: string | null;
  temperature: number;
  maxTokens: number;
  apiKey: string;
}

export async function getLlmConfigForResearch(): Promise<ResolvedLlmConfig | null> {
  const rows = await db.select().from(schema.llmConfigurations)
    .orderBy(desc(schema.llmConfigurations.updatedAt))
    .limit(1);

  const cfg = rows[0];
  if (!cfg) return null;

  let apiKey: string | null = null;
  if (cfg.encryptedApiKey) {
    try {
      apiKey = isEncryptedKey(cfg.encryptedApiKey)
        ? decryptApiKey(cfg.encryptedApiKey)
        : cfg.encryptedApiKey;
    } catch {
      // fall through to env vars
    }
  }

  if (!apiKey) {
    if (cfg.provider === "openai") apiKey = process.env.OPENAI_API_KEY || null;
    else if (cfg.provider === "anthropic") apiKey = process.env.ANTHROPIC_API_KEY || null;
    else if (cfg.provider === "google") apiKey = process.env.GOOGLE_API_KEY || null;
    else if (cfg.provider === "azure") apiKey = process.env.AZURE_OPENAI_API_KEY || null;
  }

  if (!apiKey) return null;

  return {
    provider: cfg.provider,
    model: cfg.modelName,
    baseUrl: cfg.baseUrl || null,
    apiVersion: cfg.apiVersion || null,
    temperature: parseFloat(String(cfg.temperature ?? "0.3")),
    maxTokens: Math.min(cfg.maxTokens ?? 2048, 2048),
    apiKey,
  };
}

export async function callLlmForResearch(
  config: ResolvedLlmConfig,
  systemPrompt: string,
  userPrompt: string,
): Promise<string> {
  const { apiKey, temperature, maxTokens } = config;

  if (config.provider === "azure") {
    const rawBase = (config.baseUrl || "").replace(/\/+$/, "");
    const baseUrl = rawBase.replace(/\/openai.*$/, "");
    if (!baseUrl) throw new Error("Azure OpenAI requires a base URL");
    const apiVersion = config.apiVersion || "2024-12-01-preview";
    const url = `${baseUrl}/openai/deployments/${config.model}/chat/completions?api-version=${apiVersion}`;
    const isStrictOSeries = /^o\d/.test(config.model);
    const effectiveMaxTokens = Math.max(maxTokens * 4, 8000);
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "api-key": apiKey },
      body: JSON.stringify({
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        ...(isStrictOSeries ? { reasoning_effort: "low" } : { temperature }),
        max_completion_tokens: effectiveMaxTokens,
      }),
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Azure OpenAI error: ${response.status} - ${errorText.slice(0, 200)}`);
    }
    const data = await response.json() as { choices: Array<{ message: { content: string | null } }> };
    return data.choices[0]?.message?.content || "";
  }

  if (config.provider === "openai" || config.provider === "openai-compatible") {
    const baseUrl = config.baseUrl || "https://api.openai.com/v1";
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: config.model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature,
        max_tokens: maxTokens,
      }),
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenAI error: ${response.status} - ${errorText.slice(0, 200)}`);
    }
    const data = await response.json() as { choices: Array<{ message: { content: string } }> };
    return data.choices[0]?.message?.content || "";
  }

  if (config.provider === "anthropic") {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: config.model,
        max_tokens: maxTokens,
        system: systemPrompt,
        messages: [{ role: "user", content: userPrompt }],
        temperature,
      }),
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Anthropic error: ${response.status} - ${errorText.slice(0, 200)}`);
    }
    const data = await response.json() as { content: Array<{ type: string; text: string }> };
    return data.content.find(c => c.type === "text")?.text || "";
  }

  if (config.provider === "google") {
    const baseUrl = config.baseUrl || "https://generativelanguage.googleapis.com/v1beta";
    const response = await fetch(
      `${baseUrl}/models/${config.model}:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: systemPrompt }] },
          contents: [{ role: "user", parts: [{ text: userPrompt }] }],
          generationConfig: { temperature, maxOutputTokens: maxTokens },
        }),
      }
    );
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Google AI error: ${response.status} - ${errorText.slice(0, 200)}`);
    }
    const data = await response.json() as { candidates: Array<{ content: { parts: Array<{ text: string }> } }> };
    return data.candidates[0]?.content?.parts?.map(p => p.text).join("") || "";
  }

  throw new Error(`Unsupported LLM provider: ${config.provider}`);
}

export function isWebSearchConfiguredForResearch(): boolean {
  if (isAzureWebSearchConfigured()) return true;
  if (process.env.BRAVE_SEARCH_API_KEY) return true;
  if (process.env.SERPER_API_KEY) return true;
  // Azure LLM can also be used as web search provider when configured
  if (process.env.AZURE_OPENAI_API_KEY && process.env.AZURE_OPENAI_BASE_URL) return true;
  return false;
}

export async function performWebSearchForResearch(
  query: string
): Promise<{ title: string; url: string; snippet: string }[]> {
  if (isAzureWebSearchConfigured()) {
    try {
      const provider = new AzureWebSearchProvider();
      const results = await provider.search(query);
      return results.map(r => ({ title: r.title, url: r.url, snippet: r.snippet }));
    } catch (err) {
      console.warn("[ContactResearch] Azure web search failed:", err instanceof Error ? err.message : err);
      return [];
    }
  }

  if (process.env.BRAVE_SEARCH_API_KEY) {
    try {
      const response = await fetch(
        `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=5`,
        { headers: { "Accept": "application/json", "X-Subscription-Token": process.env.BRAVE_SEARCH_API_KEY } }
      );
      if (response.ok) {
        const data = await response.json() as { web?: { results?: Array<{ title: string; url: string; description: string }> } };
        return (data.web?.results || []).map(r => ({ title: r.title, url: r.url, snippet: r.description }));
      }
    } catch (err) {
      console.warn("[ContactResearch] Brave search failed:", err);
    }
  }

  if (process.env.SERPER_API_KEY) {
    try {
      const response = await fetch("https://google.serper.dev/search", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-API-KEY": process.env.SERPER_API_KEY },
        body: JSON.stringify({ q: query, num: 5 }),
      });
      if (response.ok) {
        const data = await response.json() as { organic?: Array<{ title: string; link: string; snippet: string }> };
        return (data.organic || []).map(r => ({ title: r.title, url: r.link, snippet: r.snippet }));
      }
    } catch (err) {
      console.warn("[ContactResearch] Serper search failed:", err);
    }
  }

  const llmRows = await db.select().from(schema.llmConfigurations).orderBy(desc(schema.llmConfigurations.updatedAt)).limit(1);
  const llmCfg = llmRows[0];
  if (llmCfg?.provider === "azure" && llmCfg.baseUrl) {
    let apiKey: string | null = null;
    if (llmCfg.encryptedApiKey) {
      try {
        apiKey = isEncryptedKey(llmCfg.encryptedApiKey) ? decryptApiKey(llmCfg.encryptedApiKey) : llmCfg.encryptedApiKey;
      } catch { /* ignore */ }
    }
    if (!apiKey) apiKey = process.env.AZURE_OPENAI_API_KEY || null;
    if (apiKey) {
      try {
        const provider = new AzureWebSearchProvider({ apiKey, baseUrl: llmCfg.baseUrl, model: llmCfg.modelName });
        const results = await provider.search(query);
        return results.map(r => ({ title: r.title, url: r.url, snippet: r.snippet }));
      } catch (err) {
        console.warn("[ContactResearch] Fallback Azure search failed:", err instanceof Error ? err.message : err);
      }
    }
  }

  return [];
}
