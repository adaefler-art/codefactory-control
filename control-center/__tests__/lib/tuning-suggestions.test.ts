/**
 * Tuning Suggestions Generator Tests (E78.3 / I783)
 * 
 * Tests for deterministic tuning suggestion generation:
 * - Deterministic suggestion hash (same inputs → same hash)
 * - Suggestion references validation
 * - Insufficient data handling (returns empty with reason)
 * - Rule-based generation logic
 * 
 * @jest-environment node
 */

import { Pool } from 'pg';
import { getPool } from '../../src/lib/db';
import { generateTuningSuggestions, getTuningSuggestions } from '../../src/lib/tuning-suggestions-service';
import { 
  computeSuggestionHash, 
  computeSuggestionId,
  TuningSuggestionV0_7_0,
} from '../../src/lib/contracts/tuning-suggestions';
import { v4 as uuidv4 } from 'uuid';

// Skip if no database connection
const describeIfDb = process.env.DATABASE_URL ? describe : describe.skip;

describeIfDb('Tuning Suggestions Generator', () => {
  let pool: Pool;
  let testIncidentIds: string[] = [];
  let testOutcomeIds: string[] = [];

  beforeAll(() => {
    pool = getPool();
  });

  beforeEach(async () => {
    // Clean up test data
    testIncidentIds = [];
    testOutcomeIds = [];
  });

  afterEach(async () => {
    // Cleanup: delete test data
    if (testOutcomeIds.length > 0) {
      await pool.query('DELETE FROM outcome_records WHERE id = ANY($1)', [testOutcomeIds]);
    }
    if (testIncidentIds.length > 0) {
      await pool.query('DELETE FROM incidents WHERE id = ANY($1)', [testIncidentIds]);
    }
    
    // Clean up test suggestions
    await pool.query(`
      DELETE FROM tuning_suggestions 
      WHERE window = 'daily' 
      AND window_start >= NOW() - INTERVAL '1 day'
    `);
  });

  test('returns empty suggestions with insufficient data', async () => {
    const windowStart = new Date(Date.now() - 3600 * 1000); // 1 hour ago
    const windowEnd = new Date();

    const result = await generateTuningSuggestions(pool, {
      window: 'daily',
      windowStart,
      windowEnd,
    });

    expect(result.suggestions).toHaveLength(0);
    expect(result.isNew).toBe(false);
    expect(result.metadata.dataPoints.outcomeCount).toBeDefined();
    expect(result.metadata.dataPoints.incidentCount).toBeDefined();
    expect(result.metadata.dataPoints.kpiAggregateCount).toBeDefined();
  });

  test('generates deterministic suggestion hash', () => {
    const suggestion1: TuningSuggestionV0_7_0 = {
      version: '0.7.0',
      generatedAt: '2025-01-01T00:00:00.000Z',
      suggestionId: 'test123',
      type: 'CLASSIFIER_RULE',
      title: 'Test Suggestion',
      rationale: 'Test rationale',
      proposedChange: 'Test change',
      expectedImpact: 'Test impact',
      confidence: 'medium',
      references: {
        outcomeIds: ['11111111-1111-1111-1111-111111111111'],
        incidentIds: [],
        kpiWindowRefs: [],
        evidenceHashes: [],
      },
      status: 'PROPOSED',
    };

    const suggestion2: TuningSuggestionV0_7_0 = {
      ...suggestion1,
      generatedAt: '2025-01-02T00:00:00.000Z', // Different timestamp
      suggestionId: 'different456', // Different ID
    };

    // Same content should produce same hash
    const hash1 = computeSuggestionHash(suggestion1);
    const hash2 = computeSuggestionHash(suggestion2);

    expect(hash1).toBe(hash2);
    expect(hash1).toHaveLength(64); // SHA-256 produces 64 hex chars
  });

  test('generates stable suggestion ID', () => {
    const suggestion: TuningSuggestionV0_7_0 = {
      version: '0.7.0',
      generatedAt: new Date().toISOString(),
      suggestionId: '',
      type: 'PLAYBOOK_TUNING',
      title: 'Test Suggestion',
      rationale: 'Test rationale',
      proposedChange: 'Test change',
      expectedImpact: 'Test impact',
      confidence: 'high',
      references: {
        outcomeIds: [],
        incidentIds: [],
        kpiWindowRefs: [],
        evidenceHashes: [],
      },
      status: 'PROPOSED',
    };

    const id1 = computeSuggestionId(suggestion);
    const id2 = computeSuggestionId(suggestion);

    expect(id1).toBe(id2);
    expect(id1).toHaveLength(16); // First 16 chars of hash
  });

  test('generates suggestions for high UNKNOWN rate', async () => {
    // Create test incidents with UNKNOWN classification
    const windowStart = new Date(Date.now() - 3600 * 1000); // 1 hour ago
    const windowEnd = new Date();

    // Create 5 incidents, 3 with UNKNOWN classification
    for (let i = 0; i < 5; i++) {
      const result = await pool.query(`
        INSERT INTO incidents (
          incident_key, severity, status, title, classification,
          lawbook_version, source_primary, created_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING id
      `, [
        `test:tuning:${Date.now()}:${i}`,
        'RED',
        'OPEN',
        `Test Incident ${i}`,
        i < 3 ? JSON.stringify({ category: 'UNKNOWN' }) : JSON.stringify({ category: 'DEPLOY_FAILURE' }),
        'v1.0.0-test',
        JSON.stringify({ kind: 'deploy_status', ref: { deployId: `test-${i}` } }),
        windowStart,
      ]);
      testIncidentIds.push(result.rows[0].id);
    }

    const result = await generateTuningSuggestions(pool, {
      window: 'daily',
      windowStart,
      windowEnd,
    });

    expect(result.suggestions.length).toBeGreaterThan(0);
    
    // Should have a classifier rule suggestion
    const classifierSuggestion = result.suggestions.find(
      s => s.suggestion_json.type === 'CLASSIFIER_RULE'
    );
    
    expect(classifierSuggestion).toBeDefined();
    expect(classifierSuggestion!.suggestion_json.title).toContain('classifier');
    expect(classifierSuggestion!.suggestion_json.references.incidentIds.length).toBe(3);
  });

  test('idempotent generation - same inputs produce same results', async () => {
    const windowStart = new Date(Date.now() - 7200 * 1000); // 2 hours ago
    const windowEnd = new Date(Date.now() - 3600 * 1000); // 1 hour ago

    // Create test incident
    const incidentResult = await pool.query(`
      INSERT INTO incidents (
        incident_key, severity, status, title, classification,
        lawbook_version, source_primary, created_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING id
    `, [
      `test:tuning:idempotent:${Date.now()}`,
      'RED',
      'OPEN',
      'Test Idempotent Incident',
      JSON.stringify({ category: 'UNKNOWN' }),
      'v1.0.0-test',
      JSON.stringify({ kind: 'deploy_status', ref: { deployId: 'test-idempotent' } }),
      windowStart,
    ]);
    testIncidentIds.push(incidentResult.rows[0].id);

    // Generate suggestions twice
    const result1 = await generateTuningSuggestions(pool, {
      window: 'daily',
      windowStart,
      windowEnd,
    });

    const result2 = await generateTuningSuggestions(pool, {
      window: 'daily',
      windowStart,
      windowEnd,
    });

    // Should have same number of suggestions
    expect(result1.suggestions.length).toBe(result2.suggestions.length);

    // Should have same suggestion hashes
    const hashes1 = result1.suggestions.map(s => s.suggestion_hash).sort();
    const hashes2 = result2.suggestions.map(s => s.suggestion_hash).sort();
    expect(hashes1).toEqual(hashes2);

    // Second call should not create new records
    expect(result2.isNew).toBe(false);
  });

  test('validates suggestion references exist', async () => {
    const windowStart = new Date(Date.now() - 3600 * 1000);
    const windowEnd = new Date();

    // Create incident with classification
    const incidentResult = await pool.query(`
      INSERT INTO incidents (
        incident_key, severity, status, title, classification,
        lawbook_version, source_primary, created_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING id
    `, [
      `test:tuning:refs:${Date.now()}`,
      'RED',
      'OPEN',
      'Test Reference Validation',
      JSON.stringify({ category: 'UNKNOWN' }),
      'v1.0.0-test',
      JSON.stringify({ kind: 'deploy_status', ref: { deployId: 'test-refs' } }),
      windowStart,
    ]);
    const incidentId = incidentResult.rows[0].id;
    testIncidentIds.push(incidentId);

    const result = await generateTuningSuggestions(pool, {
      window: 'daily',
      windowStart,
      windowEnd,
    });

    // Check that all referenced incident IDs exist in database
    for (const suggestion of result.suggestions) {
      const { incidentIds, outcomeIds } = suggestion.suggestion_json.references;

      // Validate incident IDs
      if (incidentIds && incidentIds.length > 0) {
        const incidentCheck = await pool.query(
          'SELECT id FROM incidents WHERE id = ANY($1)',
          [incidentIds]
        );
        expect(incidentCheck.rows.length).toBe(incidentIds.length);
      }

      // Validate outcome IDs
      if (outcomeIds && outcomeIds.length > 0) {
        const outcomeCheck = await pool.query(
          'SELECT id FROM outcome_records WHERE id = ANY($1)',
          [outcomeIds]
        );
        expect(outcomeCheck.rows.length).toBe(outcomeIds.length);
      }
    }
  });

  test('retrieves suggestions by window and date range', async () => {
    const windowStart = new Date(Date.now() - 7200 * 1000);
    const windowEnd = new Date(Date.now() - 3600 * 1000);

    // Create test incident
    const incidentResult = await pool.query(`
      INSERT INTO incidents (
        incident_key, severity, status, title, classification,
        lawbook_version, source_primary, created_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING id
    `, [
      `test:tuning:retrieve:${Date.now()}`,
      'RED',
      'OPEN',
      'Test Retrieve',
      JSON.stringify({ category: 'UNKNOWN' }),
      'v1.0.0-test',
      JSON.stringify({ kind: 'deploy_status', ref: { deployId: 'test-retrieve' } }),
      windowStart,
    ]);
    testIncidentIds.push(incidentResult.rows[0].id);

    // Generate suggestions
    await generateTuningSuggestions(pool, {
      window: 'daily',
      windowStart,
      windowEnd,
    });

    // Retrieve suggestions
    const suggestions = await getTuningSuggestions(pool, {
      window: 'daily',
      fromDate: windowStart,
      toDate: windowEnd,
    });

    expect(suggestions.length).toBeGreaterThan(0);
    expect(suggestions[0].window).toBe('daily');
    expect(suggestions[0].suggestion_json.version).toBe('0.7.0');
  });

  test('suggestion schema includes all required fields', async () => {
    const windowStart = new Date(Date.now() - 3600 * 1000);
    const windowEnd = new Date();

    // Create enough incidents to trigger a rule
    for (let i = 0; i < 3; i++) {
      const result = await pool.query(`
        INSERT INTO incidents (
          incident_key, severity, status, title, classification,
          lawbook_version, source_primary, created_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING id
      `, [
        `test:tuning:schema:${Date.now()}:${i}`,
        'RED',
        'OPEN',
        `Test Schema ${i}`,
        JSON.stringify({ category: 'UNKNOWN' }),
        'v1.0.0-test',
        JSON.stringify({ kind: 'deploy_status', ref: { deployId: `test-schema-${i}` } }),
        windowStart,
      ]);
      testIncidentIds.push(result.rows[0].id);
    }

    const result = await generateTuningSuggestions(pool, {
      window: 'daily',
      windowStart,
      windowEnd,
    });

    expect(result.suggestions.length).toBeGreaterThan(0);

    // Validate schema of first suggestion
    const suggestion = result.suggestions[0].suggestion_json;
    expect(suggestion.version).toBe('0.7.0');
    expect(suggestion.generatedAt).toBeDefined();
    expect(suggestion.suggestionId).toBeDefined();
    expect(suggestion.type).toMatch(/PLAYBOOK_TUNING|CLASSIFIER_RULE|EVIDENCE_GAP|GUARDRAIL/);
    expect(suggestion.title).toBeDefined();
    expect(suggestion.rationale).toBeDefined();
    expect(suggestion.proposedChange).toBeDefined();
    expect(suggestion.expectedImpact).toBeDefined();
    expect(suggestion.confidence).toMatch(/low|medium|high/);
    expect(suggestion.references).toBeDefined();
    expect(suggestion.status).toBe('PROPOSED');
  });
});
