/**
 * Outcome Records + Postmortem Generator Tests (E78.2 / I782)
 * 
 * Tests for evidence-based postmortem generation:
 * - Deterministic postmortem hash (same inputs → same hash)
 * - Idempotent generation (duplicate detection)
 * - Unknowns population when evidence missing
 * - Evidence-based fact extraction
 * 
 * @jest-environment node
 */

import { Pool } from 'pg';
import { getPool } from '../../src/lib/db';
import { getIncidentDAO } from '../../src/lib/db/incidents';
import { getRemediationPlaybookDAO } from '../../src/lib/db/remediation-playbooks';
import { getOutcomeRecordsDAO } from '../../src/lib/db/outcomes';
import { generatePostmortemForIncident } from '../../src/lib/generators/postmortem-generator';
import { computePostmortemHash } from '../../src/lib/contracts/outcome';
import { v4 as uuidv4 } from 'uuid';

// Skip if no database connection
const describeIfDb = process.env.DATABASE_URL ? describe : describe.skip;

describeIfDb('Postmortem Generator', () => {
  let pool: Pool;
  let testIncidentId: string;

  beforeAll(() => {
    pool = getPool();
  });

  beforeEach(async () => {
    // Create a test incident
    const incidentDAO = getIncidentDAO(pool);
    
    const incident = await incidentDAO.upsertIncidentByKey({
      incident_key: `test:postmortem:${Date.now()}:${Math.random()}`,
      severity: 'RED',
      status: 'OPEN',
      title: 'Test Incident for Postmortem',
      summary: 'Test incident to verify postmortem generation',
      lawbook_version: 'v1.0.0-test',
      source_primary: {
        kind: 'deploy_status',
        ref: { env: 'test', deployId: 'test-123' },
      },
      tags: ['test', 'postmortem'],
    });

    testIncidentId = incident.id;

    // Add some evidence
    await incidentDAO.addEvidence([
      {
        incident_id: testIncidentId,
        kind: 'deploy_status',
        ref: { status: 'RED', message: 'Deploy failed' },
        sha256: 'test-evidence-hash-1',
      },
      {
        incident_id: testIncidentId,
        kind: 'verification',
        ref: { result: 'FAIL', checksPassed: 0, checksFailed: 3 },
        sha256: 'test-evidence-hash-2',
      },
    ]);
  });

  afterEach(async () => {
    // Cleanup: delete test incident (cascade will clean up related records)
    if (testIncidentId) {
      await pool.query('DELETE FROM incidents WHERE id = $1', [testIncidentId]);
    }
  });

  test('generates postmortem with required fields', async () => {
    const result = await generatePostmortemForIncident(pool, testIncidentId, 'v1.0.0-test');

    expect(result.postmortem).toBeDefined();
    expect(result.postmortem.version).toBe('0.7.0');
    expect(result.postmortem.incident.id).toBe(testIncidentId);
    expect(result.postmortem.incident.severity).toBe('RED');
    expect(result.postmortem.detection.signalKinds).toContain('deploy_status');
    expect(result.postmortem.detection.signalKinds).toContain('verification');
    expect(result.postmortem.impact.summary).toBeDefined();
    expect(result.postmortem.outcome.resolved).toBe(false); // Not closed yet
    expect(result.postmortem.outcome.autoFixed).toBe(false); // No successful remediation
    expect(result.postmortem.learnings.facts).toBeInstanceOf(Array);
    expect(result.postmortem.learnings.unknowns).toBeInstanceOf(Array);
  });

  test('generates deterministic postmortem hash', async () => {
    // Generate postmortem twice
    const result1 = await generatePostmortemForIncident(pool, testIncidentId, 'v1.0.0-test');
    const result2 = await generatePostmortemForIncident(pool, testIncidentId, 'v1.0.0-test');

    // Both should have the same postmortem content (except generatedAt)
    // Normalize generatedAt for comparison
    const pm1 = { ...result1.postmortem, generatedAt: 'NORMALIZED' };
    const pm2 = { ...result2.postmortem, generatedAt: 'NORMALIZED' };

    const hash1 = computePostmortemHash(pm1);
    const hash2 = computePostmortemHash(pm2);

    expect(hash1).toBe(hash2);
  });

  test('creates outcome record idempotently', async () => {
    // Generate postmortem twice
    const result1 = await generatePostmortemForIncident(pool, testIncidentId, 'v1.0.0-test');
    const result2 = await generatePostmortemForIncident(pool, testIncidentId, 'v1.0.0-test');

    // First call should create new record
    expect(result1.isNew).toBe(true);
    
    // Second call should find existing record (same postmortem_hash)
    expect(result2.isNew).toBe(false);

    // Both should return the same outcome record ID
    expect(result1.outcomeRecord.id).toBe(result2.outcomeRecord.id);
  });

  test('populates unknowns when evidence is missing', async () => {
    // Create incident without classification
    const incidentDAO = getIncidentDAO(pool);
    const unclassifiedIncident = await incidentDAO.upsertIncidentByKey({
      incident_key: `test:unclassified:${Date.now()}:${Math.random()}`,
      severity: 'YELLOW',
      status: 'OPEN',
      title: 'Unclassified Test Incident',
      lawbook_version: 'v1.0.0-test',
      source_primary: {
        kind: 'runner',
        ref: { runId: 'test-run-123' },
      },
      tags: ['test'],
    });

    const result = await generatePostmortemForIncident(pool, unclassifiedIncident.id, 'v1.0.0-test');

    // Should have unknowns
    expect(result.postmortem.learnings.unknowns.length).toBeGreaterThan(0);
    
    // Should explicitly state what we don't know
    const unknownsText = result.postmortem.learnings.unknowns.join(' ');
    expect(unknownsText).toContain('Root cause: Not classified');
    expect(unknownsText).toContain('No remediation attempted');
    expect(unknownsText).toContain('not yet resolved');

    // Cleanup
    await pool.query('DELETE FROM incidents WHERE id = $1', [unclassifiedIncident.id]);
  });

  test('extracts facts from evidence', async () => {
    const result = await generatePostmortemForIncident(pool, testIncidentId, 'v1.0.0-test');

    const facts = result.postmortem.learnings.facts;
    expect(facts.length).toBeGreaterThan(0);

    // Should include severity fact
    expect(facts.some(f => f.includes('severity: RED'))).toBe(true);

    // Should include evidence count
    expect(facts.some(f => f.includes('Evidence collected: 2 items'))).toBe(true);

    // Should include signal sources
    expect(facts.some(f => f.includes('deploy_status'))).toBe(true);
  });

  test('calculates MTTR for closed incidents', async () => {
    const incidentDAO = getIncidentDAO(pool);

    // Close the incident
    await incidentDAO.updateStatus(testIncidentId, 'CLOSED');

    // Create CLOSED event
    await incidentDAO.createEvent({
      incident_id: testIncidentId,
      event_type: 'CLOSED',
      payload: {},
    });

    const result = await generatePostmortemForIncident(pool, testIncidentId, 'v1.0.0-test');

    expect(result.postmortem.outcome.resolved).toBe(true);
    expect(result.postmortem.outcome.mttrMinutes).toBeDefined();
    expect(result.postmortem.outcome.mttrMinutes).toBeGreaterThanOrEqual(0);
    expect(result.outcomeRecord.metrics_json.mttr_hours).toBeDefined();
  });

  test('tracks remediation attempts in postmortem', async () => {
    const remediationDAO = getRemediationPlaybookDAO(pool);

    // Create a remediation run
    await remediationDAO.upsertRunByKey({
      run_key: `test:remediation:${Date.now()}`,
      incident_id: testIncidentId,
      playbook_id: 'test-playbook',
      playbook_version: 'v1.0.0',
      status: 'SUCCEEDED',
      lawbook_version: 'v1.0.0-test',
      inputs_hash: 'test-hash',
      planned_json: { steps: [] },
      result_json: { verificationHash: 'verify-hash-123' },
    });

    const result = await generatePostmortemForIncident(pool, testIncidentId, 'v1.0.0-test');

    // Should track remediation attempt
    expect(result.postmortem.remediation.attemptedPlaybooks.length).toBe(1);
    expect(result.postmortem.remediation.attemptedPlaybooks[0].playbookId).toBe('test-playbook');
    expect(result.postmortem.remediation.attemptedPlaybooks[0].status).toBe('SUCCEEDED');

    // Should mark as auto-fixed
    expect(result.postmortem.outcome.autoFixed).toBe(true);

    // Should track verification
    expect(result.postmortem.verification.reportHash).toBe('verify-hash-123');
  });
});

