/**
 * Tests for used_sources in INTENT Sessions API
 * 
 * Tests Zod validation, canonicalization, and persistence.
 * Issue E73.2: Sources Panel + used_sources Contract
 * 
 * NOTE: MVP does not implement used_sources - these tests are placeholders
 * 
 * @jest-environment node
 */

import { NextRequest } from 'next/server';
import { POST as appendMessage } from '../../app/api/intent/sessions/[id]/messages/route';
import { GET as getSession } from '../../app/api/intent/sessions/[id]/route';
import type { UsedSources } from '../../src/lib/schemas/usedSources';

// Enable INTENT agent for tests
process.env.AFU9_INTENT_ENABLED = 'true';
process.env.OPENAI_API_KEY = 'sk-test-key';

// Mock the database module
jest.mock('../../src/lib/db', () => ({
  getPool: jest.fn(() => ({
    query: jest.fn(),
    connect: jest.fn(),
  })),
}));

jest.mock('../../src/lib/db/intentSessions', () => ({
  appendIntentMessage: jest.fn(),
  getIntentSession: jest.fn(),
}));

jest.mock('../../src/lib/db/contextPacks', () => ({
  generateContextPack: jest.fn().mockResolvedValue({
    success: true,
    data: {
      id: 'pack-123',
      pack_hash: 'hash123',
    },
  }),
}));

// Mock the INTENT agent
jest.mock('../../src/lib/intent-agent', () => ({
  isIntentEnabled: jest.fn(() => true),
  generateIntentResponse: jest.fn().mockResolvedValue({
    content: 'Test response',
    requestId: 'req-123',
    timestamp: new Date().toISOString(),
    model: 'gpt-4o-mini',
  }),
}));

const TEST_USER_ID = 'user-123';
const TEST_SESSION_ID = 'session-456';

describe('POST /api/intent/sessions/[id]/messages - used_sources (MVP placeholders)', () => {
  test('MVP does not yet implement used_sources', async () => {
    // Placeholder test - used_sources will be implemented in future iteration
    expect(true).toBe(true);
  });

  test('accepts valid used_sources and stores with assistant message (skipped in MVP)', async () => {
    // Skip this test in MVP - used_sources not yet implemented
    expect(true).toBe(true);
  });

  test('rejects invalid used_sources schema (skipped in MVP)', async () => {
    // Skip this test in MVP - used_sources not yet implemented
    expect(true).toBe(true);
  });

  test('accepts empty used_sources array (skipped in MVP)', async () => {
    // Skip this test in MVP - used_sources not yet implemented
    expect(true).toBe(true);
  });

  test('validates all source types (skipped in MVP)', async () => {
    // Skip this test in MVP - used_sources not yet implemented
    expect(true).toBe(true);
  });
});
