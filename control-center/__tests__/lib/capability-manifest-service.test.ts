/**
 * Capability Manifest Service Tests (E86.2)
 * 
 * Tests for capability manifest generation:
 * - Deterministic hash generation
 * - Stable sorting
 * - Source aggregation
 * - Constraint extraction
 * 
 * @jest-environment node
 */

import { buildCapabilityManifest, type CapabilityManifest } from '../../src/lib/capability-manifest-service';
import { listIntentToolSpecs } from '../../src/lib/intent-tool-registry';
import * as mcpCatalog from '../../src/lib/mcp-catalog';
import * as lawbook from '../../src/lib/db/lawbook';

// Mock dependencies
jest.mock('../../src/lib/mcp-catalog');
jest.mock('../../src/lib/db/lawbook');

const TEST_USER_ID = 'test-user-123';
const TEST_SESSION_ID = 'test-session-456';

const mockMcpCatalog = mcpCatalog as jest.Mocked<typeof mcpCatalog>;
const mockLawbook = lawbook as jest.Mocked<typeof lawbook>;

describe('Capability Manifest Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    // Mock MCP catalog
    mockMcpCatalog.getMCPServersFromCatalog.mockReturnValue([
      {
        name: 'github',
        displayName: 'GitHub',
        contractVersion: '0.6.0',
        port: 3001,
        endpoint: 'http://localhost:3001',
        tools: [
          {
            name: 'get_repo',
            description: 'Get repository information',
            contractVersion: '0.6.0',
          },
          {
            name: 'create_issue',
            description: 'Create GitHub issue',
            contractVersion: '0.6.0',
          },
        ],
      },
      {
        name: 'deploy',
        displayName: 'Deploy',
        contractVersion: '0.6.0',
        port: 3002,
        endpoint: 'http://localhost:3002',
        tools: [
          {
            name: 'deploy_service',
            description: 'Deploy ECS service',
            contractVersion: '0.6.0',
          },
        ],
      },
    ]);

    // Mock lawbook - no active lawbook by default
    mockLawbook.getActiveLawbook.mockResolvedValue({
      success: false,
      error: 'No active lawbook',
      notConfigured: true,
    });
  });

  describe('buildCapabilityManifest', () => {
    test('generates deterministic manifest', async () => {
      const manifest1 = await buildCapabilityManifest({
        userId: TEST_USER_ID,
        sessionId: TEST_SESSION_ID,
      });

      const manifest2 = await buildCapabilityManifest({
        userId: TEST_USER_ID,
        sessionId: TEST_SESSION_ID,
      });

      // Same inputs should produce identical manifests
      expect(manifest1.hash).toBe(manifest2.hash);
      expect(manifest1.capabilities).toEqual(manifest2.capabilities);
    });

    test('includes capabilities from all sources', async () => {
      const manifest = await buildCapabilityManifest({
        userId: TEST_USER_ID,
        sessionId: TEST_SESSION_ID,
      });

      // Should have INTENT tools
      expect(manifest.sources.intentTools).toBeGreaterThan(0);

      // Should have MCP tools (2 from github + 1 from deploy = 3)
      expect(manifest.sources.mcpTools).toBe(3);

      // Should have feature flags
      expect(manifest.sources.featureFlags).toBeGreaterThan(0);

      // Should have 0 lawbook constraints (mocked as not configured)
      expect(manifest.sources.lawbookConstraints).toBe(0);
    });

    test('sorts capabilities stably by id', async () => {
      const manifest = await buildCapabilityManifest({
        userId: TEST_USER_ID,
        sessionId: TEST_SESSION_ID,
      });

      // Verify capabilities are sorted by id
      const ids = manifest.capabilities.map(c => c.id);
      const sortedIds = [...ids].sort((a, b) => a.localeCompare(b));

      expect(ids).toEqual(sortedIds);
    });

    test('extracts INTENT tool capabilities', async () => {
      const manifest = await buildCapabilityManifest({
        userId: TEST_USER_ID,
        sessionId: TEST_SESSION_ID,
      });

      // Find INTENT tools in manifest
      const intentTools = manifest.capabilities.filter(c => c.source === 'intent_registry');

      // Should match listIntentToolSpecs
      const expectedTools = listIntentToolSpecs();
      expect(intentTools.length).toBe(expectedTools.length);

      // Check a known tool
      const getContextPack = intentTools.find(t => t.id === 'get_context_pack');
      expect(getContextPack).toBeDefined();
      expect(getContextPack?.kind).toBe('tool');
      expect(getContextPack?.source).toBe('intent_registry');
      expect(getContextPack?.description).toContain('Context Pack');
    });

    test('extracts MCP tool capabilities', async () => {
      const manifest = await buildCapabilityManifest({
        userId: TEST_USER_ID,
        sessionId: TEST_SESSION_ID,
      });

      // Find MCP tools in manifest
      const mcpTools = manifest.capabilities.filter(c => c.source === 'mcp');

      // Should have 3 tools (2 from github, 1 from deploy)
      expect(mcpTools.length).toBe(3);

      // Check github tools
      const githubGetRepo = mcpTools.find(t => t.id === 'github.get_repo');
      expect(githubGetRepo).toBeDefined();
      expect(githubGetRepo?.kind).toBe('mcp_tool');
      expect(githubGetRepo?.metadata?.server).toBe('github');

      const githubCreateIssue = mcpTools.find(t => t.id === 'github.create_issue');
      expect(githubCreateIssue).toBeDefined();
      expect(githubCreateIssue?.metadata?.server).toBe('github');

      // Check deploy tool
      const deployService = mcpTools.find(t => t.id === 'deploy.deploy_service');
      expect(deployService).toBeDefined();
      expect(deployService?.metadata?.server).toBe('deploy');
    });

    test('extracts feature flag capabilities', async () => {
      const manifest = await buildCapabilityManifest({
        userId: TEST_USER_ID,
        sessionId: TEST_SESSION_ID,
      });

      // Find feature flags in manifest
      const featureFlags = manifest.capabilities.filter(c => c.source === 'flags');

      // Should have all flags from FLAGS_CATALOG
      expect(featureFlags.length).toBeGreaterThan(0);

      // All feature flags should be read-only
      featureFlags.forEach(flag => {
        expect(flag.constraints).toContain('read_only');
      });

      // Check a known flag
      const githubAppId = featureFlags.find(f => f.id === 'GITHUB_APP_ID');
      expect(githubAppId).toBeDefined();
      expect(githubAppId?.kind).toBe('feature_flag');
      expect(githubAppId?.metadata?.required).toBe(true);
    });

    test('extracts lawbook constraints when available', async () => {
      // Mock active lawbook
      mockLawbook.getActiveLawbook.mockResolvedValue({
        success: true,
        data: {
          id: 'lawbook-1',
          lawbook_id: 'AFU9-LAWBOOK',
          lawbook_version: '2026-01-14.1',
          created_at: '2026-01-14T00:00:00Z',
          created_by: 'system',
          lawbook_json: {
            version: '0.7.0',
            lawbookId: 'AFU9-LAWBOOK',
            lawbookVersion: '2026-01-14.1',
            remediation: {
              enabled: true,
              allowedPlaybooks: ['SAFE_RETRY_RUNNER'],
              allowedActions: ['runner_dispatch'],
              maxRunsPerIncident: 5,
              cooldownMinutes: 30,
            },
            execution: {
              allowAutoAssign: true,
              allowManualDispatch: true,
            },
            quality: {
              allowPartialSuccess: false,
              requireApproval: true,
            },
          },
          lawbook_hash: 'sha256:test',
          schema_version: '0.7.0',
        },
      });

      const manifest = await buildCapabilityManifest({
        userId: TEST_USER_ID,
        sessionId: TEST_SESSION_ID,
      });

      // Should have lawbook constraints
      expect(manifest.sources.lawbookConstraints).toBeGreaterThan(0);

      // Check remediation constraint
      const remediation = manifest.capabilities.find(c => c.id === 'lawbook.remediation');
      expect(remediation).toBeDefined();
      expect(remediation?.kind).toBe('constraint');
      expect(remediation?.source).toBe('lawbook');
      expect(remediation?.metadata?.allowedPlaybooks).toEqual(['SAFE_RETRY_RUNNER']);
      expect(remediation?.metadata?.maxRunsPerIncident).toBe(5);

      // Check execution constraint
      const execution = manifest.capabilities.find(c => c.id === 'lawbook.execution');
      expect(execution).toBeDefined();
      expect(execution?.metadata?.allowAutoAssign).toBe(true);

      // Check quality constraint
      const quality = manifest.capabilities.find(c => c.id === 'lawbook.quality');
      expect(quality).toBeDefined();
      expect(quality?.metadata?.requireApproval).toBe(true);
    });

    test('handles lawbook errors gracefully', async () => {
      // Mock lawbook error
      mockLawbook.getActiveLawbook.mockRejectedValue(new Error('Database error'));

      // Should not throw, should continue without lawbook constraints
      const manifest = await buildCapabilityManifest({
        userId: TEST_USER_ID,
        sessionId: TEST_SESSION_ID,
      });

      expect(manifest.sources.lawbookConstraints).toBe(0);
      expect(manifest.capabilities.length).toBeGreaterThan(0); // Still has other capabilities
    });

    test('hash changes when capabilities change', async () => {
      const manifest1 = await buildCapabilityManifest({
        userId: TEST_USER_ID,
        sessionId: TEST_SESSION_ID,
      });

      // Change MCP catalog
      mockMcpCatalog.getMCPServersFromCatalog.mockReturnValue([
        {
          name: 'github',
          displayName: 'GitHub',
          contractVersion: '0.6.0',
          port: 3001,
          endpoint: 'http://localhost:3001',
          tools: [
            {
              name: 'get_repo',
              description: 'Get repository information',
              contractVersion: '0.6.0',
            },
            // Removed create_issue tool
          ],
        },
      ]);

      const manifest2 = await buildCapabilityManifest({
        userId: TEST_USER_ID,
        sessionId: TEST_SESSION_ID,
      });

      // Hash should be different
      expect(manifest2.hash).not.toBe(manifest1.hash);
    });

    test('includes version in YYYY-MM-DD format', async () => {
      const manifest = await buildCapabilityManifest({
        userId: TEST_USER_ID,
        sessionId: TEST_SESSION_ID,
      });

      // Should be ISO date format (YYYY-MM-DD)
      expect(manifest.version).toMatch(/^\d{4}-\d{2}-\d{2}$/);

      // Should be today's date
      const today = new Date().toISOString().split('T')[0];
      expect(manifest.version).toBe(today);
    });

    test('hash is sha256 prefixed', async () => {
      const manifest = await buildCapabilityManifest({
        userId: TEST_USER_ID,
        sessionId: TEST_SESSION_ID,
      });

      // Hash should start with "sha256:"
      expect(manifest.hash).toMatch(/^sha256:[0-9a-f]{64}$/);
    });
  });
});
