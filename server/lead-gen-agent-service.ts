// Lead Gen Agent Service
// Implements the AI agent pipeline for lead generation runs:
// Market Research → Company Discovery → Contact Discovery → Strategy → Communication Drafting
//
// Each phase calls the configured LLM (sourced from Admin Console llm_configurations with
// encrypted key storage) with structured prompts derived from the run's ICP and Playbook.
// Agent steps are individually logged with the prompt, response, and timing for audit trail.
// Web search is used via configurable search endpoint for external research.

import { db, eq, and, desc, sql } from "./db";
import * as schema from "@shared/schema";
import { decryptApiKey, isEncryptedKey } from "./llm-key-utils";

const PHASES = [
  "market_research",
  "company_discovery",
  "contact_discovery",
  "strategy",
  "communication_drafting",
] as const;

type Phase = typeof PHASES[number];

interface ResolvedLlmConfig {
  provider: string;
  model: string;
  baseUrl: string | null;
  apiVersion: string | null;
  temperature: number;
  maxTokens: number;
  apiKey: string;
}

interface PhaseLogEntry {
  phase: string;
  startedAt: string;
  completedAt?: string;
  durationMs?: number;
  status: "running" | "success" | "error";
  errorMessage?: string;
}

/**
 * Load the Admin Console LLM configuration (llm_configurations table) and resolve
 * the encrypted API key. Applies per-phase model override from agentModelOverrides if present.
 */
async function getLlmConfig(phase: string): Promise<ResolvedLlmConfig | null> {
  const rows = await db.select().from(schema.llmConfigurations)
    .orderBy(desc(schema.llmConfigurations.updatedAt))
    .limit(1);

  const cfg = rows[0];
  if (cfg) {
    let apiKey: string | null = null;
    if (cfg.encryptedApiKey) {
      try {
        apiKey = isEncryptedKey(cfg.encryptedApiKey)
          ? decryptApiKey(cfg.encryptedApiKey)
          : cfg.encryptedApiKey;
      } catch (e) {
        console.warn("[Agent] Failed to decrypt LLM API key:", e instanceof Error ? e.message : String(e));
      }
    }

    if (!apiKey) {
      if (cfg.provider === "openai") apiKey = process.env.OPENAI_API_KEY || null;
      else if (cfg.provider === "anthropic") apiKey = process.env.ANTHROPIC_API_KEY || null;
      else if (cfg.provider === "google") apiKey = process.env.GOOGLE_API_KEY || null;
      else if (cfg.provider === "azure") apiKey = process.env.AZURE_OPENAI_API_KEY || null;
    }

    if (apiKey) {
      const overrides = (cfg.agentModelOverrides as Record<string, string> | null) ?? {};
      const model = overrides[phase] ?? overrides["default"] ?? cfg.modelName;
      return {
        provider: cfg.provider,
        model,
        baseUrl: cfg.baseUrl || null,
        apiVersion: cfg.apiVersion || null,
        temperature: parseFloat(String(cfg.temperature ?? "0.7")),
        maxTokens: cfg.maxTokens ?? 4096,
        apiKey,
      };
    }
  }

  return null;
}

function formatApiError(provider: string, status: number, body: string, hint: string): string {
  let reason = "";
  if (status === 401) {
    reason = "Invalid or expired API key.";
  } else if (status === 403) {
    reason = "Access denied — your account may lack permission for this model or resource.";
  } else if (status === 429) {
    reason = "Rate limit or quota exceeded — you may need to add billing credits or wait before retrying.";
  } else if (status === 404) {
    reason = "Model or endpoint not found — check the model name and base URL are correct.";
  } else if (status >= 500) {
    reason = `${provider} returned a server error (${status}) — this is typically temporary, try again in a few minutes.`;
  } else {
    reason = `HTTP ${status} error.`;
  }

  let detail = "";
  try {
    const parsed = JSON.parse(body);
    detail = parsed?.error?.message || parsed?.message || "";
  } catch {
    detail = body.slice(0, 200);
  }

  return [
    `${provider} API error: ${reason}`,
    detail ? `  Details: ${detail}` : "",
    `  Fix: ${hint}`,
  ].filter(Boolean).join("\n");
}

