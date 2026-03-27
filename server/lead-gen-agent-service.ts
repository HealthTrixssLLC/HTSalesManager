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
import { isAzureWebSearchConfigured, AzureWebSearchProvider } from "./lib/research/providers/AzureWebSearchProvider";
import { researchService } from "./lib/research/ResearchService";

let _cachedAzureProvider: AzureWebSearchProvider | null | undefined = undefined;

async function getOrBuildAzureSearchProvider(): Promise<AzureWebSearchProvider | null> {
  if (_cachedAzureProvider !== undefined) return _cachedAzureProvider;

  if (isAzureWebSearchConfigured()) {
    try {
      _cachedAzureProvider = new AzureWebSearchProvider();
      return _cachedAzureProvider;
    } catch {
      // fall through to DB fallback
    }
  }

  const llmConfig = await getLlmConfig("market_research");
  if (llmConfig && llmConfig.provider === "azure" && llmConfig.apiKey && llmConfig.baseUrl) {
    console.log("[Agent] Azure web search: using DB LLM config (no env vars set)");
    _cachedAzureProvider = new AzureWebSearchProvider({
      apiKey: llmConfig.apiKey,
      baseUrl: llmConfig.baseUrl,
      model: llmConfig.model,
    });
    return _cachedAzureProvider;
  }

  _cachedAzureProvider = null;
  return null;
}

const PHASES = [
  "market_research",
  "company_discovery",
  "contact_discovery",
  "strategy",
  "communication_drafting",
] as const;

const stoppedRunIds = new Set<string>();
const activeRunIds = new Set<string>();

export function markRunStopped(runId: string): void {
  stoppedRunIds.add(runId);
}

export function clearRunStopped(runId: string): void {
  stoppedRunIds.delete(runId);
}

export function isRunPipelineActive(runId: string): boolean {
  return activeRunIds.has(runId);
}

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

  // Azure OpenAI web search takes priority when env vars are set
  if (isAzureWebSearchConfigured()) {
    _cachedSearchConfig = { provider: "azure_web_search", apiKey: process.env.AZURE_OPENAI_API_KEY || "" };
    return _cachedSearchConfig;
  }

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

  // Final fallback: if DB LLM config is Azure, use it for web search too (no separate env vars needed)
  const llmCfg = await getLlmConfig("market_research");
  if (llmCfg && llmCfg.provider === "azure" && llmCfg.apiKey) {
    _cachedSearchConfig = { provider: "azure_web_search", apiKey: llmCfg.apiKey, baseUrl: llmCfg.baseUrl };
    return _cachedSearchConfig;
  }

  _cachedSearchConfig = null;
  return null;
}

