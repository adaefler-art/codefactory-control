/**
 * Postmortem Generator (E78.2 / I782)
 * 
 * Generates evidence-based, deterministic postmortem artifacts for incidents.
 * - Only facts backed by stored evidence
 * - Unknowns when evidence is insufficient (no invention)
 * - Deterministic output (same inputs → same hash)
 * - No secrets, only pointers + hashes
 */

import { Pool } from 'pg';
import { createHash } from 'crypto';
import {
  PostmortemV0_7_0,
  PostmortemEvidenceRef,
  PostmortemPlaybookAttempt,
  computePostmortemHash,
  generateIncidentOutcomeKey,
  POSTMORTEM_VERSION,
  OutcomeRecordInput,
  MetricsJson,
  SourceRefs,
} from '../contracts/outcome';
import { getIncidentDAO } from '../db/incidents';
import { getRemediationPlaybookDAO } from '../db/remediation-playbooks';
import { getOutcomeRecordsDAO } from '../db/outcomes';

/**
 * Generate postmortem for an incident
 * 
 * Evidence-based generation:
 * 1. Fetch incident + evidence + events
 * 2. Fetch remediation runs (if any)
 * 3. Extract facts from evidence (no invention)
 * 4. Mark unknowns when evidence is missing
 * 5. Compute deterministic hash
 * 6. Create outcome record (idempotent)
 * 
 * @param pool Database pool
 * @param incidentId Incident UUID
 * @param lawbookVersion Lawbook version (optional)
 * @returns Created outcome record
 */
export async function generatePostmortemForIncident(
  pool: Pool,
  incidentId: string,
  lawbookVersion?: string
): Promise<{
  outcomeRecord: any;
  postmortem: PostmortemV0_7_0;
  isNew: boolean;
}> {
  const incidentDAO = getIncidentDAO(pool);
  const remediationDAO = getRemediationPlaybookDAO(pool);
  const outcomeDAO = getOutcomeRecordsDAO(pool);

  // 1. Fetch incident
  const incident = await incidentDAO.getIncident(incidentId);
  if (!incident) {
    throw new Error(`Incident not found: ${incidentId}`);
  }

  // 2. Fetch evidence
  const evidence = await incidentDAO.getEvidence(incidentId);

  // 3. Fetch incident events
  const events = await incidentDAO.getEvents(incidentId, 1000);

  // 4. Fetch remediation runs
  const remediationRuns = await remediationDAO.listRunsForIncident(incidentId, 100);

  // 5. Build postmortem artifact
  const postmortem = buildPostmortemArtifact(
    incident,
    evidence,
    events,
    remediationRuns
  );

  // 6. Compute deterministic hash
  const postmortemHash = computePostmortemHash(postmortem);

  // 7. Compute pack hash (for idempotency key)
  // Use stableStringify for deterministic hashing
  const { stableStringify } = require('../contracts/outcome');
  const packData = {
    incidentId: incident.id,
    evidenceCount: evidence.length,
    eventsCount: events.length,
    remediationCount: remediationRuns.length,
  };
  const packHash = createHash('sha256')
    .update(stableStringify(packData))
    .digest('hex')
    .substring(0, 16);

  // 8. Generate outcome_key
  const primaryRemediationRunId = remediationRuns.length > 0 
    ? remediationRuns[0].id 
    : null;
  const outcomeKey = generateIncidentOutcomeKey(
    incident.id,
    primaryRemediationRunId,
    packHash
  );

  // 9. Check if outcome already exists (idempotency)
  const exists = await outcomeDAO.outcomeRecordExists(outcomeKey, postmortemHash);

  // 10. Build metrics
  const metrics = buildMetrics(incident, remediationRuns, events);

  // 11. Build source refs
  const sourceRefs = buildSourceRefs(incident, remediationRuns, events);

  // 12. Create outcome record (idempotent)
  const outcomeRecordInput: OutcomeRecordInput = {
    entity_type: 'incident',
    entity_id: incident.id,
    outcome_key: outcomeKey,
    status: 'RECORDED',
    metrics_json: metrics,
    postmortem_json: postmortem,
    postmortem_hash: postmortemHash,
    lawbook_version: lawbookVersion || incident.lawbook_version || null,
    source_refs: sourceRefs,
  };

  const outcomeRecord = await outcomeDAO.createOutcomeRecord(outcomeRecordInput);

  return {
    outcomeRecord,
    postmortem,
    isNew: !exists,
  };
}

/**
 * Build postmortem artifact from incident data
 * Evidence-based: only facts, no invention
 * 
 * Note: generatedAt timestamp makes each postmortem unique even with same inputs.
 * This is intentional - each generation is a snapshot at a specific time.
 * For idempotency, we rely on outcome_key + postmortem_hash.
 * If the underlying data changes (new evidence, status change), a new outcome record
 * with a different hash will be created.
 */
