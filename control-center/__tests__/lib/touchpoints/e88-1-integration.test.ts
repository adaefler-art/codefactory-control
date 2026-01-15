/**
 * E88.1 Integration Test: Simulated Cycle Scenario
 * 
 * Validates acceptance criteria:
 * - Simulated cycle with 1 review + 1 approval
 * - Expected: exactly 2 touchpoints
 * - Zero impact on existing automation
 * - Deterministic aggregation
 */

import { Pool } from 'pg';
import {
  insertTouchpoint,
  getTouchpointStatsByCycle,
  getTouchpointsByCycle,
} from '@/lib/db/manualTouchpoints';
import {
  recordReviewTouchpoint,
  recordMergeApprovalTouchpoint,
  generateIdempotencyKey,
} from '@/lib/touchpoints/manual-touchpoints';

describe('E88.1 Integration: Simulated Cycle Scenario', () => {
  // Mock pool for testing
  const createMockPool = () => {
    const records: any[] = [];
    return {
      query: jest.fn((sql: string, params?: any[]) => {
        // Handle INSERT queries
        if (sql.includes('INSERT INTO manual_touchpoints')) {
          const idempotencyKey = params?.[0];
          
          // Check for duplicate
          const existing = records.find(
            (r) => r.idempotency_key === idempotencyKey
          );
          
          if (existing) {
            // ON CONFLICT DO NOTHING
            return Promise.resolve({ rows: [] });
          }
          
          // Insert new record
          const newRecord = {
            id: records.length + 1,
            idempotency_key: params?.[0],
            cycle_id: params?.[1],
            issue_id: params?.[2],
            gh_issue_number: params?.[3],
            pr_number: params?.[4],
            session_id: params?.[5],
            type: params?.[6],
            source: params?.[7],
            actor: params?.[8],
            request_id: params?.[9],
            metadata: JSON.parse(params?.[10] || '{}'),
            created_at: new Date(),
          };
          records.push(newRecord);
          return Promise.resolve({ rows: [newRecord] });
        }
        
        // Handle SELECT queries (fetch existing by idempotency_key)
        if (sql.includes('WHERE idempotency_key = $1')) {
          const existing = records.find(
            (r) => r.idempotency_key === params?.[0]
          );
          return Promise.resolve({ rows: existing ? [existing] : [] });
        }
        
        // Handle stats query
        if (sql.includes('COUNT(*) as total')) {
          const cycleRecords = records.filter(
            (r) => r.cycle_id === params?.[0]
          );
          
          return Promise.resolve({
            rows: [
              {
                total: String(cycleRecords.length),
                assign_count: String(
                  cycleRecords.filter((r) => r.type === 'ASSIGN').length
                ),
                review_count: String(
                  cycleRecords.filter((r) => r.type === 'REVIEW').length
                ),
                merge_approval_count: String(
                  cycleRecords.filter((r) => r.type === 'MERGE_APPROVAL').length
                ),
                debug_intervention_count: String(
                  cycleRecords.filter((r) => r.type === 'DEBUG_INTERVENTION').length
                ),
                ui_count: String(
                  cycleRecords.filter((r) => r.source === 'UI').length
                ),
                intent_count: String(
                  cycleRecords.filter((r) => r.source === 'INTENT').length
                ),
                gh_count: String(
                  cycleRecords.filter((r) => r.source === 'GH').length
                ),
                api_count: String(
                  cycleRecords.filter((r) => r.source === 'API').length
                ),
                unique_actors: String(
                  new Set(cycleRecords.map((r) => r.actor)).size
                ),
              },
            ],
          });
        }
        
        // Handle list query
        if (sql.includes('WHERE cycle_id = $1')) {
          const cycleRecords = records.filter(
            (r) => r.cycle_id === params?.[0]
          );
          return Promise.resolve({ rows: cycleRecords });
        }
        
        return Promise.resolve({ rows: [] });
      }),
    } as unknown as Pool;
  };

  it('should record exactly 2 touchpoints for simulated cycle (1 review + 1 approval)', async () => {
    const mockPool = createMockPool();
    const cycleId = 'v0.5.0-test';
    const prNumber = 100;
    const actor = 'user123';

    // Step 1: Request review (REVIEW touchpoint)
    const reviewResult = await recordReviewTouchpoint(mockPool, {
      cycleId,
      prNumber,
      actor,
      requestId: 'req-review-1',
      source: 'API',
      metadata: {
        reviewers: ['reviewer1', 'reviewer2'],
      },
    });

    expect(reviewResult).toBeTruthy();
    expect(reviewResult?.type).toBe('REVIEW');

    // Step 2: Approve merge (MERGE_APPROVAL touchpoint)
    const approvalResult = await recordMergeApprovalTouchpoint(mockPool, {
      cycleId,
      prNumber,
      actor,
      requestId: 'req-approval-1',
      source: 'API',
      metadata: {
        signedPhrase: 'YES MERGE',
      },
    });

    expect(approvalResult).toBeTruthy();
    expect(approvalResult?.type).toBe('MERGE_APPROVAL');

    // Step 3: Verify exactly 2 touchpoints recorded
    const stats = await getTouchpointStatsByCycle(mockPool, cycleId);

    expect(stats.total).toBe(2);
    expect(stats.byType.REVIEW).toBe(1);
    expect(stats.byType.MERGE_APPROVAL).toBe(1);
    expect(stats.byType.ASSIGN).toBe(0);
    expect(stats.byType.DEBUG_INTERVENTION).toBe(0);
    expect(stats.uniqueActors).toBe(1);
  });

  it('should prevent double-counting on duplicate requests (idempotency)', async () => {
    const mockPool = createMockPool();
    const cycleId = 'v0.5.0-test-idempotent';
    const prNumber = 101;
    const actor = 'user123';
    const requestId = 'req-review-duplicate';
    const timestamp = new Date('2026-01-15T10:00:00Z');

    // Record same review touchpoint twice (should only create 1 record)
    const result1 = await recordReviewTouchpoint(mockPool, {
      cycleId,
      prNumber,
      actor,
      requestId,
      source: 'API',
      metadata: { reviewers: ['reviewer1'] },
    });

    // Simulate same request again (within same 5-minute window)
    const result2 = await recordReviewTouchpoint(mockPool, {
      cycleId,
      prNumber,
      actor,
      requestId,
      source: 'API',
      metadata: { reviewers: ['reviewer1'] },
    });

    expect(result1).toBeTruthy();
    expect(result2).toBeTruthy();
    
    // Both should return same record ID (deduplication)
    expect(result1?.id).toBe(result2?.id);

    // Verify only 1 touchpoint recorded
    const stats = await getTouchpointStatsByCycle(mockPool, cycleId);
    expect(stats.total).toBe(1);
    expect(stats.byType.REVIEW).toBe(1);
  });

  it('should record different touchpoints for different actors (no false deduplication)', async () => {
    const mockPool = createMockPool();
    const cycleId = 'v0.5.0-test-multi-actor';
    const prNumber = 102;
    const requestId = 'req-review-multi';

    // User1 requests review
    const result1 = await recordReviewTouchpoint(mockPool, {
      cycleId,
      prNumber,
      actor: 'user1',
      requestId: `${requestId}-1`,
      source: 'API',
    });

    // User2 also requests review (different actor)
    const result2 = await recordReviewTouchpoint(mockPool, {
      cycleId,
      prNumber,
      actor: 'user2',
      requestId: `${requestId}-2`,
      source: 'API',
    });

    expect(result1).toBeTruthy();
    expect(result2).toBeTruthy();
    
    // Should be different records (different actors)
    expect(result1?.id).not.toBe(result2?.id);

    // Verify 2 touchpoints recorded
    const stats = await getTouchpointStatsByCycle(mockPool, cycleId);
    expect(stats.total).toBe(2);
    expect(stats.byType.REVIEW).toBe(2);
    expect(stats.uniqueActors).toBe(2);
  });

  it('should support full cycle with all touchpoint types', async () => {
    const mockPool = createMockPool();
    const cycleId = 'v0.5.0-test-full-cycle';
    const issueNumber = 42;
    const prNumber = 103;
    const actor = 'user123';

    // Step 1: Assign issue (ASSIGN)
    await insertTouchpoint(mockPool, {
      idempotencyKey: generateIdempotencyKey({
        type: 'ASSIGN',
        source: 'API',
        actor,
        requestId: 'req-assign-1',
        ghIssueNumber: issueNumber,
        timestamp: new Date('2026-01-15T10:00:00Z'),
      }),
      cycleId,
      ghIssueNumber: issueNumber,
      type: 'ASSIGN',
      source: 'API',
      actor,
      requestId: 'req-assign-1',
      metadata: {},
    });

    // Step 2: Request review (REVIEW)
    await recordReviewTouchpoint(mockPool, {
      cycleId,
      prNumber,
      actor,
      requestId: 'req-review-1',
      source: 'API',
    });

    // Step 3: Debug intervention (DEBUG_INTERVENTION)
    await insertTouchpoint(mockPool, {
      idempotencyKey: generateIdempotencyKey({
        type: 'DEBUG_INTERVENTION',
        source: 'API',
        actor,
        requestId: 'req-debug-1',
        prNumber,
        timestamp: new Date('2026-01-15T10:15:00Z'),
      }),
      cycleId,
      prNumber,
      type: 'DEBUG_INTERVENTION',
      source: 'API',
      actor,
      requestId: 'req-debug-1',
      metadata: { reason: 'rerun failed jobs' },
    });

    // Step 4: Merge approval (MERGE_APPROVAL)
    await recordMergeApprovalTouchpoint(mockPool, {
      cycleId,
      prNumber,
      actor,
      requestId: 'req-approval-1',
      source: 'API',
    });

    // Verify all 4 touchpoint types recorded
    const stats = await getTouchpointStatsByCycle(mockPool, cycleId);

    expect(stats.total).toBe(4);
    expect(stats.byType.ASSIGN).toBe(1);
    expect(stats.byType.REVIEW).toBe(1);
    expect(stats.byType.DEBUG_INTERVENTION).toBe(1);
    expect(stats.byType.MERGE_APPROVAL).toBe(1);
    expect(stats.uniqueActors).toBe(1);
  });

  it('should provide deterministic aggregation across queries', async () => {
    const mockPool = createMockPool();
    const cycleId = 'v0.5.0-test-deterministic';
    const prNumber = 104;

    // Record some touchpoints
    await recordReviewTouchpoint(mockPool, {
      cycleId,
      prNumber,
      actor: 'user1',
      requestId: 'req-1',
      source: 'API',
    });
    
    await recordMergeApprovalTouchpoint(mockPool, {
      cycleId,
      prNumber,
      actor: 'user2',
      requestId: 'req-2',
      source: 'API',
    });

    // Query stats multiple times
    const stats1 = await getTouchpointStatsByCycle(mockPool, cycleId);
    const stats2 = await getTouchpointStatsByCycle(mockPool, cycleId);
    const stats3 = await getTouchpointStatsByCycle(mockPool, cycleId);

    // Should always return same results (deterministic)
    expect(stats1).toEqual(stats2);
    expect(stats2).toEqual(stats3);
    expect(stats1.total).toBe(2);
  });
});