async function callLlm(
  config: ResolvedLlmConfig,
  systemPrompt: string,
  userPrompt: string,
): Promise<string> {
  const { apiKey, temperature, maxTokens } = config;

  if (config.provider === "azure") {
    // Strip any accidentally-pasted path segments from the base URL
    const rawBase = (config.baseUrl || "").replace(/\/+$/, "");
    const baseUrl = rawBase.replace(/\/openai.*$/, "");
    if (!baseUrl) {
      throw new Error("Azure OpenAI requires a base URL (Endpoint URL) to be configured");
    }
    const apiVersion = config.apiVersion || "2024-12-01-preview";
    const url = `${baseUrl}/openai/deployments/${config.model}/chat/completions?api-version=${apiVersion}`;
    // o-series models (o1, o3, o4...) require max_completion_tokens and do not support temperature.
    // max_completion_tokens on o-series includes reasoning tokens as well as output tokens — the model
    // can spend thousands of tokens reasoning internally, leaving very little for the actual JSON output.
    // Using reasoning_effort:"low" caps reasoning overhead and leaves the budget for real output.
    // We also use a minimum of 16000 so truncation doesn't cut off large JSON responses.
    const isOSeries = /^o\d/.test(config.model);
    const effectiveMaxTokens = isOSeries ? Math.max(maxTokens * 4, 16000) : maxTokens;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "api-key": apiKey,
      },
      body: JSON.stringify({
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        ...(isOSeries ? { reasoning_effort: "low" } : { temperature }),
        max_completion_tokens: effectiveMaxTokens,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(formatApiError("Azure OpenAI", response.status, errorText,
        "Check your Azure endpoint URL, deployment name, API key, and api-version in Admin Console → AI Configuration."));
    }

    const data = await response.json() as {
      choices: Array<{ message: { content: string } }>;
    };
    return data.choices[0]?.message?.content || "";
  }

  if (config.provider === "openai" || config.provider === "openai-compatible") {
    const baseUrl = config.baseUrl || "https://api.openai.com/v1";
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
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
      throw new Error(formatApiError("OpenAI", response.status, errorText,
        "Verify your API key at platform.openai.com/api-keys and ensure you have an active billing plan."));
    }

    const data = await response.json() as {
      choices: Array<{ message: { content: string } }>;
    };
    return data.choices[0]?.message?.content || "";
  }

  if (config.provider === "anthropic") {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
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
      throw new Error(formatApiError("Anthropic", response.status, errorText,
        "Verify your API key at console.anthropic.com and check your account has available credits."));
    }

    const data = await response.json() as {
      content: Array<{ type: string; text: string }>;
    };
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
      throw new Error(formatApiError("Google AI", response.status, errorText,
        "Verify your API key at aistudio.google.com and ensure the Generative Language API is enabled in your Google Cloud project."));
    }

    const data = await response.json() as {
      candidates: Array<{ content: { parts: Array<{ text: string }> } }>;
    };
    return data.candidates[0]?.content?.parts?.map(p => p.text).join("") || "";
  }

  throw new Error(`Unsupported LLM provider: "${config.provider}". Supported providers are: openai, anthropic, google, azure, openai-compatible.`);
}

interface SearchConfig {
  provider: string;
  apiKey: string;
  baseUrl?: string | null;
}

let _cachedSearchConfig: SearchConfig | null | undefined = undefined;

async function getSearchConfig(): Promise<SearchConfig | null> {
  if (_cachedSearchConfig !== undefined) return _cachedSearchConfig;

  // Look for a search config entry that uses apiKeyEnvVar (no plaintext key storage)
  const searchConfig = await db.select().from(schema.aiConfigs)
    .where(and(
      eq(schema.aiConfigs.agentPhase, "search"),
      eq(schema.aiConfigs.isActive, true),
    ))
    .orderBy(desc(schema.aiConfigs.createdAt))
    .limit(1);

  if (searchConfig[0]) {
    const cfg = searchConfig[0];
    // Only resolve via env var reference — never read plaintext api_key column
    const apiKey = cfg.apiKeyEnvVar ? process.env[cfg.apiKeyEnvVar] || null : null;
    if (apiKey) {
      _cachedSearchConfig = { provider: cfg.provider, apiKey, baseUrl: cfg.baseUrl };
      return _cachedSearchConfig;
    }
  }

  // Fall back to well-known env vars
  if (process.env.BRAVE_SEARCH_API_KEY) {
    _cachedSearchConfig = { provider: "brave", apiKey: process.env.BRAVE_SEARCH_API_KEY };
    return _cachedSearchConfig;
  }
  if (process.env.SERPER_API_KEY) {
    _cachedSearchConfig = { provider: "serper", apiKey: process.env.SERPER_API_KEY };
    return _cachedSearchConfig;
  }

  _cachedSearchConfig = null;
  return null;
}

async function performWebSearch(query: string): Promise<{ title: string; url: string; snippet: string }[]> {
  try {
    const config = await getSearchConfig();

    if (!config) {
      console.log(`[Agent] Web search skipped (no search provider configured), query: ${query}`);
      return [];
    }

    if (config.provider === "brave") {
      const baseUrl = config.baseUrl || "https://api.search.brave.com/res/v1/web";
      const response = await fetch(`${baseUrl}/search?q=${encodeURIComponent(query)}&count=5`, {
        headers: {
          "Accept": "application/json",
          "X-Subscription-Token": config.apiKey,
        },
      });

      if (!response.ok) {
        console.warn(`[Agent] Brave search returned ${response.status} for query: ${query}`);
        return [];
      }

      const data = await response.json() as {
        web?: { results?: Array<{ title: string; url: string; description: string }> };
      };
      return (data.web?.results || []).map(r => ({
        title: r.title,
        url: r.url,
        snippet: r.description,
      }));
    }

    if (config.provider === "serper") {
      const baseUrl = config.baseUrl || "https://google.serper.dev/search";
      const response = await fetch(baseUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-KEY": config.apiKey,
        },
        body: JSON.stringify({ q: query, num: 5 }),
      });

      if (!response.ok) {
        console.warn(`[Agent] Serper search returned ${response.status} for query: ${query}`);
        return [];
      }

      const data = await response.json() as {
        organic?: Array<{ title: string; link: string; snippet: string }>;
      };
      return (data.organic || []).map(r => ({
        title: r.title,
        url: r.link,
        snippet: r.snippet,
      }));
    }

    console.warn(`[Agent] Unknown search provider: ${config.provider}`);
    return [];
  } catch (err) {
    console.warn(`[Agent] Web search failed: ${err}`);
    return [];
  }
}

