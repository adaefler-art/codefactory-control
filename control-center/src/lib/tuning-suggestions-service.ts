/**
 * Tuning Suggestions Generator Service (E78.3 / I783)
 * 
 * Deterministic rule-based generator for tuning suggestions:
 * - Analyzes outcomes, KPIs, and incident patterns
 * - Generates evidence-backed suggestions
 * - Conservative approach: prefer collecting evidence over risky actions
 * - No automatic application (suggestions only)
 */

import { Pool } from 'pg';
import {
  TuningSuggestionV0_7_0,
  TuningSuggestionRecord,
  SuggestionType,
  SuggestionConfidence,
  computeSuggestionHash,
  computeSuggestionId,
  TUNING_SUGGESTION_VERSION,
  SuggestionReferences,
} from './contracts/tuning-suggestions';
import { createHash } from 'crypto';

// ========================================
// Types
// ========================================

export interface GenerateSuggestionsOptions {
  window: 'daily' | 'weekly' | 'release' | 'custom';
  windowStart: Date;
  windowEnd: Date;
}

export interface SuggestionGenerationResult {
  suggestions: TuningSuggestionRecord[];
  isNew: boolean; // Whether new suggestions were generated vs retrieved existing
  metadata: {
    window: string;
    windowStart: string;
    windowEnd: string;
    rulesApplied: string[];
    dataPoints: {
      outcomeCount: number;
      incidentCount: number;
      kpiAggregateCount: number;
    };
  };
}

interface DataInputs {
  outcomes: Array<{
    id: string;
    entity_type: string;
    metrics_json: any;
    postmortem_json: any;
  }>;
  incidents: Array<{
    id: string;
    severity: string;
    status: string;
    classification: any;
  }>;
  kpiAggregates: Array<{
    window: string;
    window_start: string;
    window_end: string;
    kpi_name: string;
    value_num: number | null;
    metadata: any;
  }>;
}

// ========================================
// Rule Engine
// ========================================

/**
 * Rule 1: High UNKNOWN classification rate
 * If category UNKNOWN > 20% over window → suggest add classifier rule + evidence fields
 */
function ruleHighUnknownRate(data: DataInputs): TuningSuggestionV0_7_0 | null {
  const { incidents } = data;
  
  if (incidents.length === 0) return null;
  
  const unknownCount = incidents.filter(i => 
    !i.classification || 
    i.classification.category === 'UNKNOWN' || 
    i.classification.category === null
  ).length;
  
  const unknownRate = unknownCount / incidents.length;
  
  if (unknownRate > 0.2) {
    const incidentIds = incidents
      .filter(i => !i.classification || i.classification.category === 'UNKNOWN')
      .map(i => i.id);
    
    const suggestion: TuningSuggestionV0_7_0 = {
      version: TUNING_SUGGESTION_VERSION,
      generatedAt: new Date().toISOString(),
      suggestionId: '', // Will be computed
      type: 'CLASSIFIER_RULE',
      title: 'Add classifier rules for UNKNOWN incidents',
      rationale: `${(unknownRate * 100).toFixed(1)}% of incidents (${unknownCount}/${incidents.length}) have UNKNOWN or missing classification. This indicates missing classifier rules or insufficient evidence fields.`,
      proposedChange: {
        action: 'ADD_CLASSIFIER_RULES',
        targetCategory: 'UNKNOWN',
        suggestedFields: [
          'source_primary.kind',
          'source_primary.ref.deployId',
          'evidence.kind',
          'tags',
        ],
      },
      expectedImpact: `Reduce UNKNOWN classifications by ${Math.min(unknownRate * 100, 30).toFixed(0)}%, improving incident routing and response accuracy`,
      confidence: unknownRate > 0.4 ? 'high' : unknownRate > 0.3 ? 'medium' : 'low',
      references: {
        incidentIds,
        outcomeIds: [],
        kpiWindowRefs: [],
        evidenceHashes: [],
      },
      status: 'PROPOSED',
    };
    
    suggestion.suggestionId = computeSuggestionId(suggestion);
    return suggestion;
  }
  
  return null;
}