function buildPostmortemArtifact(
  incident: any,
  evidence: any[],
  events: any[],
  remediationRuns: any[]
): PostmortemV0_7_0 {
  const generatedAt = new Date().toISOString();

  // Extract signal kinds from evidence
  const signalKinds = Array.from(new Set(evidence.map(e => e.kind)));

  // Primary evidence from incident.source_primary
  const primaryEvidence: PostmortemEvidenceRef = {
    kind: incident.source_primary.kind,
    ref: incident.source_primary.ref,
    hash: null,
  };

  // Extract category (from classification if available)
  const category = incident.classification?.category || null;

  // Determine if incident is closed
  const closedEvent = events.find(e => e.event_type === 'CLOSED');
  const closedAt = closedEvent ? closedEvent.created_at : null;

  // Calculate duration if closed
  const openedAt = new Date(incident.created_at);
  const durationMinutes = closedAt
    ? Math.round((new Date(closedAt).getTime() - openedAt.getTime()) / 60000)
    : null;

  // Build impact summary from evidence
  const impactSummary = buildImpactSummary(incident, evidence);

  // Build attempted playbooks
  const attemptedPlaybooks = remediationRuns.map(run => buildPlaybookAttempt(run));

  // Determine verification result
  const verification = buildVerificationResult(remediationRuns);

  // Determine if auto-fixed
  const autoFixed = remediationRuns.some(run => run.status === 'SUCCEEDED');

  // Calculate MTTR if resolved
  const resolved = incident.status === 'CLOSED';
  const mttrMinutes = resolved && durationMinutes !== null ? durationMinutes : null;

  // Extract facts from evidence
  const facts = extractFactsFromEvidence(incident, evidence, remediationRuns);

  // Extract unknowns (what we couldn't determine)
  const unknowns = extractUnknowns(incident, evidence, remediationRuns);

  // Build references
  const usedSourcesHashes = evidence
    .filter(e => e.sha256)
    .map(e => e.sha256)
    .filter((hash): hash is string => hash !== null);

  const pointers: PostmortemEvidenceRef[] = evidence.map(e => ({
    kind: e.kind,
    ref: e.ref,
    hash: e.sha256 || null,
  }));

  return {
    version: POSTMORTEM_VERSION,
    generatedAt,
    incident: {
      id: incident.id,
      key: incident.incident_key,
      severity: incident.severity,
      category,
      openedAt: incident.created_at,
      closedAt,
    },
    detection: {
      signalKinds,
      primaryEvidence,
    },
    impact: {
      summary: impactSummary,
      durationMinutes,
    },
    remediation: {
      attemptedPlaybooks,
    },
    verification,
    outcome: {
      resolved,
      mttrMinutes,
      autoFixed,
    },
    learnings: {
      facts,
      unknowns,
    },
    references: {
      used_sources_hashes: usedSourcesHashes,
      pointers,
    },
  };
}

/**
 * Build impact summary from evidence
 * Only evidence-backed facts, no invention
 */
function buildImpactSummary(incident: any, evidence: any[]): string {
  // Start with incident title (always available)
  let summary = incident.title;

  // Add evidence-backed details if available
  if (incident.summary) {
    summary = incident.summary;
  }

  // Extract specific facts from evidence
  const ecsEvidence = evidence.find(e => e.kind === 'ecs');
  if (ecsEvidence?.ref?.stoppedReason) {
    summary += ` ECS task stopped: ${ecsEvidence.ref.stoppedReason}`;
  }

  const verificationEvidence = evidence.find(e => e.kind === 'verification');
  if (verificationEvidence?.ref?.result) {
    summary += ` Verification ${verificationEvidence.ref.result}`;
  }

  return summary.trim();
}

/**
 * Build playbook attempt record
 */
function buildPlaybookAttempt(run: any): PostmortemPlaybookAttempt {
  return {
    playbookId: run.playbook_id,
    status: run.status,
    startedAt: run.created_at,
    finishedAt: run.updated_at !== run.created_at ? run.updated_at : null,
    verificationHash: run.result_json?.verificationHash || null,
  };
}

/**
 * Build verification result
 */
function buildVerificationResult(remediationRuns: any[]): {
  result: 'PASS' | 'FAIL' | 'UNKNOWN';
  reportHash: string | null;
} {
  // Check if any run has verification result
  const runWithVerification = remediationRuns.find(
    run => run.result_json?.verificationHash
  );

  if (!runWithVerification) {
    return { result: 'UNKNOWN', reportHash: null };
  }

  // Check verification result
  const verificationResult = runWithVerification.result_json?.verificationResult;
  const result = verificationResult === 'PASS' || verificationResult === 'FAIL'
    ? verificationResult
    : 'UNKNOWN';

  return {
    result,
    reportHash: runWithVerification.result_json?.verificationHash || null,
  };
}

