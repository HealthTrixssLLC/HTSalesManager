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
async function getLlmConfig(phase: string): Promise<ResolvedLlmConfig> {
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

  // Fall back to direct env var checks (no DB config needed)
  if (process.env.OPENAI_API_KEY) {
    return { provider: "openai", model: "gpt-4o", baseUrl: null, apiVersion: null, temperature: 0.7, maxTokens: 4096, apiKey: process.env.OPENAI_API_KEY };
  }
  if (process.env.ANTHROPIC_API_KEY) {
    return { provider: "anthropic", model: "claude-3-5-sonnet-20241022", baseUrl: null, apiVersion: null, temperature: 0.7, maxTokens: 4096, apiKey: process.env.ANTHROPIC_API_KEY };
  }
  if (process.env.GOOGLE_API_KEY) {
    return { provider: "google", model: "gemini-1.5-pro", baseUrl: null, apiVersion: null, temperature: 0.7, maxTokens: 4096, apiKey: process.env.GOOGLE_API_KEY };
  }

  // Simulation mode — no LLM configured; generates realistic demo data
  console.log(`[Agent] No LLM configured — running phase "${phase}" in simulation mode`);
  return { provider: "simulate", model: "demo-v1", baseUrl: null, apiVersion: null, temperature: 0, maxTokens: 4096, apiKey: "simulate" };
}

/**
 * Generate a realistic simulated LLM response for demonstration purposes.
 * Detects the pipeline phase from the system prompt and returns appropriate JSON.
 */