async function logAgentStep(
  runId: string,
  phase: string,
  stepName: string,
  promptSent: string,
  responseReceived: string,
  modelUsed: string,
  providerUsed: string,
  durationMs: number,
  success: boolean,
  errorMessage?: string,
): Promise<void> {
  try {
    await db.insert(schema.agentStepLogs).values({
      runId,
      phase,
      stepName,
      promptSent,
      responseReceived,
      modelUsed,
      providerUsed,
      durationMs,
      success,
      errorMessage: errorMessage || null,
    });
  } catch (err) {
    console.error("[Agent] Failed to write step log:", err);
  }
}

async function updateRunPhase(
  runId: string,
  currentPhase: string | null,
  phaseLogEntry: PhaseLogEntry | null,
  updates: Partial<{ errorPhase: string; errorReason: string }> = {},
): Promise<void> {
  const run = await db.select({ phaseLog: schema.leadGenerationRuns.phaseLog })
    .from(schema.leadGenerationRuns)
    .where(eq(schema.leadGenerationRuns.id, runId))
    .limit(1);

  const existingLog = (run[0]?.phaseLog as PhaseLogEntry[] | null) || [];

  let newLog = [...existingLog];
  if (phaseLogEntry) {
    const idx = newLog.findIndex(e => e.phase === phaseLogEntry.phase);
    if (idx >= 0) {
      newLog[idx] = phaseLogEntry;
    } else {
      newLog.push(phaseLogEntry);
    }
  }

  await db.update(schema.leadGenerationRuns)
    .set({
      currentPhase: currentPhase ?? undefined,
      phaseLog: newLog,
      ...updates,
      updatedAt: new Date(),
    })
    .where(eq(schema.leadGenerationRuns.id, runId));
}

function extractJsonFromText(text: string): unknown {
  // 1. Explicit ```json ... ``` code fence
  const jsonFence = text.match(/```json\s*([\s\S]*?)```/);
  if (jsonFence) {
    try { return JSON.parse(jsonFence[1].trim()); } catch { /* continue */ }
  }

  // 2. Any ``` ... ``` code fence
  const anyFence = text.match(/```(?:\w*\n)?([\s\S]*?)```/);
  if (anyFence) {
    try { return JSON.parse(anyFence[1].trim()); } catch { /* continue */ }
  }

  // 3. Bracket-depth scanning — finds the first complete JSON array or object,
  //    correctly handles nested brackets and brackets inside strings.
  //    This avoids the greedy-regex trap where [first [ ... last ]] picks up wrong spans.
  for (const startChar of ['[', '{']) {
    const endChar = startChar === '[' ? ']' : '}';
    const startIdx = text.indexOf(startChar);
    if (startIdx === -1) continue;

    let depth = 0;
    let inString = false;
    let escape = false;

    for (let i = startIdx; i < text.length; i++) {
      const ch = text[i];
      if (escape) { escape = false; continue; }
      if (ch === '\\' && inString) { escape = true; continue; }
      if (ch === '"') { inString = !inString; continue; }
      if (inString) continue;
      if (ch === startChar) depth++;
      else if (ch === endChar) {
        depth--;
        if (depth === 0) {
          try { return JSON.parse(text.slice(startIdx, i + 1)); } catch { break; }
        }
      }
    }
  }

  // 4. Whole text as JSON
  try { return JSON.parse(text.trim()); } catch { /* */ }

  return null;
}

async function runMarketResearchPhase(
  runId: string,
  icpVersion: schema.IcpProfileVersion | null,
  offers: schema.Offer[],
  config: ResolvedLlmConfig,
): Promise<{ marketInsights: string; targetIndustries: string[]; searchResults: { title: string; url: string; snippet: string }[] }> {
  const industries = icpVersion?.targetIndustries?.join(", ") || "technology, healthcare, finance";
  const sizes = icpVersion?.targetCompanySizes?.join(", ") || "50-5000 employees";
  const geos = icpVersion?.targetGeographies?.join(", ") || "North America";

  const searchQuery = `${industries} industry trends market size growth 2024 2025`;
  const searchResults = await performWebSearch(searchQuery);

  // Log search query as a step in the audit trail
  await logAgentStep(runId, "market_research", "web_search", searchQuery,
    searchResults.map(r => `${r.title} (${r.url}): ${r.snippet}`).join("\n") || "(no results)",
    "brave-search", "brave", 0, true);

  const searchContext = searchResults.length > 0
    ? `\n\nRecent web research:\n${searchResults.map(r => `- ${r.title}: ${r.snippet}`).join("\n")}`
    : "";

  const systemPrompt = `You are a market research specialist for a B2B sales team. 
Your task is to analyze the target market and identify key insights for lead generation.
CRITICAL INSTRUCTION: Your entire response must be ONLY a valid JSON object. No preamble, no explanation, no markdown, no code fences. Start your response with { and end with }.`;

  const userPrompt = `Analyze the B2B target market with these parameters:
- Target Industries: ${industries}
- Company Sizes: ${sizes}
- Target Geographies: ${geos}
- Our Offerings: ${offers.map(o => o.name + (o.valueProposition ? ` (${o.valueProposition})` : "")).join(", ")}
${searchContext}

Respond with JSON:
{
  "marketInsights": "3-4 sentences on current market conditions and why now is good time to target this market",
  "keyTrends": ["trend1", "trend2", "trend3"],
  "targetIndustries": ["specific industry segment 1", "specific industry segment 2"],
  "buyingSignals": ["signal indicating a company is ready to buy"]
}`;

  const startTime = Date.now();
  let response = "";
  try {
    response = await callLlm(config, systemPrompt, userPrompt);
    const durationMs = Date.now() - startTime;
    await logAgentStep(runId, "market_research", "analyze_market", userPrompt, response, config.model, config.provider, durationMs, true);

    const parsed = extractJsonFromText(response) as {
      marketInsights?: string;
      targetIndustries?: string[];
    } | null;
    return {
      marketInsights: parsed?.marketInsights || "Market shows strong demand for solutions in this space.",
      targetIndustries: parsed?.targetIndustries || (icpVersion?.targetIndustries || []),
      searchResults,
    };
  } catch (err) {
    const durationMs = Date.now() - startTime;
    const errorMsg = err instanceof Error ? err.message : String(err);
    await logAgentStep(runId, "market_research", "analyze_market", userPrompt, response, config.model, config.provider, durationMs, false, errorMsg);
    throw err;
  }
}

