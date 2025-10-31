// Health Trixss CRM - Analytics & Forecasting Service
// OKR-driven analytics focusing on outcomes and drivers, not activities

import { db } from "./db";
import * as schema from "@shared/schema";
import { eq, and, gte, lte, sql, desc, asc, isNull, isNotNull, or } from "drizzle-orm";

// Stage probability mapping (industry standard for healthcare/B2B)
const STAGE_PROBABILITIES: Record<string, number> = {
  prospecting: 0.10,
  qualification: 0.25,
  proposal: 0.60,
  negotiation: 0.80,
  closed_won: 1.00,
  closed_lost: 0.00,
};

// Time decay multipliers for older opportunities
const TIME_DECAY_FACTORS = [
  { maxDays: 30, multiplier: 1.00 },
  { maxDays: 60, multiplier: 0.80 },
  { maxDays: 90, multiplier: 0.50 },
  { maxDays: Infinity, multiplier: 0.25 },
];

interface DateRange {
  start: Date;
  end: Date;
}

// ========== HISTORICAL PERFORMANCE ==========

export async function getHistoricalMetrics(dateRange: DateRange) {
  const { start, end } = dateRange;

  // Get closed/won opportunities in date range
  const wonOpportunities = await db
    .select()
    .from(schema.opportunities)
    .where(
      and(
        eq(schema.opportunities.stage, "closed_won"),
        gte(schema.opportunities.updatedAt, start),
        lte(schema.opportunities.updatedAt, end)
      )
    );

  // Get closed/lost opportunities in date range
  const lostOpportunities = await db
    .select()
    .from(schema.opportunities)
    .where(
      and(
        eq(schema.opportunities.stage, "closed_lost"),
        gte(schema.opportunities.updatedAt, start),
        lte(schema.opportunities.updatedAt, end)
      )
    );

  const totalClosed = wonOpportunities.length + lostOpportunities.length;
  const wonCount = wonOpportunities.length;
  const winRate = totalClosed > 0 ? wonCount / totalClosed : 0;

  const totalRevenue = wonOpportunities.reduce(
    (sum, opp) => sum + parseFloat(opp.amount || "0"),
    0
  );

  const avgDealSize = wonCount > 0 ? totalRevenue / wonCount : 0;

  // Calculate average sales cycle (created to closed)
  const salesCycles = wonOpportunities.map((opp) => {
    const created = new Date(opp.createdAt);
    const closed = new Date(opp.updatedAt);
    return (closed.getTime() - created.getTime()) / (1000 * 60 * 60 * 24); // days
  });

  const avgSalesCycle =
    salesCycles.length > 0
      ? salesCycles.reduce((sum, days) => sum + days, 0) / salesCycles.length
      : 0;

  return {
    wonCount,
    lostCount: lostOpportunities.length,
    totalClosed,
    winRate,
    totalRevenue,
    avgDealSize,
    avgSalesCycle,
  };
}

// ========== STAGE CONVERSION RATES ==========

export async function getStageConversionRates(dateRange: DateRange) {
  // This is simplified - in production you'd track stage transitions via audit logs
  // For now, we'll calculate based on current state
  
  const allOpps = await db.select().from(schema.opportunities);

  const stageCount: Record<string, number> = {
    prospecting: 0,
    qualification: 0,
    proposal: 0,
    negotiation: 0,
    closed_won: 0,
    closed_lost: 0,
  };

  allOpps.forEach((opp) => {
    stageCount[opp.stage] = (stageCount[opp.stage] || 0) + 1;
  });

  // Calculate conversion rates (simplified funnel analysis)
  const total = allOpps.length;
  const conversions = {
    prospecting_to_qualification: total > 0 ? stageCount.qualification / total : 0,
    qualification_to_proposal: stageCount.qualification > 0 ? stageCount.proposal / stageCount.qualification : 0,
    proposal_to_negotiation: stageCount.proposal > 0 ? stageCount.negotiation / stageCount.proposal : 0,
    negotiation_to_won: stageCount.negotiation > 0 ? stageCount.closed_won / stageCount.negotiation : 0,
  };

  return {
    stageCount,
    conversions,
  };
}

// ========== PIPELINE VELOCITY ==========

export async function getPipelineVelocity(dateRange: DateRange) {
  const { start, end } = dateRange;
  const days = (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24);

  // Get opportunities that moved in this period
  const movedOpps = await db
    .select()
    .from(schema.opportunities)
    .where(
      and(
        gte(schema.opportunities.updatedAt, start),
        lte(schema.opportunities.updatedAt, end),
        or(
          eq(schema.opportunities.stage, "closed_won"),
          eq(schema.opportunities.stage, "closed_lost")
        )
      )
    );

  const totalValue = movedOpps.reduce(
    (sum, opp) => sum + parseFloat(opp.amount || "0"),
    0
  );

  const velocityPerDay = days > 0 ? totalValue / days : 0;

  return {
    totalValue,
    days,
    velocityPerDay,
    opportunitiesMoved: movedOpps.length,
  };
}