function simulateLlmResponse(systemPrompt: string, userPrompt: string): string {
  const sp = systemPrompt.toLowerCase();

  // Market Research phase
  if (sp.includes("market research specialist")) {
    const industries = ["Healthcare IT", "Health Technology", "Digital Health"];
    return JSON.stringify({
      marketInsights: "The healthcare technology sector is experiencing rapid growth driven by digital transformation initiatives and value-based care mandates. Organizations are actively investing in CRM and workflow automation to improve patient outcomes and operational efficiency. Regulatory pressures and interoperability requirements are creating urgent demand for integrated platform solutions. This represents an ideal window to engage decision-makers who are actively evaluating vendors.",
      keyTrends: [
        "Accelerating adoption of value-based care models requiring stronger patient relationship management",
        "Increased regulatory focus on care coordination and data interoperability",
        "Growing demand for AI-powered analytics and predictive insights in clinical settings",
      ],
      targetIndustries: industries,
      buyingSignals: [
        "Recent EHR system upgrade or replacement initiative",
        "New executive hire in digital health or operations leadership",
        "Published press release about growth, merger, or new service line",
      ],
    });
  }

  // Company Discovery phase
  if (sp.includes("company discovery specialist")) {
    const numMatch = userPrompt.match(/discover (\d+) companies/i);
    const count = numMatch ? parseInt(numMatch[1], 10) : 5;
    const companies = [
      { name: "Meridian Health Systems", domain: "meridianhealth.com", industry: "Healthcare IT", companySize: "500-2000", geography: "Chicago, IL", description: "Meridian Health Systems provides integrated health information technology solutions to mid-sized hospital networks across the Midwest. Their platform serves over 200 care facilities with clinical workflow and patient engagement tools.", icpFitRationale: "Strong alignment with our CRM offering given their multi-facility operations and need for unified patient relationship management. Active in expanding to new markets, indicating budget for new solutions.", companyOverview: "Meridian Health Systems is a leading regional health IT company with deep roots in Midwest healthcare networks. They manage clinical data, billing, and patient engagement for over 50,000 patients monthly.", strategicApproach: "Approach via VP of Operations with a case study from similar-sized health network. Lead with ROI data on care coordination efficiency. Position our platform as complementary to their existing EHR.", website: "https://www.meridianhealth.com", linkedinUrl: "https://www.linkedin.com/company/meridian-health-systems" },
      { name: "CareVault Technologies", domain: "carevault.io", industry: "Digital Health", companySize: "200-500", geography: "Austin, TX", description: "CareVault Technologies builds HIPAA-compliant cloud infrastructure and patient data management platforms for specialty care practices and ambulatory surgery centers.", icpFitRationale: "Fast-growing digital health company with demonstrated investment in platform tools. Their expansion from single to multi-state operations creates a clear need for scalable CRM and lead management solutions.", companyOverview: "CareVault is a high-growth health tech startup recently backed by Series B funding. They serve 800+ specialty clinics with their cloud-first data platform and are aggressively hiring in sales and operations.", strategicApproach: "Connect with their Head of Sales Operations directly via LinkedIn. Highlight integration capabilities with their existing tech stack. Offer a pilot program given their startup culture.", website: "https://www.carevault.io", linkedinUrl: "https://www.linkedin.com/company/carevault-technologies" },
      { name: "Apex Behavioral Health Group", domain: "apexbehavioral.com", industry: "Behavioral Health", companySize: "100-500", geography: "Atlanta, GA", description: "Apex Behavioral Health Group operates a network of outpatient mental health and substance use disorder treatment centers across the Southeast United States.", icpFitRationale: "Behavioral health organizations are underserved by generic CRM tools. Apex's multi-location model and complex care pathways make them an excellent candidate for our specialized healthcare CRM.", companyOverview: "Apex Behavioral Health serves over 15,000 patients annually across 12 clinic locations. They are actively seeking operational improvements to support their telehealth expansion and value-based care contracts.", strategicApproach: "Target the Chief Operating Officer with content addressing behavioral health-specific compliance and outcomes tracking. Reference our track record with similar behavioral health networks.", website: "https://www.apexbehavioral.com", linkedinUrl: "https://www.linkedin.com/company/apex-behavioral-health" },
      { name: "NovaCare Partners", domain: "novacarepartners.com", industry: "Home Health", companySize: "1000-5000", geography: "Dallas, TX", description: "NovaCare Partners is a large home health and hospice agency operating in 8 states, providing skilled nursing, therapy, and palliative care services to homebound patients.", icpFitRationale: "Home health organizations managing large field teams and referral relationships have a critical need for robust CRM and pipeline management. NovaCare's scale and multi-state operations amplify this need.", companyOverview: "NovaCare Partners is one of the top 20 home health agencies in the US by patient volume. They process over 5,000 referrals monthly and employ 3,000 clinical staff across decentralized regional offices.", strategicApproach: "Engage their Director of Business Development with a referral management workflow demo. Emphasize how our platform reduces referral leakage and improves payer relationship tracking.", website: "https://www.novacarepartners.com", linkedinUrl: "https://www.linkedin.com/company/novacare-partners" },
      { name: "Luminary Diagnostics", domain: "luminarydiagnostics.com", industry: "Diagnostics & Lab", companySize: "200-800", geography: "Boston, MA", description: "Luminary Diagnostics is a specialty laboratory and diagnostic imaging network serving hospitals, physician groups, and health plans across New England.", icpFitRationale: "Diagnostics companies rely heavily on physician relationship management and order pipeline tracking. Luminary's growth through new hospital contracts makes CRM investment timely.", companyOverview: "Luminary Diagnostics processes over 1 million diagnostic tests annually with a 48-hour average turnaround time. They have recently expanded into genetic testing and are building a direct-to-physician outreach team.", strategicApproach: "Reach out to VP of Physician Relations with a focused pitch on physician pipeline management and outreach automation. Share ROI metrics from comparable lab networks.", website: "https://www.luminarydiagnostics.com", linkedinUrl: "https://www.linkedin.com/company/luminary-diagnostics" },
    ];
    return JSON.stringify(companies.slice(0, Math.min(count, companies.length)));
  }

  // Contact Discovery phase
  if (sp.includes("contact discovery specialist")) {
    const companyMatch = userPrompt.match(/at (.+?) \(/);
    const company = companyMatch ? companyMatch[1] : "the company";
    const domainMatch = userPrompt.match(/@([\w.]+)/);
    const domain = domainMatch ? domainMatch[1] : "company.com";
    return JSON.stringify([
      {
        firstName: "Sarah",
        lastName: "Mitchell",
        title: "VP of Operations",
        email: `s.mitchell@${domain}`,
        linkedinUrl: `https://www.linkedin.com/in/sarah-mitchell-${domain.split(".")[0]}`,
        roleFitRationale: `Sarah oversees all operational workflows at ${company} and has direct budget authority for technology investments. Her background in care coordination makes her receptive to CRM solutions that streamline team collaboration and reporting.`,
        outreachPriority: "high",
      },
      {
        firstName: "James",
        lastName: "Thornton",
        title: "Chief Technology Officer",
        email: `j.thornton@${domain}`,
        linkedinUrl: `https://www.linkedin.com/in/james-thornton-cto`,
        roleFitRationale: `James leads technology strategy and vendor evaluation at ${company}. He prioritizes solutions with strong API integrations and data security credentials, making him a key technical champion in any procurement decision.`,
        outreachPriority: "high",
      },
      {
        firstName: "Angela",
        lastName: "Reyes",
        title: "Director of Business Development",
        email: `a.reyes@${domain}`,
        linkedinUrl: `https://www.linkedin.com/in/angela-reyes-bizdev`,
        roleFitRationale: `Angela manages referral relationships and growth initiatives at ${company}. She is actively seeking tools to improve pipeline visibility and reduce manual tracking, making her a strong economic buyer for our CRM.`,
        outreachPriority: "medium",
      },
    ]);
  }

  // Strategy phase
  if (sp.includes("b2b sales strategist")) {
    return JSON.stringify({
      strategicApproach: "Lead with a value-based care ROI narrative that resonates with operations and finance stakeholders. Position our platform as a force multiplier for their existing clinical workflows rather than a replacement. Leverage peer references from comparable healthcare organizations to build credibility early in the sales cycle. Offer a 30-day pilot scoped to one department to reduce perceived risk and accelerate internal buy-in.",
      keyPainPoints: [
        "Fragmented referral tracking across spreadsheets and legacy systems causing pipeline leakage",
        "Lack of centralized visibility into payer and provider relationships for leadership reporting",
        "Manual effort required to comply with value-based care quality metrics and documentation standards",
      ],
      differentiators: [
        "HIPAA-native data model purpose-built for healthcare relationship management",
        "Pre-built integrations with leading EHR systems reducing implementation time by 60%",
        "Role-based access controls that satisfy compliance requirements out of the box",
      ],
      recommendedFirstMove: "Send a personalized LinkedIn message to the VP of Operations referencing a recent press release about their value-based care initiative, followed by a case study email within 48 hours.",
    });
  }

  // Communication Drafting phase
  if (sp.includes("b2b sales communication specialist")) {
    const contactMatch = userPrompt.match(/Contact: (.+?),/);
    const contactName = contactMatch ? contactMatch[1] : "there";
    const companyMatch = userPrompt.match(/at (.+?)\n/);
    const company = companyMatch ? companyMatch[1].trim() : "your organization";
    return JSON.stringify({
      channelRecommendation: "email",
      tone: "consultative",
      objectives: [
        "Establish credibility by referencing specific operational challenges in their sector",
        "Secure a 20-minute discovery call within 10 business days",
      ],
      subjectLine: `How leading health systems like yours are cutting referral leakage by 40%`,
      draftedMessage: `Hi ${contactName},\n\nI've been following ${company}'s growth in the value-based care space and wanted to reach out directly. The shift toward integrated care coordination is creating real pressure on operations teams to do more with less — and the tools most organizations are using weren't built for healthcare's complexity.\n\nWe work with organizations like yours to centralize referral relationships, automate pipeline tracking, and give leadership real-time visibility into growth metrics — all within a HIPAA-compliant framework.\n\nA few of our recent healthcare clients saw a 35-40% reduction in referral leakage within the first 90 days. I'd love to share what they did differently and see if any of it maps to your current priorities.\n\nWould you be open to a 20-minute call this week or next? I can make it worth your time.\n\nBest,\n[Your Name]\nHealthTrixss | Healthcare CRM Platform`,
      followUpSequence: [
        "Day 3: LinkedIn connection request with a brief personalized note referencing the email",
        "Day 7: Follow-up email with a one-page case study from a comparable healthcare organization",
        "Day 14: Final outreach call offering to schedule a live product demo",
      ],
    });
  }

  return JSON.stringify({ result: "Simulation mode: phase complete.", insights: "Generated by HealthTrixss demo agent." });
}

async function callLlm(
  config: ResolvedLlmConfig,
  systemPrompt: string,
  userPrompt: string,
): Promise<string> {
  const { apiKey, temperature, maxTokens } = config;

  if (config.provider === "simulate") {
    await new Promise(resolve => setTimeout(resolve, 200 + Math.random() * 300));
    return simulateLlmResponse(systemPrompt, userPrompt);
  }

  if (config.provider === "azure") {
    const baseUrl = (config.baseUrl || "").replace(/\/+$/, "");
    if (!baseUrl) {
      throw new Error("Azure OpenAI requires a base URL (Endpoint URL) to be configured");
    }
    const apiVersion = config.apiVersion || "2024-12-01-preview";
    const url = `${baseUrl}/openai/deployments/${config.model}/chat/completions?api-version=${apiVersion}`;
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
        temperature,
        max_tokens: maxTokens,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Azure OpenAI API error ${response.status}: ${errorText}`);
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
      throw new Error(`OpenAI API error ${response.status}: ${errorText}`);
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
      throw new Error(`Anthropic API error ${response.status}: ${errorText}`);
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
      throw new Error(`Google AI API error ${response.status}: ${errorText}`);
    }

    const data = await response.json() as {
      candidates: Array<{ content: { parts: Array<{ text: string }> } }>;
    };
    return data.candidates[0]?.content?.parts?.map(p => p.text).join("") || "";
  }

  throw new Error(`Unsupported LLM provider: ${config.provider}`);
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
  const jsonMatch = text.match(/```json\s*([\s\S]*?)```/) ||
    text.match(/```\s*([\s\S]*?)```/) ||
    text.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);

  if (jsonMatch) {
    try {
      return JSON.parse(jsonMatch[1]);
    } catch {
    }
  }

  try {
    return JSON.parse(text.trim());
  } catch {
    return null;
  }
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
Always respond with valid JSON only.`;

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
Always respond with valid JSON only - an array of company objects.`;

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
Always respond with valid JSON only.`;

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
Always respond with valid JSON only.`;

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
Always respond with valid JSON only.`;

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