describeIfDb('Outcome Records DAO', () => {
  let pool: Pool;
  let testOutcomeId: string;

  beforeAll(() => {
    pool = getPool();
  });

  afterEach(async () => {
    if (testOutcomeId) {
      await pool.query('DELETE FROM outcome_records WHERE id = $1', [testOutcomeId]);
    }
  });

  test('creates outcome record', async () => {
    const dao = getOutcomeRecordsDAO(pool);

    const outcome = await dao.createOutcomeRecord({
      entity_type: 'incident',
      entity_id: uuidv4(),
      outcome_key: `test:outcome:${Date.now()}`,
      status: 'RECORDED',
      metrics_json: { mttr_hours: 2.5, auto_fixed: true },
      postmortem_json: {
        version: '0.7.0',
        generatedAt: new Date().toISOString(),
        incident: {
          id: uuidv4(),
          key: 'test-key',
          severity: 'RED',
          category: null,
          openedAt: new Date().toISOString(),
          closedAt: null,
        },
        detection: {
          signalKinds: ['test'],
          primaryEvidence: { kind: 'test', ref: {}, hash: null },
        },
        impact: { summary: 'Test', durationMinutes: null },
        remediation: { attemptedPlaybooks: [] },
        verification: { result: 'UNKNOWN', reportHash: null },
        outcome: { resolved: false, mttrMinutes: null, autoFixed: false },
        learnings: { facts: [], unknowns: [] },
        references: { used_sources_hashes: [], pointers: [] },
      },
      postmortem_hash: 'test-hash',
      lawbook_version: 'v1.0.0-test',
      source_refs: { incidentId: uuidv4() },
    });

    testOutcomeId = outcome.id;

    expect(outcome).toBeDefined();
    expect(outcome.id).toBeDefined();
    expect(outcome.entity_type).toBe('incident');
    expect(outcome.status).toBe('RECORDED');
    expect(outcome.metrics_json.mttr_hours).toBe(2.5);
  });

  test('enforces idempotency on outcome_key + postmortem_hash', async () => {
    const dao = getOutcomeRecordsDAO(pool);

    const outcomeKey = `test:idempotent:${Date.now()}`;
    const postmortemHash = 'idempotent-test-hash';

    const sharedInput = {
      entity_type: 'incident' as const,
      entity_id: uuidv4(),
      outcome_key: outcomeKey,
      status: 'RECORDED' as const,
      metrics_json: {},
      postmortem_json: {
        version: '0.7.0' as const,
        generatedAt: new Date().toISOString(),
        incident: {
          id: uuidv4(),
          key: 'test',
          severity: 'RED' as const,
          category: null,
          openedAt: new Date().toISOString(),
          closedAt: null,
        },
        detection: {
          signalKinds: ['test'],
          primaryEvidence: { kind: 'test', ref: {}, hash: null },
        },
        impact: { summary: 'Test', durationMinutes: null },
        remediation: { attemptedPlaybooks: [] },
        verification: { result: 'UNKNOWN' as const, reportHash: null },
        outcome: { resolved: false, mttrMinutes: null, autoFixed: false },
        learnings: { facts: [], unknowns: [] },
        references: { used_sources_hashes: [], pointers: [] },
      },
      postmortem_hash: postmortemHash,
      lawbook_version: 'v1.0.0-test',
      source_refs: {},
    };

    // Create first record
    const outcome1 = await dao.createOutcomeRecord(sharedInput);
    testOutcomeId = outcome1.id;

    // Create second record with same key + hash (should return existing)
    const outcome2 = await dao.createOutcomeRecord(sharedInput);

    // Should return same record
    expect(outcome1.id).toBe(outcome2.id);
  });

  test('retrieves outcome records by incident', async () => {
    const dao = getOutcomeRecordsDAO(pool);
    const incidentId = uuidv4();

    const outcome = await dao.createOutcomeRecord({
      entity_type: 'incident',
      entity_id: incidentId,
      outcome_key: `test:incident:${Date.now()}`,
      status: 'RECORDED',
      metrics_json: {},
      postmortem_json: {
        version: '0.7.0',
        generatedAt: new Date().toISOString(),
        incident: {
          id: incidentId,
          key: 'test',
          severity: 'YELLOW',
          category: null,
          openedAt: new Date().toISOString(),
          closedAt: null,
        },
        detection: {
          signalKinds: [],
          primaryEvidence: { kind: 'test', ref: {}, hash: null },
        },
        impact: { summary: 'Test', durationMinutes: null },
        remediation: { attemptedPlaybooks: [] },
        verification: { result: 'UNKNOWN', reportHash: null },
        outcome: { resolved: false, mttrMinutes: null, autoFixed: false },
        learnings: { facts: [], unknowns: [] },
        references: { used_sources_hashes: [], pointers: [] },
      },
      postmortem_hash: 'test-hash-incident',
      lawbook_version: null,
      source_refs: { incidentId },
    });

    testOutcomeId = outcome.id;

    const outcomes = await dao.getOutcomeRecordsByIncident(incidentId);

    expect(outcomes.length).toBeGreaterThan(0);
    expect(outcomes[0].entity_id).toBe(incidentId);
  });
});