/**
 * Rule 2: Verification reruns frequently resolve incidents
 * If verification rerun success rate > 60% → suggest promote playbook I772 as first responder
 */
function ruleVerificationRerunSuccess(data: DataInputs): TuningSuggestionV0_7_0 | null {
  const { outcomes } = data;
  
  const verificationOutcomes = outcomes.filter(o => 
    o.postmortem_json?.remediation?.attemptedPlaybooks?.some(
      (p: any) => p.playbookId === 'I772' || p.playbookId?.includes('verification')
    )
  );
  
  if (verificationOutcomes.length < 3) return null; // Need at least 3 data points
  
  const successCount = verificationOutcomes.filter(o => 
    o.postmortem_json?.outcome?.resolved === true &&
    o.postmortem_json?.remediation?.attemptedPlaybooks?.some(
      (p: any) => (p.playbookId === 'I772' || p.playbookId?.includes('verification')) && 
                  p.status === 'SUCCEEDED'
    )
  ).length;
  
  const successRate = successCount / verificationOutcomes.length;
  
  if (successRate > 0.6) {
    const outcomeIds = verificationOutcomes.map(o => o.id);
    
    const suggestion: TuningSuggestionV0_7_0 = {
      version: TUNING_SUGGESTION_VERSION,
      generatedAt: new Date().toISOString(),
      suggestionId: '',
      type: 'PLAYBOOK_TUNING',
      title: 'Promote verification rerun playbook as first responder',
      rationale: `Verification rerun playbook (I772) has ${(successRate * 100).toFixed(1)}% success rate (${successCount}/${verificationOutcomes.length} incidents). This high success rate suggests it should be prioritized in the remediation sequence.`,
      proposedChange: {
        action: 'ADJUST_PLAYBOOK_PRIORITY',
        playbookId: 'I772',
        currentPriority: 'medium',
        suggestedPriority: 'high',
        gatingAdjustment: 'relax_evidence_requirements',
      },
      expectedImpact: `Reduce MTTR by 10-15% by prioritizing high-success playbook, potentially auto-resolving ${(successRate * 100).toFixed(0)}% of verification failures`,
      confidence: successRate > 0.75 ? 'high' : 'medium',
      references: {
        outcomeIds,
        incidentIds: [],
        kpiWindowRefs: [],
        evidenceHashes: [],
      },
      status: 'PROPOSED',
    };
    
    suggestion.suggestionId = computeSuggestionId(suggestion);
    return suggestion;
  }
  
  return null;
}

/**
 * Rule 3: LKG (Last Known Good) redeploy failures
 * If LKG redeploy fails frequently → suggest tighten LKG selection criteria
 */