async function performWebSearch(query: string): Promise<{ title: string; url: string; snippet: string; citations?: { title: string; url: string }[] }[]> {
  const config = await getSearchConfig();

  if (!config) {
    console.log(`[Agent] Web search skipped (no search provider configured), query: ${query}`);
    return [];
  }

  if (config.provider === "azure_web_search") {
    const azureProvider = await getOrBuildAzureSearchProvider();
    if (azureProvider) {
      return await azureProvider.search(query);
    }
    console.warn("[Agent] Azure web search config resolved but provider could not be built");
    return [];
  }

  // Brave and Serper: errors are logged and return empty rather than aborting the run,
  // as these are legacy fallback providers and market research is best-effort.
  try {
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
    console.warn(`[Agent] Web search failed (${config.provider}): ${err}`);
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

// ──────────────────────────────────────────────────────────────
// ICP context helpers — enrich prompts with ICP profile data
// ──────────────────────────────────────────────────────────────

function formatScoringRubric(rubric: unknown): string {
  if (!rubric || typeof rubric !== "object") return "";
  const r = rubric as { criteria?: Array<{ name: string; weight: number }> };
  if (!Array.isArray(r.criteria) || r.criteria.length === 0) return "";
  return r.criteria
    .filter(c => c.name && c.weight != null)
    .map(c => `${c.name} (${c.weight}%)`)
    .join(", ");
}

function buildIcpContextSection(
  icpProfile: schema.IcpProfile | null,
  icpVersion: schema.IcpProfileVersion | null,
  includeScoringRubric = false,
): string {
  const parts: string[] = [];
  if (icpProfile?.description) {
    parts.push(`ICP Description: ${icpProfile.description}`);
  }
  if (icpVersion?.notes) {
    parts.push(`ICP Notes: ${icpVersion.notes}`);
  }
  if (includeScoringRubric && icpVersion?.scoringRubric) {
    const rubricStr = formatScoringRubric(icpVersion.scoringRubric);
    if (rubricStr) {
      parts.push(`Qualification criteria (use these to score and prioritize): ${rubricStr}`);
    }
  }
  return parts.length > 0 ? "\n\n" + parts.join("\n") : "";
}

function formatOffersSection(offers: schema.Offer[]): string {
  if (offers.length === 0) return "";
  return offers.map(o => {
    const lines = [`- ${o.name}`];
    if (o.valueProposition) lines.push(`  Value Proposition: ${o.valueProposition}`);
    if (o.description) lines.push(`  Description: ${o.description}`);
    return lines.join("\n");
  }).join("\n");
}

// ──────────────────────────────────────────────────────────────
// Playbook helpers
// ──────────────────────────────────────────────────────────────

function buildPlaybookContextSection(
  playbook: schema.TaskPlaybook | null,
  steps: schema.TaskPlaybookStep[],
): string {
  if (!playbook || steps.length === 0) return "";
  const sortedSteps = [...steps].sort((a, b) => a.stepOrder - b.stepOrder);
  const stepLines = sortedSteps.map(s => {
    const base = `  - Day ${s.dayOffset} | ${s.channel} (${s.activityType}): ${s.name}`;
    return s.description ? `${base} — ${s.description}` : base;
  });
  return `\n\nOutreach Sequence (Playbook: "${playbook.name}", ${steps.length} steps):\n${stepLines.join("\n")}\nKeep this channel mix, timing, and step intent in mind when assessing engagement fit and communication preferences.`;
}

async function runMarketResearchPhase(
  runId: string,
  icpVersion: schema.IcpProfileVersion | null,
  icpProfile: schema.IcpProfile | null,
  offers: schema.Offer[],
  playbook: schema.TaskPlaybook | null,
  playbookSteps: schema.TaskPlaybookStep[],
  config: ResolvedLlmConfig,
): Promise<{ marketInsights: string; targetIndustries: string[]; keyTrends: string[]; buyingSignals: string[]; searchResults: { title: string; url: string; snippet: string }[] }> {
  const industries = icpVersion?.targetIndustries?.join(", ") || "technology, healthcare, finance";
  const sizes = icpVersion?.targetCompanySizes?.join(", ") || "50-5000 employees";
  const geos = icpVersion?.targetGeographies?.join(", ") || "North America";

  const primaryIndustry = icpVersion?.targetIndustries?.[0] || "technology";
  const searchQuery = `${primaryIndustry} market trends growth 2024 2025 B2B software healthcare`;
  const searchConfig = await getSearchConfig();
  const searchResults = searchConfig ? await performWebSearch(searchQuery) : [];
  const searchProvider = searchConfig?.provider || "none";

  // Log search query as a step in the audit trail
  await logAgentStep(runId, "market_research", "web_search", searchQuery,
    searchResults.map(r => `${r.title} (${r.url}): ${r.snippet}`).join("\n") || "(no results)",
    searchProvider, searchProvider, 0, true);

  const searchContext = searchResults.length > 0
    ? `\n\nRecent web research:\n${searchResults.map(r => `- ${r.title}: ${r.snippet}`).join("\n")}`
    : "";

  const icpContext = buildIcpContextSection(icpProfile, icpVersion, false);
  const offersSection = formatOffersSection(offers);
  const playbookContext = buildPlaybookContextSection(playbook, playbookSteps);

  const systemPrompt = `You are a market research specialist for a B2B sales team. 
Your task is to analyze the target market and identify key insights for lead generation.
CRITICAL INSTRUCTION: Your entire response must be ONLY a valid JSON object. No preamble, no explanation, no markdown, no code fences. Start your response with { and end with }.`;

  const userPrompt = `Analyze the B2B target market with these parameters:
- Target Industries: ${industries}
- Company Sizes: ${sizes}
- Target Geographies: ${geos}
- Our Offerings:\n${offersSection}${icpContext}${playbookContext}
${searchContext}

Respond with JSON:
{
  "marketInsights": "3-4 sentences on current market conditions and why now is a good time to target this market",
  "keyTrends": ["specific market trend 1", "specific market trend 2", "specific market trend 3"],
  "targetIndustries": ["specific industry segment 1", "specific industry segment 2"],
  "buyingSignals": ["observable signal that a company is ready to buy or evaluate vendors"]
}`;

  const startTime = Date.now();
  let response = "";
  try {
    response = await callLlm(config, systemPrompt, userPrompt);
    const durationMs = Date.now() - startTime;
    await logAgentStep(runId, "market_research", "analyze_market", userPrompt, response, config.model, config.provider, durationMs, true);

    const parsed = extractJsonFromText(response) as {
      marketInsights?: string;
      keyTrends?: string[];
      targetIndustries?: string[];
      buyingSignals?: string[];
    } | null;
    return {
      marketInsights: parsed?.marketInsights || "Market shows strong demand for solutions in this space.",
      targetIndustries: parsed?.targetIndustries || (icpVersion?.targetIndustries || []),
      keyTrends: parsed?.keyTrends || [],
      buyingSignals: parsed?.buyingSignals || [],
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
  icpProfile: schema.IcpProfile | null,
  marketInsights: string,
  targetIndustries: string[],
  targetCount: number,
  config: ResolvedLlmConfig,
  playbook: schema.TaskPlaybook | null = null,
  playbookSteps: schema.TaskPlaybookStep[] = [],
): Promise<schema.CandidateAccount[]> {
  const industries = targetIndustries.length > 0
    ? targetIndustries
    : (icpVersion?.targetIndustries || ["technology"]);
  const sizes = icpVersion?.targetCompanySizes?.join(", ") || "100-5000 employees";
  const geos = icpVersion?.targetGeographies?.join(", ") || "North America";
  const titles = icpVersion?.targetTitles?.join(", ") || "VP of Sales, CTO, CEO";
  const numCompanies = Math.min(targetCount, 20);

  // Build a natural-language search query from ICP signals.
  // Size labels are filtering criteria, not search terms — omit them.
  // site: operators are avoided because Azure Responses API web_search treats
  // the input as natural language and site: restrictions prevent it from grounding results.
  const primaryIndustry = industries[0] || "technology";
  const secondaryIndustry = industries[1] || "";
  const topGeo = icpVersion?.targetGeographies?.[0] || "North America";
  const industryPart = secondaryIndustry
    ? `${primaryIndustry} ${secondaryIndustry}`
    : primaryIndustry;
  const searchQuery = [
    industryPart,
    "companies",
    topGeo,
  ].filter(Boolean).join(" ");
  const searchConfig = await getSearchConfig();
  if (!searchConfig) {
    throw new Error(
      "No search provider configured. Please set up Azure OpenAI web search or a Brave/Serper API key in Admin Console → AI Configuration."
    );
  }

  const searchResults = await performWebSearch(searchQuery);

  const searchProvider = searchConfig.provider;
  // Log search query as a step in the audit trail
  await logAgentStep(runId, "company_discovery", "web_search", searchQuery,
    searchResults.map(r => `${r.title} (${r.url}): ${r.snippet}`).join("\n") || "(no results)",
    searchProvider, searchProvider, 0, true);

  if (searchResults.length === 0) {
    console.warn("[Agent] No search results for company discovery — returning empty array to avoid hallucinations.");
    return [];
  }

  const searchContext = `\n\nWeb research results:\n${searchResults.map(r => `- ${r.title} (${r.url}): ${r.snippet}`).join("\n")}`;

  const icpContext = buildIcpContextSection(icpProfile, icpVersion, true);
  const playbookContext = buildPlaybookContextSection(playbook, playbookSteps);

  const systemPrompt = `You are a company discovery specialist finding target accounts for B2B sales.
You identify companies that match specific ideal customer profile criteria.
CRITICAL INSTRUCTION: Your entire response must be ONLY a valid JSON array. No preamble, no explanation, no markdown, no code fences. Start your response with [ and end with ].
CRITICAL INSTRUCTION: Only include companies that are explicitly mentioned or clearly referenced in the web research results provided. Do NOT fabricate, invent, or hallucinate company names or domains. Do NOT use placeholder values like "Company Name", "Example Corp", "company.com", or "example.com". If the search results do not contain enough real companies, return fewer entries or an empty array rather than inventing any.`;

  const userPrompt = `Discover up to ${numCompanies} companies that match this ICP:
- Industries: ${industries.join(", ")}
- Company sizes: ${sizes}
- Geographies: ${geos}
- Decision-maker roles we target: ${titles}

Market context: ${marketInsights}${icpContext}${playbookContext}
${searchContext}

Respond with a JSON array containing only real companies found in the web research above (return fewer than ${numCompanies} or an empty array [] if not enough real companies are found). Each object must have this shape:
{
  "name": "<actual company name from search results>",
  "domain": "<actual company domain>",
  "industry": "<specific industry>",
  "companySize": "<size range e.g. 200-500>",
  "geography": "<city, country>",
  "description": "<2-3 sentence company description>",
  "icpFitRationale": "<2-3 sentences why this company fits the ICP>",
  "companyOverview": "<comprehensive 3-4 sentence overview>",
  "strategicApproach": "<2-3 sentences on how to approach this company>",
  "website": "<actual company website URL>",
  "linkedinUrl": "<actual LinkedIn company page URL>"
}`;

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

    if (!Array.isArray(parsed)) {
      console.error("[Agent] company_discovery parse failed. Raw response (first 1000 chars):", response.slice(0, 1000));
      throw new Error("LLM did not return a valid array of companies");
    }

    if (parsed.length === 0) {
      console.warn("[Agent] company_discovery returned empty array — no companies found in search results, skipping.");
      return [];
    }

    const PLACEHOLDER_COMPANY_NAMES = new Set([
      "company name", "example corp", "example company", "acme", "acme corp",
      "your company", "client company", "sample company", "test company", "n/a", "unknown",
    ]);
    const PLACEHOLDER_DOMAINS = new Set([
      "company.com", "example.com", "yourcompany.com", "domain.com",
      "website.com", "mycompany.com", "test.com", "sample.com",
    ]);

    const searchContextText = searchResults.map(r =>
      `${r.title} ${r.url} ${r.snippet}`
    ).join(" ").toLowerCase();

    // Normalize target geographies into tokens for a case-insensitive geo check
    const targetGeoTokens = (icpVersion?.targetGeographies || [])
      .flatMap(g => g.toLowerCase().split(/[\s,/]+/))
      .filter(t => t.length > 2);

    const accounts: schema.CandidateAccount[] = [];
    for (const company of parsed.slice(0, numCompanies)) {
      const companyName: string | undefined = company.name;
      if (!companyName) continue;

      if (PLACEHOLDER_COMPANY_NAMES.has(companyName.toLowerCase().trim())) {
        console.warn(`[Agent] Skipping placeholder company name: "${companyName}"`);
        continue;
      }

      const rawDomain = company.domain?.toLowerCase().trim() || "";
      const domain = rawDomain
        .replace(/^https?:\/\//, "")
        .replace(/^www\./, "")
        .replace(/\/.*$/, "")
        .trim();
      if (domain && PLACEHOLDER_DOMAINS.has(domain)) {
        console.warn(`[Agent] Skipping company with placeholder domain: "${companyName}" (${domain})`);
        continue;
      }

      const nameNorm = companyName.toLowerCase();
      const domainInSearch = domain ? searchContextText.includes(domain) : false;
      const nameInSearch = searchContextText.includes(nameNorm);
      if (!nameInSearch && !domainInSearch) {
        console.warn(`[Agent] Skipping ungrounded company not found in search results: "${companyName}"`);
        continue;
      }

      // Geographic grounding check — warn (but do not skip) when the company's geography
      // or the search evidence contains none of the target geography tokens.
      // We log rather than skip to avoid false negatives from differing city/country naming.
      if (targetGeoTokens.length > 0) {
        const companyGeoNorm = (company.geography || "").toLowerCase();
        const geoInCompany = targetGeoTokens.some(t => companyGeoNorm.includes(t));
        const geoInSearch = targetGeoTokens.some(t => searchContextText.includes(t));
        if (!geoInCompany && !geoInSearch) {
          console.warn(
            `[Agent] Geographic mismatch: "${companyName}" geography "${company.geography}" ` +
            `does not match target geos [${icpVersion?.targetGeographies?.join(", ")}]. ` +
            `Including with lower confidence.`,
          );
        }
      }

      // Collect only per-company grounded citations from search results that mention this company.
      // Match on title, URL (domain), or snippet to maximize citation coverage for grounded companies.
      const companyCitations: { title: string; url: string }[] = [];
      const nameNormForCite = companyName.toLowerCase();
      const domainNormForCite = company.domain?.toLowerCase() || "";
      const relevantSearchResults = searchResults.filter(r => {
        const titleMatch = r.title.toLowerCase().includes(nameNormForCite);
        const urlMatch = domainNormForCite && r.url.toLowerCase().includes(domainNormForCite);
        const snippetMatch = r.snippet.toLowerCase().includes(nameNormForCite);
        return titleMatch || urlMatch || snippetMatch;
      });
      for (const r of relevantSearchResults) {
        // Include the result URL itself as a citation if it's non-empty
        if (r.url) {
          const existing = companyCitations.some(ex => ex.url === r.url);
          if (!existing) {
            companyCitations.push({ title: r.title || r.url, url: r.url });
          }
        }
        // Include any structured inline citations from this relevant result
        if (r.citations) {
          for (const c of r.citations) {
            if (c.url && !companyCitations.some(ex => ex.url === c.url)) {
              companyCitations.push(c);
            }
          }
        }
      }

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
        citations: companyCitations,
      }).returning();

      if (inserted) {
        accounts.push(inserted);

        if (relevantSearchResults.length > 0) {
          await db.insert(schema.evidenceSources).values({
            candidateAccountId: inserted.id,
            sourceType: "other",
            url: relevantSearchResults[0].url,
            title: relevantSearchResults[0].title,
            content: relevantSearchResults[0].snippet,
          });
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
  icpProfile: schema.IcpProfile | null,
  buyingSignals: string[],
  runPlaybookId: string | null,
  config: ResolvedLlmConfig,
): Promise<{ contacts: schema.CandidateContact[]; leads: schema.CandidateLead[] }> {
  const targetTitles = icpVersion?.targetTitles?.join(", ") || "VP of Sales, CTO, CEO, Head of Operations";
  const allContacts: schema.CandidateContact[] = [];
  const allLeads: schema.CandidateLead[] = [];
  const accountsToProcess = accounts.slice(0, 15);
  let successCount = 0;
  const lastError: string[] = [];

  for (const account of accountsToProcess) {
    const searchQuery = `${account.name} executives decision makers ${targetTitles}`;
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

    if (searchResults.length === 0) {
      console.warn(`[Agent] No search results for account "${account.name}" — skipping contact discovery to avoid hallucinations.`);
      successCount++;
      continue;
    }

    const searchContext = `\n\nWeb research:\n${searchResults.map(r => `- ${r.title}: ${r.snippet}`).join("\n")}`;

    const icpContext = buildIcpContextSection(icpProfile, icpVersion, false);
    const buyingSignalsContext = buyingSignals.length > 0
      ? `\nBuying signals to look for: ${buyingSignals.join("; ")}`
      : "";

    const systemPrompt = `You are a contact discovery specialist finding B2B decision-makers.
CRITICAL INSTRUCTION: Your entire response must be ONLY a valid JSON array. No preamble, no explanation, no markdown, no code fences. Start your response with [ and end with ].
CRITICAL INSTRUCTION: Only include contacts whose full names (first and last) appear explicitly in the web research results provided below. Do NOT invent, fabricate, or hallucinate any person's name, email, or LinkedIn URL. Do NOT use placeholder names like "First", "Last", "John Doe", "Jane Smith", "John Smith", or any other generic example name. If no named individuals can be confirmed from the search results, return an empty array [].`;

    const userPrompt = `Find key decision-maker contacts at ${account.name} (${account.industry || "technology"} company, ${account.companySize || "mid-size"}).
Target roles: ${targetTitles}
Company overview: ${account.companyOverview || account.description || "No description available"}
ICP fit rationale for this company: ${account.icpFitRationale || "Good fit"}${icpContext}${buyingSignalsContext}
${searchContext}

Return a JSON array containing only contacts whose real names appear in the web research above. Return an empty array [] if no named individuals can be confirmed. Each object must have this shape:
{
  "firstName": "<real first name from search results>",
  "lastName": "<real last name from search results>",
  "title": "<their actual job title>",
  "email": "<their email if found, otherwise omit>",
  "linkedinUrl": "<their LinkedIn URL if found, otherwise omit>",
  "roleFitRationale": "<2-3 sentences why this person is a good contact>",
  "outreachPriority": "high|medium|low"
}`;

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

      const STRUCTURAL_PLACEHOLDER_NAMES = new Set([
        "first", "firstname", "last", "lastname", "name", "fullname",
        "example", "test", "unknown", "n/a", "tbd",
      ]);

      const PLACEHOLDER_FULL_NAMES = new Set([
        "john doe", "jane doe", "john smith", "jane smith",
        "jim doe", "joe doe", "first last", "firstname lastname",
      ]);

      const contactSearchContextText = searchResults.map(r =>
        `${r.title} ${r.snippet}`
      ).join(" ").toLowerCase();

      for (const contactData of parsed.slice(0, 3)) {
        if (!contactData.firstName || !contactData.lastName) continue;

        const firstNameNorm = contactData.firstName.toLowerCase().trim();
        const lastNameNorm = contactData.lastName.toLowerCase().trim();
        const fullNameNorm = `${firstNameNorm} ${lastNameNorm}`;

        if (
          STRUCTURAL_PLACEHOLDER_NAMES.has(firstNameNorm) ||
          STRUCTURAL_PLACEHOLDER_NAMES.has(lastNameNorm) ||
          PLACEHOLDER_FULL_NAMES.has(fullNameNorm)
        ) {
          console.warn(`[Agent] Skipping placeholder contact: "${contactData.firstName} ${contactData.lastName}" for ${account.name}`);
          continue;
        }

        if (!contactSearchContextText.includes(fullNameNorm)) {
          console.warn(`[Agent] Skipping ungrounded contact — full name not found in search results: "${contactData.firstName} ${contactData.lastName}" for ${account.name}`);
          continue;
        }

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
            assignedPlaybookId: runPlaybookId || null,
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
  icpProfile: schema.IcpProfile | null,
  icpVersion: schema.IcpProfileVersion | null,
  marketInsights: string,
  keyTrends: string[],
  buyingSignals: string[],
  config: ResolvedLlmConfig,
): Promise<void> {
  const accountsToProcess = accounts.slice(0, 15);
  let successCount = 0;
  const lastError: string[] = [];

  const icpContext = buildIcpContextSection(icpProfile, icpVersion, true);
  const offersSection = formatOffersSection(offers);
  const trendsContext = keyTrends.length > 0
    ? `\nKey market trends: ${keyTrends.join("; ")}`
    : "";
  const signalsContext = buyingSignals.length > 0
    ? `\nBuying signals to leverage: ${buyingSignals.join("; ")}`
    : "";

  for (const account of accountsToProcess) {
    const systemPrompt = `You are a B2B sales strategist. Create targeted strategic approach documents for accounts.
CRITICAL INSTRUCTION: Your entire response must be ONLY a valid JSON object. No preamble, no explanation, no markdown, no code fences. Start your response with { and end with }.`;

    const userPrompt = `Create a strategic sales approach for ${account.name}:
- Industry: ${account.industry || "technology"}
- Company Size: ${account.companySize || "unknown"}
- Geography: ${account.geography || "unknown"}
- ICP Fit Rationale: ${account.icpFitRationale || "Good fit"}
- Company Overview: ${account.companyOverview || account.description || "Not available"}

Our Offerings:
${offersSection}

Market Intelligence:
- Market Insights: ${marketInsights}${trendsContext}${signalsContext}${icpContext}

Respond with JSON:
{
  "strategicApproach": "3-4 sentence detailed strategic approach specific to this company",
  "keyPainPoints": ["specific pain point this company likely has", "another specific pain point"],
  "differentiators": ["specific reason our solution stands out for this company vs alternatives"],
  "recommendedFirstMove": "specific, concrete first outreach action with a clear hook"
}`;

    const startTime = Date.now();
    let response = "";
    try {
      response = await callLlm(config, systemPrompt, userPrompt);
      const durationMs = Date.now() - startTime;
      await logAgentStep(runId, "strategy", `strategy_${account.id}`, userPrompt, response, config.model, config.provider, durationMs, true);

      const parsed = extractJsonFromText(response) as {
        strategicApproach?: string;
        keyPainPoints?: string[];
        differentiators?: string[];
        recommendedFirstMove?: string;
      } | null;

      if (parsed?.strategicApproach) {
        // Always persist the strategy-phase strategicApproach, overwriting the
        // company-discovery-generated placeholder so Communication Drafting gets
        // a richer, offer-aware strategic context.
        await db.update(schema.candidateAccounts)
          .set({ strategicApproach: parsed.strategicApproach, updatedAt: new Date() })
          .where(eq(schema.candidateAccounts.id, account.id));
      }

      // Store the complete strategy JSON in researchDocuments so communication
      // drafting can retrieve keyPainPoints and differentiators without a schema change.
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

interface PlaybookStepDraft {
  stepOrder: number;
  stepName: string;
  channel: string;
  dayOffset: number;
  activityType: string;
  subject?: string;
  draftMessage: string;
}

async function runCommunicationDraftingPhase(
  runId: string,
  leads: schema.CandidateLead[],
  offers: schema.Offer[],
  icpProfile: schema.IcpProfile | null,
  icpVersion: schema.IcpProfileVersion | null,
  marketInsights: string,
  keyTrends: string[],
  buyingSignals: string[],
  playbook: schema.TaskPlaybook | null,
  playbookSteps: schema.TaskPlaybookStep[],
  config: ResolvedLlmConfig,
): Promise<void> {
  const leadsToProcess = leads.slice(0, 30);
  let successCount = 0;
  const lastError: string[] = [];

  const offersSection = formatOffersSection(offers);
  const icpContext = buildIcpContextSection(icpProfile, icpVersion, false);
  const trendsContext = keyTrends.length > 0
    ? `\nKey market trends: ${keyTrends.join("; ")}`
    : "";
  const signalsContext = buyingSignals.length > 0
    ? `\nBuying signals: ${buyingSignals.join("; ")}`
    : "";

  // Cache strategy documents per account to avoid redundant DB lookups
  const strategyDocCache = new Map<string, { keyPainPoints: string[]; differentiators: string[]; recommendedFirstMove: string }>();

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

    // Fetch strategy phase outputs (keyPainPoints, differentiators, recommendedFirstMove)
    // stored in researchDocuments from the strategy phase.
    let strategyData = strategyDocCache.get(account.id);
    if (!strategyData && account.id) {
      try {
        const strategyDocs = await db.select().from(schema.researchDocuments)
          .where(and(
            eq(schema.researchDocuments.entityType, "candidate_account"),
            eq(schema.researchDocuments.entityId, account.id),
            eq(schema.researchDocuments.documentType, "strategic_approach"),
            eq(schema.researchDocuments.runId, runId),
          ))
          .orderBy(desc(schema.researchDocuments.createdAt))
          .limit(1);

        if (strategyDocs[0]) {
          const parsedStrategy = extractJsonFromText(strategyDocs[0].content) as {
            keyPainPoints?: string[];
            differentiators?: string[];
            recommendedFirstMove?: string;
          } | null;
          if (parsedStrategy) {
            strategyData = {
              keyPainPoints: parsedStrategy.keyPainPoints || [],
              differentiators: parsedStrategy.differentiators || [],
              recommendedFirstMove: parsedStrategy.recommendedFirstMove || "",
            };
            strategyDocCache.set(account.id, strategyData);
          }
        }
      } catch (e) {
        console.warn(`[Agent] Could not load strategy doc for account ${account.id}:`, e);
      }
    }

    const painPointsStr = strategyData?.keyPainPoints?.length
      ? `\n- Key Pain Points: ${strategyData.keyPainPoints.join("; ")}`
      : "";
    const differentiatorsStr = strategyData?.differentiators?.length
      ? `\n- Our Differentiators for this company: ${strategyData.differentiators.join("; ")}`
      : "";
    const firstMoveStr = strategyData?.recommendedFirstMove
      ? `\n- Recommended First Move: ${strategyData.recommendedFirstMove}`
      : "";

    const sharedContext = `Contact: ${contact.firstName} ${contact.lastName}, ${contact.title || "executive"} at ${account.name}
Company: ${account.name} (${account.industry || "technology"}, ${account.companySize || "mid-size"})
Strategic Context: ${account.strategicApproach || account.icpFitRationale || "Strong ICP fit"}${painPointsStr}${differentiatorsStr}${firstMoveStr}

Our Offerings:
${offersSection || "Not specified"}

Market Intelligence:
- ${marketInsights}${trendsContext}${signalsContext}${icpContext}`;

    const startTime = Date.now();
    let response = "";
    let lastPrompt = "";

    try {
      let communicationPlan: unknown;

      if (playbook && playbookSteps.length > 0) {
        // ── PLAYBOOK MODE: generate one draft per step ──────────────────────
        const stepsJson = playbookSteps.map(s => ({
          stepOrder: s.stepOrder,
          name: s.name,
          channel: s.channel,
          dayOffset: s.dayOffset,
          activityType: s.activityType,
          description: s.description || "",
        }));

        const systemPrompt = `You are a B2B sales communication specialist.
Generate one personalised outreach draft per playbook step, channel-appropriate for each step type.
CRITICAL INSTRUCTION: Your entire response must be ONLY a valid JSON array. No preamble, no explanation, no markdown, no code fences. Start your response with [ and end with ].`;

        const userPrompt = `Write one outreach draft for each step of the "${playbook.name}" playbook below.

${sharedContext}

Playbook steps (write one draft per step, in order):
${JSON.stringify(stepsJson, null, 2)}

Return a JSON array with one object per step:
[
  {
    "stepOrder": 1,
    "stepName": "<step name>",
    "channel": "<email|linkedin|call|task>",
    "dayOffset": 0,
    "activityType": "<email|call|task|meeting|note>",
    "subject": "<email subject — only for email channel steps; omit for other channels>",
    "draftMessage": "<full message body: email gets 2-3 paragraphs, LinkedIn gets a short connection note, call gets a talk-track outline>"
  }
]

Guidelines:
- Email: subject + 2-3 paragraph body referencing pain points and value propositions
- LinkedIn: concise connection message (≤300 chars) referencing shared context
- Call / phone: talk-track outline with opening hook, key questions, value statement, and next step ask
- Task / other: a clear action description`;

        lastPrompt = userPrompt;
        response = await callLlm(config, systemPrompt, userPrompt);
        const durationMs = Date.now() - startTime;
        await logAgentStep(runId, "communication_drafting", `draft_${lead.id}`, userPrompt, response, config.model, config.provider, durationMs, true);

        const parsedSteps = extractJsonFromText(response) as Array<{
          stepOrder?: number;
          stepName?: string;
          channel?: string;
          dayOffset?: number;
          activityType?: string;
          subject?: string;
          draftMessage?: string;
        }> | null;

        if (Array.isArray(parsedSteps) && parsedSteps.length > 0) {
          communicationPlan = parsedSteps
            .filter(s => s.draftMessage)
            .map(s => {
              const channel = (s.channel ?? "email").toLowerCase();
              const isEmail = channel === "email";
              return {
                stepOrder: s.stepOrder ?? 1,
                stepName: s.stepName ?? "",
                channel,
                dayOffset: s.dayOffset ?? 0,
                activityType: s.activityType ?? (isEmail ? "email" : "task"),
                // subject is only meaningful for email; strip it for other channel types
                subject: isEmail ? (s.subject || undefined) : undefined,
                draftMessage: s.draftMessage!,
              } as PlaybookStepDraft;
            });
        }
      } else {
        // ── LEGACY MODE: single communication plan (no playbook) ────────────
        const systemPrompt = `You are a B2B sales communication specialist. 
Draft personalized outreach messages tailored to specific contacts.
CRITICAL INSTRUCTION: Your entire response must be ONLY a valid JSON object. No preamble, no explanation, no markdown, no code fences. Start your response with { and end with }.`;

        const userPrompt = `Draft a personalized outreach communication plan for:
- ${sharedContext}

Respond with JSON:
{
  "channelRecommendation": "email|linkedin|call",
  "tone": "professional|consultative|direct|warm",
  "objectives": ["primary objective", "secondary objective"],
  "subjectLine": "Compelling, specific email subject line (not generic)",
  "draftedMessage": "Full personalized message (3-4 paragraphs) referencing specific pain points and value propositions",
  "followUpSequence": ["day 3: specific follow up action", "day 7: specific action"]
}`;

        lastPrompt = userPrompt;
        response = await callLlm(config, systemPrompt, userPrompt);
        const durationMs = Date.now() - startTime;
        await logAgentStep(runId, "communication_drafting", `draft_${lead.id}`, userPrompt, response, config.model, config.provider, durationMs, true);

        communicationPlan = extractJsonFromText(response);
      }

      if (communicationPlan) {
        await db.update(schema.candidateLeads)
          .set({ communicationPlan, updatedAt: new Date() })
          .where(eq(schema.candidateLeads.id, lead.id));

        const draftText = Array.isArray(communicationPlan)
          ? (communicationPlan as PlaybookStepDraft[]).map(s => `[Day ${s.dayOffset} — ${s.channel}]\n${s.draftMessage}`).join("\n\n---\n\n")
          : ((communicationPlan as Record<string, unknown>)?.draftedMessage as string | undefined) || response;

        await db.insert(schema.researchDocuments).values({
          entityType: "candidate_lead",
          entityId: lead.id,
          documentType: "communication_draft",
          title: `Communication Plan: ${contact.firstName} ${contact.lastName} @ ${account.name}`,
          content: draftText,
          sourceAgentPhase: "communication_drafting",
          runId,
        });
        successCount++;
      }
    } catch (err) {
      const durationMs = Date.now() - startTime;
      const errorMsg = err instanceof Error ? err.message : String(err);
      await logAgentStep(runId, "communication_drafting", `draft_${lead.id}`, lastPrompt || "", response, config.model, config.provider, durationMs, false, errorMsg);
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

  activeRunIds.add(runId);
  try {
    await _runPipelineInternal(runId, startFromPhase);
  } finally {
    activeRunIds.delete(runId);
  }
}

async function _runPipelineInternal(runId: string, startFromPhase?: string): Promise<void> {
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

  // Load the parent ICP profile for its description field
  let icpProfile: schema.IcpProfile | null = null;
  const icpProfileId = icpVersion?.icpProfileId || run.icpProfileId;
  if (icpProfileId) {
    const pRows = await db.select().from(schema.icpProfiles)
      .where(eq(schema.icpProfiles.id, icpProfileId)).limit(1);
    icpProfile = pRows[0] || null;
  }

  // Load playbook + steps if the run has a playbookId
  let runPlaybook: schema.TaskPlaybook | null = null;
  let runPlaybookSteps: schema.TaskPlaybookStep[] = [];
  if (run.playbookId) {
    const pbRows = await db.select().from(schema.taskPlaybooks)
      .where(eq(schema.taskPlaybooks.id, run.playbookId)).limit(1);
    runPlaybook = pbRows[0] || null;
    if (runPlaybook) {
      runPlaybookSteps = await db.select().from(schema.taskPlaybookSteps)
        .where(eq(schema.taskPlaybookSteps.playbookId, runPlaybook.id))
        .orderBy(schema.taskPlaybookSteps.stepOrder);
      console.log(`[Agent] Loaded playbook "${runPlaybook.name}" with ${runPlaybookSteps.length} steps for run ${runId}`);
    }
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
  let keyTrends: string[] = [];
  let buyingSignals: string[] = [];
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
    if (stoppedRunIds.has(runId)) {
      stoppedRunIds.delete(runId);
      console.log(`[Agent] Run ${runId} was stopped before phase ${phase}. Halting pipeline.`);
      await db.update(schema.leadGenerationRuns)
        .set({ status: "stopped", currentPhase: null, updatedAt: new Date() })
        .where(eq(schema.leadGenerationRuns.id, runId));
      return;
    }

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
        const result = await runMarketResearchPhase(runId, icpVersion, icpProfile, offers, runPlaybook, runPlaybookSteps, config);
        marketInsights = result.marketInsights;
        targetIndustries = result.targetIndustries.length > 0 ? result.targetIndustries : targetIndustries;
        keyTrends = result.keyTrends;
        buyingSignals = result.buyingSignals;
      } else if (phase === "company_discovery") {
        discoveredAccounts = await runCompanyDiscoveryPhase(
          runId, icpVersion, icpProfile, marketInsights, targetIndustries, targetCount, config, runPlaybook, runPlaybookSteps
        );
      } else if (phase === "contact_discovery") {
        if (discoveredAccounts.length === 0) {
          discoveredAccounts = await db.select().from(schema.candidateAccounts)
            .where(eq(schema.candidateAccounts.runId, runId));
        }
        const result = await runContactDiscoveryPhase(runId, discoveredAccounts, icpVersion, icpProfile, buyingSignals, run.playbookId || null, config);
        discoveredLeads = result.leads;
      } else if (phase === "strategy") {
        if (discoveredAccounts.length === 0) {
          discoveredAccounts = await db.select().from(schema.candidateAccounts)
            .where(eq(schema.candidateAccounts.runId, runId));
        }
        await runStrategyPhase(runId, discoveredAccounts, offers, icpProfile, icpVersion, marketInsights, keyTrends, buyingSignals, config);
      } else if (phase === "communication_drafting") {
        if (discoveredLeads.length === 0) {
          discoveredLeads = await db.select().from(schema.candidateLeads)
            .where(eq(schema.candidateLeads.runId, runId));
        }
        await runCommunicationDraftingPhase(runId, discoveredLeads, offers, icpProfile, icpVersion, marketInsights, keyTrends, buyingSignals, runPlaybook, runPlaybookSteps, config);
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

      // If a stop was requested while this phase was running, honor stop intent
      const wasStopped = stoppedRunIds.has(runId);
      if (wasStopped) {
        stoppedRunIds.delete(runId);
        await updateRunPhase(runId, null, phaseEntry);
        await db.update(schema.leadGenerationRuns)
          .set({ status: "stopped", currentPhase: null, updatedAt: new Date() })
          .where(eq(schema.leadGenerationRuns.id, runId));
        console.log(`[Agent] Run ${runId} phase ${phase} errored but stop was requested; marking as stopped.`);
      } else {
        // Transition run to explicit error state
        await updateRunPhase(runId, phase, phaseEntry, {
          errorPhase: phase,
          errorReason: errorMsg,
        });
        await db.update(schema.leadGenerationRuns)
          .set({ status: "error", updatedAt: new Date() })
          .where(eq(schema.leadGenerationRuns.id, runId));
      }
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