async function runCompanyDiscoveryPhase(
  runId: string,
  icpVersion: schema.IcpProfileVersion | null,
  marketInsights: string,
  targetIndustries: string[],
  targetCount: number,
  config: ResolvedLlmConfig,
): Promise<schema.CandidateAccount[]> {
  const industries = targetIndustries.length > 0
    ? targetIndustries
    : (icpVersion?.targetIndustries || ["technology"]);
  const sizes = icpVersion?.targetCompanySizes?.join(", ") || "100-5000 employees";
  const geos = icpVersion?.targetGeographies?.join(", ") || "North America";
  const titles = icpVersion?.targetTitles?.join(", ") || "VP of Sales, CTO, CEO";
  const numCompanies = Math.min(targetCount, 20);

  const searchQuery = `${industries.slice(0, 2).join(" ")} companies ${sizes} ${geos} site:linkedin.com OR site:crunchbase.com OR site:g2.com`;
  const searchResults = await performWebSearch(searchQuery);

  // Log search query as a step in the audit trail
  await logAgentStep(runId, "company_discovery", "web_search", searchQuery,
    searchResults.map(r => `${r.title} (${r.url}): ${r.snippet}`).join("\n") || "(no results)",
    "brave-search", "brave", 0, true);

  const searchContext = searchResults.length > 0
    ? `\n\nWeb research results:\n${searchResults.map(r => `- ${r.title} (${r.url}): ${r.snippet}`).join("\n")}`
    : "";

  const systemPrompt = `You are a company discovery specialist finding target accounts for B2B sales.
You identify companies that match specific ideal customer profile criteria.
CRITICAL INSTRUCTION: Your entire response must be ONLY a valid JSON array. No preamble, no explanation, no markdown, no code fences. Start your response with [ and end with ].`;

  const userPrompt = `Discover ${numCompanies} companies that match this ICP:
- Industries: ${industries.join(", ")}
- Company sizes: ${sizes}
- Geographies: ${geos}
- Decision-maker roles we target: ${titles}

Market context: ${marketInsights}
${searchContext}

Respond with a JSON array of exactly ${numCompanies} companies:
[
  {
    "name": "Company Name",
    "domain": "company.com",
    "industry": "specific industry",
    "companySize": "size range e.g. 200-500",
    "geography": "city, country",
    "description": "2-3 sentence company description",
    "icpFitRationale": "2-3 sentences why this company fits the ICP",
    "companyOverview": "Comprehensive 3-4 sentence overview of the company",
    "strategicApproach": "2-3 sentences on how to approach this company",
    "website": "https://www.company.com",
    "linkedinUrl": "https://www.linkedin.com/company/company-name"
  }
]`;

  const startTime = Date.now();
  let response = "";
  try {
    response = await callLlm(config, systemPrompt, userPrompt);
    const durationMs = Date.now() - startTime;
    await logAgentStep(runId, "company_discovery", "discover_companies", userPrompt, response, config.model, config.provider, durationMs, true);

    const parsed = extractJsonFromText(response) as Array<{
      name?: string;
      domain?: string;
      industry?: string;
      companySize?: string;
      geography?: string;
      description?: string;
      icpFitRationale?: string;
      companyOverview?: string;
      strategicApproach?: string;
      website?: string;
      linkedinUrl?: string;
    }> | null;

    if (!Array.isArray(parsed) || parsed.length === 0) {
      console.error("[Agent] company_discovery parse failed. Raw response (first 1000 chars):", response.slice(0, 1000));
      throw new Error("LLM did not return a valid array of companies");
    }

    const accounts: schema.CandidateAccount[] = [];
    for (const company of parsed.slice(0, numCompanies)) {
      const companyName: string | undefined = company.name;
      if (!companyName) continue;

      const [inserted] = await db.insert(schema.candidateAccounts).values({
        runId,
        name: companyName,
        domain: company.domain || null,
        website: company.website || null,
        industry: company.industry || null,
        companySize: company.companySize || null,
        geography: company.geography || null,
        description: company.description || null,
        icpFitRationale: company.icpFitRationale || null,
        companyOverview: company.companyOverview || null,
        strategicApproach: company.strategicApproach || null,
        sourceAgentPhase: "company_discovery",
        linkedinUrl: company.linkedinUrl || null,
      }).returning();

      if (inserted) {
        accounts.push(inserted);

        if (searchResults.length > 0) {
          const relevantSearch = searchResults.find(r =>
            r.title.toLowerCase().includes(companyName.toLowerCase()) ||
            (company.domain && r.url.includes(company.domain))
          );
          if (relevantSearch) {
            await db.insert(schema.evidenceSources).values({
              candidateAccountId: inserted.id,
              sourceType: "other",
              url: relevantSearch.url,
              title: relevantSearch.title,
              content: relevantSearch.snippet,
            });
          }
        }
      }
    }

    return accounts;
  } catch (err) {
    const durationMs = Date.now() - startTime;
    const errorMsg = err instanceof Error ? err.message : String(err);
    await logAgentStep(runId, "company_discovery", "discover_companies", userPrompt, response, config.model, config.provider, durationMs, false, errorMsg);
    throw err;
  }
}