/**
 * Extract facts from evidence
 * Only what we can definitively state based on evidence
 */
function extractFactsFromEvidence(
  incident: any,
  evidence: any[],
  remediationRuns: any[]
): string[] {
  const facts: string[] = [];

  // Fact: Incident severity and category
  facts.push(`Incident severity: ${incident.severity}`);
  if (incident.classification?.category) {
    facts.push(`Classified as: ${incident.classification.category}`);
  }

  // Fact: Evidence count
  facts.push(`Evidence collected: ${evidence.length} items`);

  // Fact: Signal kinds
  const signalKinds = Array.from(new Set(evidence.map(e => e.kind)));
  facts.push(`Signal sources: ${signalKinds.join(', ')}`);

  // Fact: Remediation attempts
  if (remediationRuns.length > 0) {
    facts.push(`Remediation attempts: ${remediationRuns.length}`);
    const succeeded = remediationRuns.filter(r => r.status === 'SUCCEEDED').length;
    if (succeeded > 0) {
      facts.push(`Successful remediation runs: ${succeeded}`);
    }
  }

  // Fact: Incident status
  facts.push(`Final status: ${incident.status}`);

  return facts;
}

/**
 * Extract unknowns (what we couldn't determine)
 * Explicitly state gaps in knowledge
 */
function extractUnknowns(
  incident: any,
  evidence: any[],
  remediationRuns: any[]
): string[] {
  const unknowns: string[] = [];

  // Unknown: Root cause if not classified
  if (!incident.classification?.category) {
    unknowns.push('Root cause: Not classified');
  }

  // Unknown: Impact metrics if no specific evidence
  const hasImpactMetrics = evidence.some(e => 
    e.kind === 'verification' || e.kind === 'http' || e.kind === 'alb'
  );
  if (!hasImpactMetrics) {
    unknowns.push('Impact metrics: No health check or verification data available');
  }

  // Unknown: Verification result if no remediation
  if (remediationRuns.length === 0) {
    unknowns.push('Remediation outcome: No remediation attempted');
  } else {
    const hasVerification = remediationRuns.some(
      r => r.result_json?.verificationHash
    );
    if (!hasVerification) {
      unknowns.push('Verification result: No verification data available');
    }
  }

  // Unknown: MTTR if not closed
  if (incident.status !== 'CLOSED') {
    unknowns.push('MTTR: Incident not yet resolved');
  }

  return unknowns;
}

/**
 * Build metrics from incident data
 */
function buildMetrics(
  incident: any,
  remediationRuns: any[],
  events: any[]
): MetricsJson {
  const metrics: MetricsJson = {};

  // Calculate MTTR if closed
  const closedEvent = events.find(e => e.event_type === 'CLOSED');
  if (closedEvent) {
    const openedAt = new Date(incident.created_at);
    const closedAt = new Date(closedEvent.created_at);
    const mttrHours = (closedAt.getTime() - openedAt.getTime()) / (1000 * 60 * 60);
    metrics.mttr_hours = Math.round(mttrHours * 100) / 100; // 2 decimal places
  }

  // Incidents delta: -1 if closed, 0 otherwise
  if (incident.status === 'CLOSED') {
    metrics.incidents_open = -1;
  }

  // Auto-fixed flag
  const autoFixed = remediationRuns.some(r => r.status === 'SUCCEEDED');
  metrics.auto_fixed = autoFixed;

  // Playbook metrics
  metrics.playbooks_attempted = remediationRuns.length;
  metrics.playbooks_succeeded = remediationRuns.filter(
    r => r.status === 'SUCCEEDED'
  ).length;

  return metrics;
}

/**
 * Build source refs from incident data
 */
function buildSourceRefs(
  incident: any,
  remediationRuns: any[],
  events: any[]
): SourceRefs {
  const sourceRefs: SourceRefs = {
    incidentId: incident.id,
    remediationRunIds: remediationRuns.map(r => r.id),
  };

  // Extract verification hashes
  const verificationHashes = remediationRuns
    .map(r => r.result_json?.verificationHash)
    .filter((hash): hash is string => !!hash);
  if (verificationHashes.length > 0) {
    sourceRefs.verificationReportHashes = verificationHashes;
  }

  // Extract status changes from events
  const statusChanges = events
    .filter(e => e.event_type === 'UPDATED' && e.payload?.status)
    .map(e => ({
      from: e.payload.oldStatus || 'UNKNOWN',
      to: e.payload.status,
      at: e.created_at,
    }));
  if (statusChanges.length > 0) {
    sourceRefs.statusChanges = statusChanges;
  }

  return sourceRefs;
}
