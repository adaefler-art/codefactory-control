/**
 * Diagnostics System Tests
 * 
 * Tests the complete diagnostic pipeline for INTENT authoring incidents.
 * 
 * @jest-environment node
 */

import { diagnoseIncident, formatDiagnosticOutput } from '../../src/lib/diagnostics/diagnose';
import { validateEvidencePack, redactEvidencePack, safeValidateEvidencePack } from '../../src/lib/diagnostics/incidentSchema';
import { classifyIncident, ClassificationCode } from '../../src/lib/diagnostics/classifier';
import { runProofs, ProofStatus } from '../../src/lib/diagnostics/proofs';
import { getPlaybook } from '../../src/lib/diagnostics/playbooks';
import type { IncidentEvidencePack } from '../../src/lib/diagnostics/incidentSchema';

describe('Diagnostics System - AFU9-I-OPS-DBG-001', () => {
  
  /**
   * Test Evidence Pack for C1: Missing Read Path
   */
  const mockC1EvidencePack: IncidentEvidencePack = {
    schemaVersion: '1.0.0',
    incidentId: 'INC-2026-000001',
    createdAt: '2026-01-18T17:00:00.000Z',
    env: 'staging',
    deployedVersion: 'v0.5.0-abc123',
    sessionId: 'sess_test_c1_001',
    mode: 'DRAFTING',
    requestIds: ['req_001_draft_attempt', 'req_002_draft_attempt'],
    networkTraceSummary: {
      endpointPatterns: [
        {
          pattern: '/api/intent/sessions/:id/issue-draft',
          method: 'POST',
          statusCounts: { '200': 1 },
        },
      ],
    },
    apiSnippets: [
      {
        endpoint: '/api/intent/sessions/sess_test_c1_001/issue-draft',
        method: 'GET',
        status: 404,
        requestSnippet: {},
        responseSnippet: { error: 'Not Found' },
        timestamp: '2026-01-18T16:59:00.000Z',
      },
      {
        endpoint: '/api/intent/sessions/sess_test_c1_001/issue-draft',
        method: 'POST',
        status: 200,
        requestSnippet: { title: 'Test Issue' },
        responseSnippet: { status: 'NO_DRAFT' },
        timestamp: '2026-01-18T17:00:00.000Z',
      },
    ],
    serverLogRefs: [
      {
        requestId: 'req_001_draft_attempt',
        logLevel: 'ERROR',
        message: 'GET /api/intent/sessions/sess_test_c1_001/issue-draft returned 404',
        timestamp: '2026-01-18T16:59:00.000Z',
      },
    ],
    notes: 'INTENT UI shows NO DRAFT status but GET endpoint is missing. POST works but subsequent GET fails.',
  };

  describe('Evidence Pack Schema Validation', () => {
    test('should validate valid evidence pack', () => {
      expect(() => validateEvidencePack(mockC1EvidencePack)).not.toThrow();
    });

    test('should reject invalid evidence pack - missing required fields', () => {
      const invalid = { schemaVersion: '1.0.0' };
      expect(() => validateEvidencePack(invalid)).toThrow();
    });

    test('should reject invalid incident ID format', () => {
      const invalid = {
        ...mockC1EvidencePack,
        incidentId: 'INVALID-ID',
      };
      expect(() => validateEvidencePack(invalid)).toThrow();
    });

    test('should validate with safeValidateEvidencePack', () => {
      const result = safeValidateEvidencePack(mockC1EvidencePack);
      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.error).toBeUndefined();
    });

    test('should return error with safeValidateEvidencePack for invalid data', () => {
      const result = safeValidateEvidencePack({ invalid: true });
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.data).toBeUndefined();
    });
  });

  describe('Redaction', () => {
    test('should redact authorization headers from request snippets', () => {
      const packWithSecrets: IncidentEvidencePack = {
        ...mockC1EvidencePack,
        apiSnippets: [
          {
            endpoint: '/api/test',
            method: 'GET',
            status: 200,
            requestSnippet: {
              authorization: 'Bearer secret-token',
              Authorization: 'Bearer another-token',
              cookie: 'session=xyz',
              Cookie: 'auth=abc',
              data: 'safe-data',
            },
            responseSnippet: {},
          },
        ],
      };

      const redacted = redactEvidencePack(packWithSecrets);
      const snippet = redacted.apiSnippets![0];
      
      expect(snippet.requestSnippet).toBeDefined();
      expect(snippet.requestSnippet!.authorization).toBeUndefined();
      expect(snippet.requestSnippet!.Authorization).toBeUndefined();
      expect(snippet.requestSnippet!.cookie).toBeUndefined();
      expect(snippet.requestSnippet!.Cookie).toBeUndefined();
      expect(snippet.requestSnippet!.data).toBe('safe-data');
    });

    test('should redact tokens from response snippets', () => {
      const packWithSecrets: IncidentEvidencePack = {
        ...mockC1EvidencePack,
        apiSnippets: [
          {
            endpoint: '/api/test',
            method: 'GET',
            status: 200,
            requestSnippet: {},
            responseSnippet: {
              token: 'secret-token',
              apiKey: 'secret-key',
              sessionToken: 'session-xyz',
              safeData: 'visible',
            },
          },
        ],
      };

      const redacted = redactEvidencePack(packWithSecrets);
      const snippet = redacted.apiSnippets![0];
      
      expect(snippet.responseSnippet).toBeDefined();
      expect(snippet.responseSnippet!.token).toBeUndefined();
      expect(snippet.responseSnippet!.apiKey).toBeUndefined();
      expect(snippet.responseSnippet!.sessionToken).toBeUndefined();
      expect(snippet.responseSnippet!.safeData).toBe('visible');
    });
  });

  describe('Classification - C1 Missing Read Path', () => {
    test('should classify C1 incident correctly', () => {
      const classification = classifyIncident(mockC1EvidencePack);
      
      expect(classification.code).toBe(ClassificationCode.C1_MISSING_READ_PATH);
      expect(classification.title).toBe('Missing GET Endpoint for Issue Draft');
      expect(classification.confidence).toBeGreaterThanOrEqual(0.9);
      expect(classification.matchedRules).toContain('GET_404_POST_SUCCESS');
      expect(classification.requiredProofs).toContain('PROOF_GET_404');
      expect(classification.requiredProofs).toContain('PROOF_POST_SUCCESS');
    });

    test('should return deterministic classification for same input', () => {
      const classification1 = classifyIncident(mockC1EvidencePack);
      const classification2 = classifyIncident(mockC1EvidencePack);
      
      expect(classification1.code).toBe(classification2.code);
      expect(classification1.confidence).toBe(classification2.confidence);
      expect(classification1.matchedRules).toEqual(classification2.matchedRules);
    });
  });

  describe('Proof Runner', () => {
    test('should run required proofs for C1 classification', () => {
      const requiredProofs = ['PROOF_GET_404', 'PROOF_POST_SUCCESS'];
      const proofs = runProofs(mockC1EvidencePack, requiredProofs);
      
      expect(proofs.proofs).toHaveLength(2);
      expect(proofs.summary.total).toBe(2);
      
      // Find specific proofs
      const get404Proof = proofs.proofs.find(p => p.id === 'PROOF_GET_404');
      const postSuccessProof = proofs.proofs.find(p => p.id === 'PROOF_POST_SUCCESS');
      
      expect(get404Proof).toBeDefined();
      expect(get404Proof!.status).toBe(ProofStatus.PASS);
      expect(get404Proof!.evidenceRefs.length).toBeGreaterThan(0);
      
      expect(postSuccessProof).toBeDefined();
      expect(postSuccessProof!.status).toBe(ProofStatus.PASS);
      expect(postSuccessProof!.evidenceRefs.length).toBeGreaterThan(0);
    });

    test('should provide summary with pass/fail counts', () => {
      const requiredProofs = ['PROOF_GET_404', 'PROOF_POST_SUCCESS'];
      const proofs = runProofs(mockC1EvidencePack, requiredProofs);
      
      expect(proofs.summary.total).toBe(2);
      expect(proofs.summary.passed).toBe(2);
      expect(proofs.summary.failed).toBe(0);
      expect(proofs.summary.insufficient).toBe(0);
    });

    test('should handle unknown proof gracefully', () => {
      const proofs = runProofs(mockC1EvidencePack, ['UNKNOWN_PROOF']);
      
      expect(proofs.proofs).toHaveLength(1);
      expect(proofs.proofs[0].id).toBe('UNKNOWN_PROOF');
      expect(proofs.proofs[0].status).toBe(ProofStatus.INSUFFICIENT_DATA);
    });
  });

  describe('Playbook Registry', () => {
    test('should return C1 playbook with complete implementation', () => {
      const playbook = getPlaybook(ClassificationCode.C1_MISSING_READ_PATH);
      
      expect(playbook.id).toBe('PB-C1-MISSING-READ-PATH');
      expect(playbook.classificationCode).toBe(ClassificationCode.C1_MISSING_READ_PATH);
      expect(playbook.patchPlan.length).toBeGreaterThan(0);
      expect(playbook.verificationChecks.length).toBeGreaterThan(0);
      expect(playbook.copilotPrompt).toBeTruthy();
      expect(playbook.copilotPrompt.length).toBeGreaterThan(100); // Substantial prompt
    });

    test('should include high priority patch for C1', () => {
      const playbook = getPlaybook(ClassificationCode.C1_MISSING_READ_PATH);
      
      const highPriorityPatch = playbook.patchPlan.find(p => p.priority === 'HIGH');
      expect(highPriorityPatch).toBeDefined();
      expect(highPriorityPatch!.file).toContain('route.ts');
    });

    test('should include verification checks for C1', () => {
      const playbook = getPlaybook(ClassificationCode.C1_MISSING_READ_PATH);
      
      expect(playbook.verificationChecks).toContainEqual(
        expect.objectContaining({
          id: expect.stringContaining('V1'),
          type: 'API',
        })
      );
    });
  });

  describe('Complete Diagnostic Pipeline', () => {
    test('should run complete diagnostic for C1 incident', () => {
      const result = diagnoseIncident(mockC1EvidencePack);
      
      // Check basic structure
      expect(result.incidentId).toBe('INC-2026-000001');
      expect(result.timestamp).toBeTruthy();
      expect(result.classification).toBeDefined();
      expect(result.proofs).toBeDefined();
      expect(result.nextAction).toBeDefined();
      expect(result.playbook).toBeDefined();
      
      // Check classification
      expect(result.classification.code).toBe(ClassificationCode.C1_MISSING_READ_PATH);
      expect(result.confidence).toBeGreaterThanOrEqual(0.9);
      
      // Check proofs
      expect(result.proofs.proofs.length).toBeGreaterThan(0);
      expect(result.proofs.summary.passed).toBeGreaterThan(0);
      
      // Check next action
      expect(result.nextAction.playbookId).toBe('PB-C1-MISSING-READ-PATH');
      expect(result.nextAction.copilotPrompt).toBeTruthy();
      expect(['PATCH', 'INVESTIGATE', 'ESCALATE']).toContain(result.nextAction.type);
      
      // Check playbook
      expect(result.playbook.id).toBe('PB-C1-MISSING-READ-PATH');
    });

    test('should produce deterministic output (stable ordering)', () => {
      const result1 = diagnoseIncident(mockC1EvidencePack);
      const result2 = diagnoseIncident(mockC1EvidencePack);
      
      // Classification should be identical
      expect(result1.classification.code).toBe(result2.classification.code);
      expect(result1.classification.confidence).toBe(result2.classification.confidence);
      
      // Matched rules should be sorted and identical
      expect(result1.classification.matchedRules).toEqual(result2.classification.matchedRules);
      
      // Proofs should be sorted by ID
      const proofIds1 = result1.proofs.proofs.map(p => p.id);
      const proofIds2 = result2.proofs.proofs.map(p => p.id);
      expect(proofIds1).toEqual(proofIds2);
      
      // Check proofs are sorted
      for (let i = 1; i < proofIds1.length; i++) {
        expect(proofIds1[i]).toBeGreaterThan(proofIds1[i - 1]);
      }
    });

    test('should format output as valid JSON', () => {
      const result = diagnoseIncident(mockC1EvidencePack);
      const formatted = formatDiagnosticOutput(result);
      
      expect(() => JSON.parse(formatted)).not.toThrow();
      
      const parsed = JSON.parse(formatted);
      expect(parsed.incidentId).toBe('INC-2026-000001');
      expect(parsed.classification.code).toBe('C1_MISSING_READ_PATH');
    });

    test('should not emit secrets in output', () => {
      const packWithSecrets: IncidentEvidencePack = {
        ...mockC1EvidencePack,
        apiSnippets: [
          {
            endpoint: '/api/test',
            method: 'GET',
            status: 404,
            requestSnippet: {
              authorization: 'Bearer secret-token',
              data: 'visible',
            },
            responseSnippet: {
              token: 'secret-token',
            },
          },
        ],
      };

      const result = diagnoseIncident(packWithSecrets);
      const formatted = formatDiagnosticOutput(result);
      
      // Should not contain any secrets
      expect(formatted).not.toContain('secret-token');
      expect(formatted).not.toContain('Bearer');
      
      // Should contain visible data
      expect(formatted).toContain('visible');
    });
  });

  describe('Edge Cases', () => {
    test('should handle evidence pack with no API snippets', () => {
      const minimalPack: IncidentEvidencePack = {
        schemaVersion: '1.0.0',
        incidentId: 'INC-2026-000002',
        createdAt: '2026-01-18T17:00:00.000Z',
        env: 'development',
        sessionId: 'sess_minimal',
        mode: 'DISCUSS',
      };

      const result = diagnoseIncident(minimalPack);
      expect(result.classification).toBeDefined();
      expect(result.proofs).toBeDefined();
    });

    test('should handle evidence pack with empty arrays', () => {
      const emptyPack: IncidentEvidencePack = {
        ...mockC1EvidencePack,
        requestIds: [],
        apiSnippets: [],
        serverLogRefs: [],
      };

      const result = diagnoseIncident(emptyPack);
      expect(result.classification).toBeDefined();
    });
  });
});