async function runContactDiscoveryPhase(
  runId: string,
  accounts: schema.CandidateAccount[],
  icpVersion: schema.IcpProfileVersion | null,
  config: ResolvedLlmConfig,
): Promise<{ contacts: schema.CandidateContact[]; leads: schema.CandidateLead[] }> {
  const targetTitles = icpVersion?.targetTitles?.join(", ") || "VP of Sales, CTO, CEO, Head of Operations";
  const allContacts: schema.CandidateContact[] = [];
  const allLeads: schema.CandidateLead[] = [];
  const accountsToProcess = accounts.slice(0, 15);
  let successCount = 0;
  const lastError: string[] = [];

  for (const account of accountsToProcess) {
    const searchQuery = `${account.name} executives decision makers ${targetTitles} site:linkedin.com`;
    const searchResults = await performWebSearch(searchQuery);

    // Log the search query itself as an evidence source
    if (searchResults.length > 0) {
      await db.insert(schema.evidenceSources).values({
        candidateAccountId: account.id,
        sourceType: "other",
        url: `https://search.brave.com/search?q=${encodeURIComponent(searchQuery)}`,
        title: `Search: ${searchQuery}`,
        content: searchResults.map(r => `${r.title}: ${r.snippet}`).join("\n"),
      });
    }

    const searchContext = searchResults.length > 0
      ? `\n\nWeb research:\n${searchResults.map(r => `- ${r.title}: ${r.snippet}`).join("\n")}`
      : "";

    const systemPrompt = `You are a contact discovery specialist finding B2B decision-makers.
CRITICAL INSTRUCTION: Your entire response must be ONLY a valid JSON array. No preamble, no explanation, no markdown, no code fences. Start your response with [ and end with ].`;

    const userPrompt = `Find 2-3 key decision-maker contacts at ${account.name} (${account.industry || "technology"} company, ${account.companySize || "mid-size"}).
Target roles: ${targetTitles}
Company overview: ${account.companyOverview || account.description || "No description available"}
${searchContext}

Respond with a JSON array of 2-3 contacts:
[
  {
    "firstName": "First",
    "lastName": "Last",
    "title": "VP of Sales",
    "email": "first.last@${account.domain || "company.com"}",
    "linkedinUrl": "https://www.linkedin.com/in/first-last",
    "roleFitRationale": "2-3 sentences why this person is a good contact",
    "outreachPriority": "high|medium|low"
  }
]`;

    const startTime = Date.now();
    let response = "";
    try {
      response = await callLlm(config, systemPrompt, userPrompt);
      const durationMs = Date.now() - startTime;
      await logAgentStep(runId, "contact_discovery", `discover_contacts_${account.id}`, userPrompt, response, config.model, config.provider, durationMs, true);

      const parsed = extractJsonFromText(response) as Array<{
        firstName?: string;
        lastName?: string;
        title?: string;
        email?: string;
        linkedinUrl?: string;
        roleFitRationale?: string;
        outreachPriority?: string;
      }> | null;

      if (!Array.isArray(parsed)) {
        lastError.push(`No contact array returned for ${account.name}`);
        continue;
      }

      for (const contactData of parsed.slice(0, 3)) {
        if (!contactData.firstName || !contactData.lastName) continue;

        const [contact] = await db.insert(schema.candidateContacts).values({
          runId,
          candidateAccountId: account.id,
          firstName: contactData.firstName,
          lastName: contactData.lastName,
          title: contactData.title || null,
          email: contactData.email || null,
          linkedinUrl: contactData.linkedinUrl || null,
          roleFitRationale: contactData.roleFitRationale || null,
          outreachPriority: contactData.outreachPriority || "medium",
          sourceAgentPhase: "contact_discovery",
        }).returning();

        if (contact) {
          allContacts.push(contact);

          const tier = contactData.outreachPriority === "high" ? "tier_1"
            : contactData.outreachPriority === "low" ? "tier_3" : "tier_2";

          const [lead] = await db.insert(schema.candidateLeads).values({
            runId,
            candidateAccountId: account.id,
            candidateContactId: contact.id,
            tier,
            status: "pending_review",
          }).returning();

          if (lead) allLeads.push(lead);
        }
      }
      successCount++;
    } catch (err) {
      const durationMs = Date.now() - startTime;
      const errorMsg = err instanceof Error ? err.message : String(err);
      await logAgentStep(runId, "contact_discovery", `discover_contacts_${account.id}`, userPrompt, response, config.model, config.provider, durationMs, false, errorMsg);
      lastError.push(errorMsg);
      console.warn(`[Agent] Contact discovery failed for account ${account.name}: ${errorMsg}`);
    }
  }

  // If no accounts succeeded at all, treat it as a phase failure
  if (accountsToProcess.length > 0 && successCount === 0) {
    throw new Error(`Contact discovery failed for all ${accountsToProcess.length} accounts. Last error: ${lastError[lastError.length - 1] || "unknown"}`);
  }

  return { contacts: allContacts, leads: allLeads };
}