function ruleLkgRedeployFailures(data: DataInputs): TuningSuggestionV0_7_0 | null {
  const { outcomes } = data;
  
  const lkgOutcomes = outcomes.filter(o => 
    o.postmortem_json?.remediation?.attemptedPlaybooks?.some(
      (p: any) => p.playbookId?.toLowerCase().includes('lkg') || 
                  p.playbookId?.toLowerCase().includes('redeploy')
    )
  );
  
  if (lkgOutcomes.length < 3) return null;
  
  const failureCount = lkgOutcomes.filter(o => 
    o.postmortem_json?.remediation?.attemptedPlaybooks?.some(
      (p: any) => (p.playbookId?.toLowerCase().includes('lkg') || 
                   p.playbookId?.toLowerCase().includes('redeploy')) && 
                  p.status === 'FAILED'
    )
  ).length;
  
  const failureRate = failureCount / lkgOutcomes.length;
  
  if (failureRate > 0.3) {
    const outcomeIds = lkgOutcomes.map(o => o.id);
    
    const suggestion: TuningSuggestionV0_7_0 = {
      version: TUNING_SUGGESTION_VERSION,
      generatedAt: new Date().toISOString(),
      suggestionId: '',
      type: 'GUARDRAIL',
      title: 'Tighten LKG selection criteria to reduce redeploy failures',
      rationale: `LKG redeploy playbook has ${(failureRate * 100).toFixed(1)}% failure rate (${failureCount}/${lkgOutcomes.length} attempts). This suggests LKG selection criteria may not be strict enough.`,
      proposedChange: {
        action: 'TIGHTEN_LKG_CRITERIA',
        currentCriteria: 'last_successful_deploy',
        suggestedCriteria: [
          'last_successful_deploy_with_verification_pass',
          'minimum_runtime_stability_hours: 4',
          'require_rollback_test_evidence',
        ],
      },
      expectedImpact: `Reduce LKG redeploy failures by ${Math.min(failureRate * 50, 25).toFixed(0)}%, improving incident recovery reliability`,
      confidence: failureRate > 0.5 ? 'high' : 'medium',
      references: {
        outcomeIds,
        incidentIds: [],
        kpiWindowRefs: [],
        evidenceHashes: [],
      },
      status: 'PROPOSED',
    };
    
    suggestion.suggestionId = computeSuggestionId(suggestion);
    return suggestion;
  }
  
  return null;
}

/**
 * Rule 4: High MTTR for specific incident category
 * If MTTR > 2 hours for ALB_TARGET_UNHEALTHY → suggest add pre-check evidence
 */
function ruleHighMttrCategory(data: DataInputs): TuningSuggestionV0_7_0 | null {
  const { outcomes, kpiAggregates } = data;
  
  // Find MTTR aggregate
  const mttrAggregate = kpiAggregates.find(k => k.kpi_name === 'mttr');
  
  if (!mttrAggregate || mttrAggregate.value_num === null) return null;
  
  const mttrHours = mttrAggregate.value_num;
  
  // Check for ALB-related incidents with high MTTR
  const albIncidents = outcomes.filter(o => 
    o.postmortem_json?.incident?.category?.includes('ALB') ||
    o.postmortem_json?.incident?.category?.includes('TARGET_UNHEALTHY') ||
    o.postmortem_json?.detection?.signalKinds?.includes('alb')
  );
  
  if (albIncidents.length < 2) return null;
  
  const avgMttr = albIncidents.reduce((sum, o) => 
    sum + (o.postmortem_json?.outcome?.mttrMinutes || 0), 0
  ) / albIncidents.length / 60; // Convert to hours
  
  if (avgMttr > 2) {
    const outcomeIds = albIncidents.map(o => o.id);
    
    const suggestion: TuningSuggestionV0_7_0 = {
      version: TUNING_SUGGESTION_VERSION,
      generatedAt: new Date().toISOString(),
      suggestionId: '',
      type: 'EVIDENCE_GAP',
      title: 'Add ALB target group pre-check evidence for faster resolution',
      rationale: `ALB-related incidents have average MTTR of ${avgMttr.toFixed(1)} hours (${albIncidents.length} incidents). Pre-check evidence for ALB target groups could enable faster, safer remediation.`,
      proposedChange: {
        action: 'ADD_EVIDENCE_INGESTION',
        targetKind: 'alb_target_groups',
        suggestedFields: [
          'healthy_target_count',
          'unhealthy_target_count',
          'draining_target_count',
          'target_health_check_config',
        ],
        suggestedPlaybook: 'safe_alb_health_reset',
      },
      expectedImpact: `Reduce ALB incident MTTR by 30-40% by enabling automated health checks and safe reset procedures`,
      confidence: avgMttr > 3 ? 'high' : 'medium',
      references: {
        outcomeIds,
        incidentIds: [],
        kpiWindowRefs: mttrAggregate ? [{
          window: mttrAggregate.window,
          windowStart: mttrAggregate.window_start,
          windowEnd: mttrAggregate.window_end,
          kpiName: mttrAggregate.kpi_name,
        }] : [],
        evidenceHashes: [],
      },
      status: 'PROPOSED',
    };
    
    suggestion.suggestionId = computeSuggestionId(suggestion);
    return suggestion;
  }
  
  return null;
}