// ========== FORECASTING MODELS ==========

export async function calculateForecasts(targetDate?: Date) {
  const now = new Date();
  const target = targetDate || new Date(now.getFullYear(), now.getMonth() + 1, 0); // End of current month

  // Get all open opportunities
  const openOpps = await db
    .select()
    .from(schema.opportunities)
    .where(
      and(
        isNotNull(schema.opportunities.closeDate),
        lte(schema.opportunities.closeDate, target),
        or(
          eq(schema.opportunities.stage, "prospecting"),
          eq(schema.opportunities.stage, "qualification"),
          eq(schema.opportunities.stage, "proposal"),
          eq(schema.opportunities.stage, "negotiation")
        )
      )
    );

  // Model 1: Stage-Weighted Forecast
  let stageWeightedTotal = 0;
  let commitTotal = 0; // 80%+ probability
  let bestCaseTotal = 0; // All pipeline

  openOpps.forEach((opp) => {
    const amount = parseFloat(opp.amount || "0");
    const stageProbability = STAGE_PROBABILITIES[opp.stage] || 0;
    
    // Use custom probability if set, otherwise use stage default
    const probability = opp.probability !== null ? opp.probability / 100 : stageProbability;
    
    stageWeightedTotal += amount * probability;
    bestCaseTotal += amount;
    
    if (probability >= 0.8) {
      commitTotal += amount;
    }
  });

  // Model 2: Historical Win Rate Forecast
  const last90Days = new Date(now);
  last90Days.setDate(last90Days.getDate() - 90);
  
  const historicalMetrics = await getHistoricalMetrics({
    start: last90Days,
    end: now,
  });

  const totalPipelineValue = openOpps.reduce(
    (sum, opp) => sum + parseFloat(opp.amount || "0"),
    0
  );
  
  const historicalForecast = totalPipelineValue * historicalMetrics.winRate;

  // Model 3: Velocity-Based Forecast
  const velocityData = await getPipelineVelocity({
    start: last90Days,
    end: now,
  });
  
  const daysToTarget = (target.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
  const velocityForecast = velocityData.velocityPerDay * daysToTarget * historicalMetrics.winRate;

  // Model 4: Time-Decay Adjusted Forecast
  let timeDecayTotal = 0;
  
  openOpps.forEach((opp) => {
    const amount = parseFloat(opp.amount || "0");
    const stageProbability = STAGE_PROBABILITIES[opp.stage] || 0;
    const probability = opp.probability !== null ? opp.probability / 100 : stageProbability;
    
    // Calculate age
    const created = new Date(opp.createdAt);
    const ageInDays = (now.getTime() - created.getTime()) / (1000 * 60 * 60 * 24);
    
    // Find decay multiplier
    const decayFactor = TIME_DECAY_FACTORS.find(
      (factor) => ageInDays <= factor.maxDays
    )?.multiplier || 0.25;
    
    timeDecayTotal += amount * probability * decayFactor;
  });

  // Get closed revenue for current period
  const firstDayOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const closedThisMonth = await db
    .select()
    .from(schema.opportunities)
    .where(
      and(
        eq(schema.opportunities.stage, "closed_won"),
        gte(schema.opportunities.updatedAt, firstDayOfMonth),
        lte(schema.opportunities.updatedAt, now)
      )
    );

  const closedRevenue = closedThisMonth.reduce(
    (sum, opp) => sum + parseFloat(opp.amount || "0"),
    0
  );

  return {
    targetDate: target,
    closedRevenue,
    openPipeline: totalPipelineValue,
    opportunityCount: openOpps.length,
    forecasts: {
      conservative: historicalForecast,
      mostLikely: stageWeightedTotal,
      optimistic: commitTotal,
      bestCase: bestCaseTotal,
      velocityBased: velocityForecast,
      timeDecayAdjusted: timeDecayTotal,
    },
    historicalMetrics,
  };
}

// ========== DEAL PREDICTIONS ==========

export async function predictDealClosing(daysAhead: number = 30) {
  const now = new Date();
  const targetDate = new Date(now);
  targetDate.setDate(targetDate.getDate() + daysAhead);

  // Get opportunities closing in the next X days
  const upcomingOpps = await db
    .select({
      opportunity: schema.opportunities,
      account: schema.accounts,
      owner: {
        id: schema.users.id,
        name: schema.users.name,
        email: schema.users.email,
      },
    })
    .from(schema.opportunities)
    .leftJoin(schema.accounts, eq(schema.opportunities.accountId, schema.accounts.id))
    .leftJoin(schema.users, eq(schema.opportunities.ownerId, schema.users.id))
    .where(
      and(
        isNotNull(schema.opportunities.closeDate),
        gte(schema.opportunities.closeDate, now),
        lte(schema.opportunities.closeDate, targetDate),
        or(
          eq(schema.opportunities.stage, "proposal"),
          eq(schema.opportunities.stage, "negotiation")
        )
      )
    )
    .orderBy(asc(schema.opportunities.closeDate));

  // Calculate probability for each deal
  const predictions = upcomingOpps.map((item) => {
    const opp = item.opportunity;
    const stageProbability = STAGE_PROBABILITIES[opp.stage] || 0;
    const customProbability = opp.probability !== null ? opp.probability / 100 : null;
    
    const created = new Date(opp.createdAt);
    const ageInDays = (now.getTime() - created.getTime()) / (1000 * 60 * 60 * 24);
    
    const decayFactor = TIME_DECAY_FACTORS.find(
      (factor) => ageInDays <= factor.maxDays
    )?.multiplier || 0.25;
    
    const finalProbability = (customProbability || stageProbability) * decayFactor;

    const closeDate = opp.closeDate ? new Date(opp.closeDate) : null;
    const daysUntilClose = closeDate
      ? (closeDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
      : null;

    return {
      id: opp.id,
      name: opp.name,
      accountName: item.account?.name,
      amount: parseFloat(opp.amount || "0"),
      stage: opp.stage,
      closeDate: opp.closeDate,
      daysUntilClose: daysUntilClose ? Math.ceil(daysUntilClose) : null,
      probability: finalProbability,
      stageProbability,
      ageInDays: Math.floor(ageInDays),
      decayFactor,
      owner: item.owner,
    };
  });

  // Sort by probability descending
  predictions.sort((a, b) => b.probability - a.probability);

  const expectedRevenue = predictions.reduce(
    (sum, pred) => sum + pred.amount * pred.probability,
    0
  );

  const likelyClosers = predictions.filter((p) => p.probability >= 0.7);
  const atRisk = predictions.filter((p) => p.ageInDays > 45 && p.probability < 0.5);

  return {
    predictions,
    summary: {
      totalDeals: predictions.length,
      expectedRevenue,
      likelyClosers: likelyClosers.length,
      atRiskDeals: atRisk.length,
    },
    likelyClosers,
    atRisk,
  };
}

// ========== REP PERFORMANCE ==========

export async function getRepPerformance(dateRange: DateRange) {
  const { start, end } = dateRange;

  // Get all users with their opportunities
  const reps = await db
    .select({
      id: schema.users.id,
      name: schema.users.name,
      email: schema.users.email,
    })
    .from(schema.users);

  const performance = await Promise.all(
    reps.map(async (rep) => {
      // Get won opportunities for this rep
      const wonOpps = await db
        .select()
        .from(schema.opportunities)
        .where(
          and(
            eq(schema.opportunities.ownerId, rep.id),
            eq(schema.opportunities.stage, "closed_won"),
            gte(schema.opportunities.updatedAt, start),
            lte(schema.opportunities.updatedAt, end)
          )
        );

      // Get lost opportunities
      const lostOpps = await db
        .select()
        .from(schema.opportunities)
        .where(
          and(
            eq(schema.opportunities.ownerId, rep.id),
            eq(schema.opportunities.stage, "closed_lost"),
            gte(schema.opportunities.updatedAt, start),
            lte(schema.opportunities.updatedAt, end)
          )
        );

      // Get open pipeline
      const openOpps = await db
        .select()
        .from(schema.opportunities)
        .where(
          and(
            eq(schema.opportunities.ownerId, rep.id),
            or(
              eq(schema.opportunities.stage, "prospecting"),
              eq(schema.opportunities.stage, "qualification"),
              eq(schema.opportunities.stage, "proposal"),
              eq(schema.opportunities.stage, "negotiation")
            )
          )
        );

      const revenue = wonOpps.reduce(
        (sum, opp) => sum + parseFloat(opp.amount || "0"),
        0
      );

      const totalClosed = wonOpps.length + lostOpps.length;
      const winRate = totalClosed > 0 ? wonOpps.length / totalClosed : 0;

      const avgDealSize = wonOpps.length > 0 ? revenue / wonOpps.length : 0;

      const pipelineValue = openOpps.reduce(
        (sum, opp) => sum + parseFloat(opp.amount || "0"),
        0
      );

      return {
        rep,
        revenue,
        dealsWon: wonOpps.length,
        dealsLost: lostOpps.length,
        winRate,
        avgDealSize,
        pipelineValue,
        openDeals: openOpps.length,
      };
    })
  );

  // Sort by revenue descending
  performance.sort((a, b) => b.revenue - a.revenue);

  return performance;
}

// ========== PIPELINE HEALTH SCORE ==========

export async function calculatePipelineHealth() {
  const now = new Date();

  // Get all open opportunities
  const openOpps = await db
    .select()
    .from(schema.opportunities)
    .where(
      or(
        eq(schema.opportunities.stage, "prospecting"),
        eq(schema.opportunities.stage, "qualification"),
        eq(schema.opportunities.stage, "proposal"),
        eq(schema.opportunities.stage, "negotiation")
      )
    );

  if (openOpps.length === 0) {
    return {
      score: 0,
      components: {
        pipelineCoverage: 0,
        stageDistribution: 0,
        velocity: 0,
        freshness: 0,
      },
      stalledDeals: [],
      recommendations: ["Build pipeline - no active opportunities"],
    };
  }

  // Component 1: Pipeline Coverage (assume $100K monthly target for now)
  const MONTHLY_TARGET = 100000;
  const totalPipelineValue = openOpps.reduce(
    (sum, opp) => sum + parseFloat(opp.amount || "0"),
    0
  );
  const coverage = totalPipelineValue / MONTHLY_TARGET;
  const coverageScore = Math.min(coverage / 3, 1) * 100; // 3x coverage = 100%

  // Component 2: Stage Distribution Balance
  const stageCount: Record<string, number> = {};
  openOpps.forEach((opp) => {
    stageCount[opp.stage] = (stageCount[opp.stage] || 0) + 1;
  });
  
  // Ideal distribution: 40% early, 30% mid, 30% late
  const earlyStage = (stageCount.prospecting || 0) + (stageCount.qualification || 0);
  const midStage = stageCount.proposal || 0;
  const lateStage = stageCount.negotiation || 0;
  const total = openOpps.length;
  
  const earlyPct = earlyStage / total;
  const midPct = midStage / total;
  const latePct = lateStage / total;
  
  // Score based on deviation from ideal
  const distributionDeviation = 
    Math.abs(earlyPct - 0.4) + 
    Math.abs(midPct - 0.3) + 
    Math.abs(latePct - 0.3);
  const distributionScore = Math.max(0, (1 - distributionDeviation) * 100);

  // Component 3: Velocity Score (deals moving)
  const last30Days = new Date(now);
  last30Days.setDate(last30Days.getDate() - 30);
  
  const recentlyUpdated = openOpps.filter(
    (opp) => new Date(opp.updatedAt) >= last30Days
  );
  const velocityScore = (recentlyUpdated.length / openOpps.length) * 100;

  // Component 4: Freshness Score (age of opportunities)
  const ages = openOpps.map((opp) => {
    const created = new Date(opp.createdAt);
    return (now.getTime() - created.getTime()) / (1000 * 60 * 60 * 24);
  });
  const avgAge = ages.reduce((sum, age) => sum + age, 0) / ages.length;
  const freshnessScore = Math.max(0, Math.min(100, (1 - avgAge / 90) * 100));

  // Calculate stalled deals (no update in 30 days)
  const stalledDeals = openOpps.filter((opp) => {
    const updated = new Date(opp.updatedAt);
    const daysSinceUpdate = (now.getTime() - updated.getTime()) / (1000 * 60 * 60 * 24);
    return daysSinceUpdate > 30;
  });

  // Overall health score (weighted average)
  const overallScore =
    coverageScore * 0.3 +
    distributionScore * 0.3 +
    velocityScore * 0.2 +
    freshnessScore * 0.2;

  // Recommendations
  const recommendations: string[] = [];
  if (coverageScore < 50) recommendations.push("Increase pipeline - low coverage");
  if (distributionScore < 50) recommendations.push("Rebalance stage distribution");
  if (velocityScore < 50) recommendations.push("Accelerate deal movement");
  if (freshnessScore < 50) recommendations.push("Refresh old opportunities");
  if (stalledDeals.length > 0) recommendations.push(`Follow up on ${stalledDeals.length} stalled deals`);

  return {
    score: Math.round(overallScore),
    components: {
      pipelineCoverage: Math.round(coverageScore),
      stageDistribution: Math.round(distributionScore),
      velocity: Math.round(velocityScore),
      freshness: Math.round(freshnessScore),
    },
    stalledDeals: stalledDeals.slice(0, 10), // Top 10 stalled deals
    recommendations,
    metrics: {
      totalPipelineValue,
      coverage,
      avgAge: Math.round(avgAge),
      stalledCount: stalledDeals.length,
    },
  };
}