async function runStrategyPhase(
  runId: string,
  accounts: schema.CandidateAccount[],
  offers: schema.Offer[],
  config: ResolvedLlmConfig,
): Promise<void> {
  const accountsToProcess = accounts.slice(0, 15);
  let successCount = 0;
  const lastError: string[] = [];

  for (const account of accountsToProcess) {
    const systemPrompt = `You are a B2B sales strategist. Create targeted strategic approach documents for accounts.
CRITICAL INSTRUCTION: Your entire response must be ONLY a valid JSON object. No preamble, no explanation, no markdown, no code fences. Start your response with { and end with }.`;

    const userPrompt = `Create a strategic sales approach for ${account.name}:
- Industry: ${account.industry || "technology"}
- Company Size: ${account.companySize || "unknown"}
- ICP Fit Rationale: ${account.icpFitRationale || "Good fit"}
- Our offerings: ${offers.map(o => o.name + (o.valueProposition ? ` - ${o.valueProposition}` : "")).join("; ")}

Respond with JSON:
{
  "strategicApproach": "3-4 sentence detailed strategic approach",
  "keyPainPoints": ["pain point 1", "pain point 2"],
  "differentiators": ["why our solution stands out for this company"],
  "recommendedFirstMove": "specific first outreach recommendation"
}`;

    const startTime = Date.now();
    let response = "";
    try {
      response = await callLlm(config, systemPrompt, userPrompt);
      const durationMs = Date.now() - startTime;
      await logAgentStep(runId, "strategy", `strategy_${account.id}`, userPrompt, response, config.model, config.provider, durationMs, true);

      const parsed = extractJsonFromText(response) as {
        strategicApproach?: string;
      } | null;

      if (parsed?.strategicApproach && !account.strategicApproach) {
        await db.update(schema.candidateAccounts)
          .set({ strategicApproach: parsed.strategicApproach, updatedAt: new Date() })
          .where(eq(schema.candidateAccounts.id, account.id));
      }

      await db.insert(schema.researchDocuments).values({
        entityType: "candidate_account",
        entityId: account.id,
        documentType: "strategic_approach",
        title: `Strategic Approach: ${account.name}`,
        content: response,
        sourceAgentPhase: "strategy",
        runId,
      });
      successCount++;
    } catch (err) {
      const durationMs = Date.now() - startTime;
      const errorMsg = err instanceof Error ? err.message : String(err);
      await logAgentStep(runId, "strategy", `strategy_${account.id}`, userPrompt, response, config.model, config.provider, durationMs, false, errorMsg);
      lastError.push(errorMsg);
      console.warn(`[Agent] Strategy phase failed for account ${account.name}: ${errorMsg}`);
    }
  }

  if (accountsToProcess.length > 0 && successCount === 0) {
    throw new Error(`Strategy phase failed for all ${accountsToProcess.length} accounts. Last error: ${lastError[lastError.length - 1] || "unknown"}`);
  }
}