/**
 * Rule 5: Incidents lack log pointers
 * If > 40% of incidents have no log_pointer evidence → suggest evidence ingestion improvements
 */
function ruleMissingLogPointers(data: DataInputs): TuningSuggestionV0_7_0 | null {
  const { outcomes } = data;
  
  if (outcomes.length === 0) return null;
  
  const missingLogPointers = outcomes.filter(o => {
    const pointers = o.postmortem_json?.references?.pointers || [];
    return !pointers.some((p: any) => p.kind === 'log_pointer');
  });
  
  const missingRate = missingLogPointers.length / outcomes.length;
  
  if (missingRate > 0.4) {
    const outcomeIds = missingLogPointers.map(o => o.id);
    
    const suggestion: TuningSuggestionV0_7_0 = {
      version: TUNING_SUGGESTION_VERSION,
      generatedAt: new Date().toISOString(),
      suggestionId: '',
      type: 'EVIDENCE_GAP',
      title: 'Improve log pointer evidence ingestion',
      rationale: `${(missingRate * 100).toFixed(1)}% of incidents (${missingLogPointers.length}/${outcomes.length}) lack log pointer evidence. This limits debugging capability and postmortem quality.`,
      proposedChange: {
        action: 'IMPROVE_EVIDENCE_INGESTION',
        targetKind: 'log_pointer',
        suggestedSources: [
          'cloudwatch_logs',
          'ecs_task_logs',
          'alb_access_logs',
          'github_runner_logs',
        ],
        implementation: 'Add log pointer extraction to incident detection pipeline',
      },
      expectedImpact: `Improve debugging efficiency by 25%, enable better automated root cause analysis, improve postmortem quality`,
      confidence: missingRate > 0.6 ? 'high' : missingRate > 0.5 ? 'medium' : 'low',
      references: {
        outcomeIds,
        incidentIds: [],
        kpiWindowRefs: [],
        evidenceHashes: [],
      },
      status: 'PROPOSED',
    };
    
    suggestion.suggestionId = computeSuggestionId(suggestion);
    return suggestion;
  }
  
  return null;
}

/**
 * Rule 6: Low auto-fix rate
 * If auto-fix rate < 30% and incident count > 5 → suggest review guardrails and evidence requirements
 */
function ruleLowAutoFixRate(data: DataInputs): TuningSuggestionV0_7_0 | null {
  const { outcomes, kpiAggregates } = data;
  
  const autoFixAggregate = kpiAggregates.find(k => k.kpi_name === 'autofix_rate');
  
  if (!autoFixAggregate || autoFixAggregate.value_num === null) return null;
  
  const autoFixRate = autoFixAggregate.value_num / 100; // Convert percentage to decimal
  
  if (autoFixRate < 0.3 && outcomes.length > 5) {
    const manualFixOutcomes = outcomes.filter(o => 
      o.postmortem_json?.outcome?.autoFixed === false
    );
    
    const outcomeIds = manualFixOutcomes.map(o => o.id);
    
    const suggestion: TuningSuggestionV0_7_0 = {
      version: TUNING_SUGGESTION_VERSION,
      generatedAt: new Date().toISOString(),
      suggestionId: '',
      type: 'GUARDRAIL',
      title: 'Review guardrails and evidence requirements to improve auto-fix rate',
      rationale: `Auto-fix rate is ${(autoFixRate * 100).toFixed(1)}% (${outcomes.filter(o => o.postmortem_json?.outcome?.autoFixed === true).length}/${outcomes.length} incidents). This may indicate overly conservative guardrails or insufficient evidence collection.`,
      proposedChange: 'Review playbook evidence requirements and guardrail thresholds. Consider relaxing constraints for low-risk playbooks with proven success rates. Prioritize evidence collection improvements over playbook restrictions.',
      expectedImpact: `Increase auto-fix rate by 10-15%, reducing manual intervention and MTTR`,
      confidence: 'low', // This is a complex issue requiring careful analysis
      references: {
        outcomeIds,
        incidentIds: [],
        kpiWindowRefs: autoFixAggregate ? [{
          window: autoFixAggregate.window,
          windowStart: autoFixAggregate.window_start,
          windowEnd: autoFixAggregate.window_end,
          kpiName: autoFixAggregate.kpi_name,
        }] : [],
        evidenceHashes: [],
      },
      status: 'PROPOSED',
    };
    
    suggestion.suggestionId = computeSuggestionId(suggestion);
    return suggestion;
  }
  
  return null;
}