async function runCommunicationDraftingPhase(
  runId: string,
  leads: schema.CandidateLead[],
  config: ResolvedLlmConfig,
): Promise<void> {
  const leadsToProcess = leads.slice(0, 30);
  let successCount = 0;
  const lastError: string[] = [];

  for (const lead of leadsToProcess) {
    let contact: schema.CandidateContact | null = null;
    let account: schema.CandidateAccount | null = null;

    if (lead.candidateContactId) {
      const contactRows = await db.select().from(schema.candidateContacts)
        .where(eq(schema.candidateContacts.id, lead.candidateContactId)).limit(1);
      contact = contactRows[0] || null;
    }
    if (lead.candidateAccountId) {
      const accountRows = await db.select().from(schema.candidateAccounts)
        .where(eq(schema.candidateAccounts.id, lead.candidateAccountId)).limit(1);
      account = accountRows[0] || null;
    }

    if (!contact || !account) continue;

    const systemPrompt = `You are a B2B sales communication specialist. 
Draft personalized outreach messages tailored to specific contacts.
CRITICAL INSTRUCTION: Your entire response must be ONLY a valid JSON object. No preamble, no explanation, no markdown, no code fences. Start your response with { and end with }.`;

    const userPrompt = `Draft a personalized outreach communication plan for:
- Contact: ${contact.firstName} ${contact.lastName}, ${contact.title || "executive"} at ${account.name}
- Role Fit: ${contact.roleFitRationale || "Good match for our solution"}
- Company: ${account.industry || "technology"} company, ${account.companySize || "mid-size"}
- Strategic Context: ${account.strategicApproach || account.icpFitRationale || "Strong ICP fit"}
- Outreach Priority: ${contact.outreachPriority || "medium"}

Respond with JSON:
{
  "channelRecommendation": "email|linkedin|call",
  "tone": "professional|consultative|direct|warm",
  "objectives": ["primary objective", "secondary objective"],
  "subjectLine": "Email subject line",
  "draftedMessage": "Full personalized message (3-4 paragraphs)",
  "followUpSequence": ["day 3: follow up action", "day 7: action"]
}`;

    const startTime = Date.now();
    let response = "";
    try {
      response = await callLlm(config, systemPrompt, userPrompt);
      const durationMs = Date.now() - startTime;
      await logAgentStep(runId, "communication_drafting", `draft_${lead.id}`, userPrompt, response, config.model, config.provider, durationMs, true);

      const parsed = extractJsonFromText(response) as {
        channelRecommendation?: string;
        tone?: string;
        objectives?: string[];
        subjectLine?: string;
        draftedMessage?: string;
        followUpSequence?: string[];
      } | null;

      if (parsed) {
        await db.update(schema.candidateLeads)
          .set({ communicationPlan: parsed, updatedAt: new Date() })
          .where(eq(schema.candidateLeads.id, lead.id));

        await db.insert(schema.researchDocuments).values({
          entityType: "candidate_lead",
          entityId: lead.id,
          documentType: "communication_draft",
          title: `Communication Plan: ${contact.firstName} ${contact.lastName} @ ${account.name}`,
          content: parsed.draftedMessage || response,
          sourceAgentPhase: "communication_drafting",
          runId,
        });
        successCount++;
      }
    } catch (err) {
      const durationMs = Date.now() - startTime;
      const errorMsg = err instanceof Error ? err.message : String(err);
      await logAgentStep(runId, "communication_drafting", `draft_${lead.id}`, userPrompt, response, config.model, config.provider, durationMs, false, errorMsg);
      lastError.push(errorMsg);
      console.warn(`[Agent] Communication drafting failed for lead ${lead.id}: ${errorMsg}`);
    }
  }

  if (leadsToProcess.length > 0 && successCount === 0) {
    throw new Error(`Communication drafting failed for all ${leadsToProcess.length} leads. Last error: ${lastError[lastError.length - 1] || "unknown"}`);
  }
}

export async function runLeadGenPipeline(runId: string, startFromPhase?: string): Promise<void> {
  console.log(`[Agent] Starting pipeline for run ${runId}${startFromPhase ? ` from phase ${startFromPhase}` : ""}`);

  // Reset search config cache so each pipeline run re-reads from DB
  _cachedSearchConfig = undefined;

  const runRows = await db.select().from(schema.leadGenerationRuns)
    .where(eq(schema.leadGenerationRuns.id, runId)).limit(1);
  const run = runRows[0];
  if (!run) throw new Error(`Run ${runId} not found`);

  let icpVersion: schema.IcpProfileVersion | null = null;
  if (run.icpVersionId) {
    const vRows = await db.select().from(schema.icpProfileVersions)
      .where(eq(schema.icpProfileVersions.id, run.icpVersionId)).limit(1);
    icpVersion = vRows[0] || null;
  } else if (run.icpProfileId) {
    const vRows = await db.select().from(schema.icpProfileVersions)
      .where(and(
        eq(schema.icpProfileVersions.icpProfileId, run.icpProfileId),
        eq(schema.icpProfileVersions.isActive, true),
      ))
      .orderBy(desc(schema.icpProfileVersions.versionNumber))
      .limit(1);
    icpVersion = vRows[0] || null;
  }

  const offers = run.icpProfileId
    ? await db.select().from(schema.offers)
        .where(and(eq(schema.offers.icpProfileId, run.icpProfileId), eq(schema.offers.isActive, true)))
    : [];

  const targetCount = run.targetCount ?? 10;
  const phaseStartIndex = startFromPhase ? PHASES.indexOf(startFromPhase as Phase) : 0;
  const phasesToRun = phaseStartIndex >= 0 ? PHASES.slice(phaseStartIndex) : PHASES;

  let marketInsights = "Strong market opportunity identified.";
  let targetIndustries: string[] = icpVersion?.targetIndustries || [];
  let discoveredAccounts: schema.CandidateAccount[] = [];
  let discoveredLeads: schema.CandidateLead[] = [];

  if (startFromPhase) {
    // Deduplication: delete entities that will be regenerated by the phases being (re)run,
    // to prevent duplicates when retrying from a phase.
    const phaseIdx = phaseStartIndex >= 0 ? phaseStartIndex : 0;
    const willRunContactDiscovery = phaseIdx <= PHASES.indexOf("contact_discovery");
    const willRunCompanyDiscovery = phaseIdx <= PHASES.indexOf("company_discovery");

    // Deduplication rules:
    // - contact_discovery CREATES candidate_leads and candidate_contacts; delete them so they are recreated cleanly.
    // - company_discovery CREATES candidate_accounts; delete them so they are recreated cleanly.
    // - communication_drafting only UPDATES candidate_leads (sets communication_plan), NOT creates them.
    //   Retrying communication_drafting must NOT delete leads — they are its required input.
    // - strategy only UPDATES candidate_accounts in-place; no deletion needed.
    if (willRunContactDiscovery) {
      await db.delete(schema.candidateLeads).where(eq(schema.candidateLeads.runId, runId));
      await db.delete(schema.candidateContacts).where(eq(schema.candidateContacts.runId, runId));
    }
    if (willRunCompanyDiscovery) {
      await db.delete(schema.candidateAccounts).where(eq(schema.candidateAccounts.runId, runId));
    }

    if (startFromPhase !== "market_research") {
      discoveredAccounts = await db.select().from(schema.candidateAccounts)
        .where(eq(schema.candidateAccounts.runId, runId));
      discoveredLeads = await db.select().from(schema.candidateLeads)
        .where(eq(schema.candidateLeads.runId, runId));
    }
  }

  for (const phase of phasesToRun) {
    const config = await getLlmConfig(phase);

    if (!config) {
      const setupError =
        "No AI provider configured. To run the pipeline:\n\n" +
        "1. Go to Admin Console → AI Configuration tab\n" +
        "2. Choose a provider (OpenAI, Anthropic, Google, or Azure)\n" +
        "3. Enter your API key and click Save Configuration\n\n" +
        "Supported providers:\n" +
        "  • OpenAI — get a key at platform.openai.com/api-keys\n" +
        "  • Anthropic — get a key at console.anthropic.com\n" +
        "  • Google AI — get a key at aistudio.google.com/app/apikey\n" +
        "  • Azure OpenAI — requires your Azure endpoint URL and deployment key";
      throw new Error(setupError);
    }

    const phaseEntry: PhaseLogEntry = {
      phase,
      startedAt: new Date().toISOString(),
      status: "running",
    };
    await updateRunPhase(runId, phase, phaseEntry);

    try {
      console.log(`[Agent] Running phase: ${phase} with model ${config.model}`);

      if (phase === "market_research") {
        const result = await runMarketResearchPhase(runId, icpVersion, offers, config);
        marketInsights = result.marketInsights;
        targetIndustries = result.targetIndustries.length > 0 ? result.targetIndustries : targetIndustries;
      } else if (phase === "company_discovery") {
        discoveredAccounts = await runCompanyDiscoveryPhase(
          runId, icpVersion, marketInsights, targetIndustries, targetCount, config
        );
      } else if (phase === "contact_discovery") {
        if (discoveredAccounts.length === 0) {
          discoveredAccounts = await db.select().from(schema.candidateAccounts)
            .where(eq(schema.candidateAccounts.runId, runId));
        }
        const result = await runContactDiscoveryPhase(runId, discoveredAccounts, icpVersion, config);
        discoveredLeads = result.leads;
      } else if (phase === "strategy") {
        if (discoveredAccounts.length === 0) {
          discoveredAccounts = await db.select().from(schema.candidateAccounts)
            .where(eq(schema.candidateAccounts.runId, runId));
        }
        await runStrategyPhase(runId, discoveredAccounts, offers, config);
      } else if (phase === "communication_drafting") {
        if (discoveredLeads.length === 0) {
          discoveredLeads = await db.select().from(schema.candidateLeads)
            .where(eq(schema.candidateLeads.runId, runId));
        }
        await runCommunicationDraftingPhase(runId, discoveredLeads, config);
      }

      const phaseEnd = Date.now();
      phaseEntry.completedAt = new Date().toISOString();
      phaseEntry.durationMs = phaseEnd - new Date(phaseEntry.startedAt).getTime();
      phaseEntry.status = "success";
      await updateRunPhase(runId, phase, phaseEntry);
      console.log(`[Agent] Phase ${phase} completed in ${phaseEntry.durationMs}ms`);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error(`[Agent] Phase ${phase} failed: ${errorMsg}`);

      const phaseEnd = Date.now();
      phaseEntry.completedAt = new Date().toISOString();
      phaseEntry.durationMs = phaseEnd - new Date(phaseEntry.startedAt).getTime();
      phaseEntry.status = "error";
      phaseEntry.errorMessage = errorMsg;

      // Transition run to explicit error state
      await updateRunPhase(runId, phase, phaseEntry, {
        errorPhase: phase,
        errorReason: errorMsg,
      });
      await db.update(schema.leadGenerationRuns)
        .set({ status: "error", updatedAt: new Date() })
        .where(eq(schema.leadGenerationRuns.id, runId));
      return;
    }
  }

  const totalLeadsResult = await db.select({ count: sql<number>`count(*)::int` })
    .from(schema.candidateLeads)
    .where(eq(schema.candidateLeads.runId, runId));

  const totalLeadCount = totalLeadsResult[0]?.count ?? discoveredLeads.length;

  await db.update(schema.leadGenerationRuns)
    .set({
      currentPhase: "complete",
      candidateCount: totalLeadCount,
      errorPhase: null,
      errorReason: null,
      updatedAt: new Date(),
    })
    .where(eq(schema.leadGenerationRuns.id, runId));

  console.log(`[Agent] Pipeline complete for run ${runId}`);
}