// ========================================
// Data Collection
// ========================================

/**
 * Collect data inputs for suggestion generation
 */
async function collectDataInputs(
  pool: Pool,
  options: GenerateSuggestionsOptions
): Promise<DataInputs> {
  const { windowStart, windowEnd } = options;
  
  // Collect outcomes
  const outcomesResult = await pool.query(`
    SELECT id, entity_type, metrics_json, postmortem_json
    FROM outcome_records
    WHERE created_at >= $1 AND created_at < $2
    ORDER BY created_at DESC
  `, [windowStart, windowEnd]);
  
  // Collect incidents
  const incidentsResult = await pool.query(`
    SELECT id, severity, status, classification
    FROM incidents
    WHERE created_at >= $1 AND created_at < $2
    ORDER BY created_at DESC
  `, [windowStart, windowEnd]);
  
  // Collect KPI aggregates
  const kpiResult = await pool.query(`
    SELECT window, window_start, window_end, kpi_name, value_num, metadata
    FROM kpi_aggregates
    WHERE window_start >= $1 AND window_end <= $2
    ORDER BY window_start DESC
  `, [windowStart, windowEnd]);
  
  return {
    outcomes: outcomesResult.rows,
    incidents: incidentsResult.rows,
    kpiAggregates: kpiResult.rows,
  };
}

// ========================================
// Main Generator
// ========================================

/**
 * Generate tuning suggestions for a time window
 * 
 * Deterministic: same inputs → same suggestions
 */
export async function generateTuningSuggestions(
  pool: Pool,
  options: GenerateSuggestionsOptions
): Promise<SuggestionGenerationResult> {
  const { window, windowStart, windowEnd } = options;
  
  // Collect data inputs
  const dataInputs = await collectDataInputs(pool, options);
  
  // Check if we have insufficient data
  const totalDataPoints = 
    dataInputs.outcomes.length + 
    dataInputs.incidents.length + 
    dataInputs.kpiAggregates.length;
  
  if (totalDataPoints < 3) {
    // Insufficient data - return empty with metadata
    return {
      suggestions: [],
      isNew: false,
      metadata: {
        window,
        windowStart: windowStart.toISOString(),
        windowEnd: windowEnd.toISOString(),
        rulesApplied: [],
        dataPoints: {
          outcomeCount: dataInputs.outcomes.length,
          incidentCount: dataInputs.incidents.length,
          kpiAggregateCount: dataInputs.kpiAggregates.length,
        },
      },
    };
  }
  
  // Apply rules (deterministic order)
  const rules = [
    { name: 'ruleHighUnknownRate', fn: ruleHighUnknownRate },
    { name: 'ruleVerificationRerunSuccess', fn: ruleVerificationRerunSuccess },
    { name: 'ruleLkgRedeployFailures', fn: ruleLkgRedeployFailures },
    { name: 'ruleHighMttrCategory', fn: ruleHighMttrCategory },
    { name: 'ruleMissingLogPointers', fn: ruleMissingLogPointers },
    { name: 'ruleLowAutoFixRate', fn: ruleLowAutoFixRate },
  ];
  
  const generatedSuggestions: TuningSuggestionV0_7_0[] = [];
  const rulesApplied: string[] = [];
  
  for (const rule of rules) {
    const suggestion = rule.fn(dataInputs);
    if (suggestion) {
      generatedSuggestions.push(suggestion);
      rulesApplied.push(rule.name);
    }
  }
  
  // Sort suggestions by confidence and type for deterministic ordering
  generatedSuggestions.sort((a, b) => {
    // Sort by confidence (high > medium > low)
    const confidenceOrder = { high: 3, medium: 2, low: 1 };
    const confDiff = confidenceOrder[b.confidence] - confidenceOrder[a.confidence];
    if (confDiff !== 0) return confDiff;
    
    // Then by type
    return a.type.localeCompare(b.type);
  });
  
  // Store suggestions in database
  const records: TuningSuggestionRecord[] = [];
  let hasNewSuggestions = false;
  
  for (const suggestion of generatedSuggestions) {
    const suggestionHash = computeSuggestionHash(suggestion);
    
    // Try to insert (idempotent via unique constraint)
    try {
      const result = await pool.query(`
        INSERT INTO tuning_suggestions (
          window, window_start, window_end, suggestion_hash, suggestion_json
        )
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (window, window_start, window_end, suggestion_hash) 
        DO UPDATE SET created_at = tuning_suggestions.created_at
        RETURNING id, window, window_start, window_end, suggestion_hash, suggestion_json, created_at
      `, [
        window,
        windowStart,
        windowEnd,
        suggestionHash,
        JSON.stringify(suggestion),
      ]);
      
      const record = result.rows[0];
      records.push({
        id: record.id,
        window: record.window,
        window_start: record.window_start,
        window_end: record.window_end,
        suggestion_hash: record.suggestion_hash,
        suggestion_json: record.suggestion_json,
        created_at: record.created_at,
      });
      
      // Check if this is a new suggestion (created_at is recent)
      const createdAt = new Date(record.created_at);
      const now = new Date();
      const ageMs = now.getTime() - createdAt.getTime();
      if (ageMs < 5000) { // Created within last 5 seconds
        hasNewSuggestions = true;
      }
    } catch (error) {
      console.error('[TuningSuggestions] Error storing suggestion:', error);
      // Continue with other suggestions
    }
  }
  
  return {
    suggestions: records,
    isNew: hasNewSuggestions,
    metadata: {
      window,
      windowStart: windowStart.toISOString(),
      windowEnd: windowEnd.toISOString(),
      rulesApplied,
      dataPoints: {
        outcomeCount: dataInputs.outcomes.length,
        incidentCount: dataInputs.incidents.length,
        kpiAggregateCount: dataInputs.kpiAggregates.length,
      },
    },
  };
}

/**
 * Retrieve tuning suggestions for a time window
 */
export async function getTuningSuggestions(
  pool: Pool,
  options: {
    window?: string;
    fromDate?: Date;
    toDate?: Date;
    limit?: number;
  }
): Promise<TuningSuggestionRecord[]> {
  const { window, fromDate, toDate, limit = 100 } = options;
  
  let query = 'SELECT id, window, window_start, window_end, suggestion_hash, suggestion_json, created_at FROM tuning_suggestions WHERE 1=1';
  const params: any[] = [];
  let paramIndex = 1;
  
  if (window) {
    query += ` AND window = $${paramIndex}`;
    params.push(window);
    paramIndex++;
  }
  
  if (fromDate) {
    query += ` AND window_start >= $${paramIndex}`;
    params.push(fromDate);
    paramIndex++;
  }
  
  if (toDate) {
    query += ` AND window_end <= $${paramIndex}`;
    params.push(toDate);
    paramIndex++;
  }
  
  query += ` ORDER BY created_at DESC LIMIT $${paramIndex}`;
  params.push(limit);
  
  const result = await pool.query(query, params);
  
  return result.rows.map(row => ({
    id: row.id,
    window: row.window,
    window_start: row.window_start,
    window_end: row.window_end,
    suggestion_hash: row.suggestion_hash,
    suggestion_json: row.suggestion_json,
    created_at: row.created_at,
  }));
}
