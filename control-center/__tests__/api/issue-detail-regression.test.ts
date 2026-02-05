/**
 * Regression Test: Issue Detail API UUID Read Bug
 * 
 * This test verifies the fix for the bug where freshly created issues
 * could not be read via the detail API endpoint.
 * 
 * Bug: Next.js 15+ changed params to be async (Promise), but the issue
 * detail API routes were not awaiting params, causing UUID lookup to fail.
 * 
 * Fix: Added `await` to params destructuring in all issue API routes.
 * 
 * @see https://github.com/adaefler-art/codefactory-control/issues/XXX
 * @jest-environment node
 */

import { NextRequest } from 'next/server';
import { GET as getIssue } from '../../app/api/issues/[id]/route';
import { POST as createIssue } from '../../app/api/issues/route';
import { Afu9IssueStatus } from '../../src/lib/contracts/afu9Issue';

// Mock the database module
jest.mock('../../src/lib/db', () => ({
  getPool: jest.fn(() => ({
    query: jest.fn(),
  })),
}));

// Mock database helpers
jest.mock('../../src/lib/db/afu9Issues', () => ({
  createAfu9Issue: jest.fn(),
  getAfu9IssueById: jest.fn(),
  getAfu9IssueByPublicId: jest.fn(),
}));

describe('Regression: Issue Detail API UUID Read', () => {
  const mockIssueUuid = 'fce7e268-7778-4fec-ba91-3e6477933cc6';
  const mockIssue = {
    id: mockIssueUuid,
    title: 'Test Issue - Freshly Created',
    body: 'This issue should be readable immediately after creation',
    status: Afu9IssueStatus.CREATED,
    labels: ['bug', 'regression-test'],
    priority: null,
    assignee: null,
    source: 'afu9',
    handoff_state: 'NOT_SENT',
    github_issue_number: null,
    github_url: null,
    last_error: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    activated_at: null,
    execution_state: 'IDLE',
    execution_started_at: null,
    execution_completed_at: null,
    execution_output: null,
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('freshly created issue should be immediately readable by UUID', async () => {
    const { createAfu9Issue, getAfu9IssueById } = require('../../src/lib/db/afu9Issues');
    
    // Step 1: Create the issue
    createAfu9Issue.mockResolvedValue({
      success: true,
      data: mockIssue,
    });

    const createRequest = new NextRequest('http://localhost/api/issues', {
      method: 'POST',
      body: JSON.stringify({
        title: 'Test Issue - Freshly Created',
        body: 'This issue should be readable immediately after creation',
        labels: ['bug', 'regression-test'],
      }),
    });

    const createResponse = await createIssue(createRequest);
    expect(createResponse.status).toBe(201);
    
    const createdIssue = await createResponse.json();
    expect(createdIssue.id).toBe(mockIssueUuid);

    // Step 2: Immediately try to read the issue by its UUID
    getAfu9IssueById.mockResolvedValue({
      success: true,
      data: mockIssue,
    });

    const getRequest = new NextRequest(`http://localhost/api/issues/${mockIssueUuid}`);
    const getResponse = await getIssue(getRequest, {
      params: Promise.resolve({ id: mockIssueUuid }),
    });

    // Step 3: Verify the issue can be read successfully
    expect(getResponse.status).toBe(200);
    
    const retrievedIssue = await getResponse.json();
    expect(retrievedIssue.id).toBe(mockIssueUuid);
    expect(retrievedIssue.title).toBe('Test Issue - Freshly Created');
    
    // Verify the database was queried with the correct UUID
    expect(getAfu9IssueById).toHaveBeenCalledWith(
      expect.anything(),
      mockIssueUuid
    );
  });

  test('issue should be readable by publicId (8-hex prefix)', async () => {
    const { getAfu9IssueByPublicId } = require('../../src/lib/db/afu9Issues');
    
    const publicId = mockIssueUuid.substring(0, 8); // 'fce7e268'
    
    getAfu9IssueByPublicId.mockResolvedValue({
      success: true,
      data: mockIssue,
    });

    const request = new NextRequest(`http://localhost/api/issues/${publicId}`);
    const response = await getIssue(request, {
      params: Promise.resolve({ id: publicId }),
    });

    expect(response.status).toBe(200);
    
    const retrievedIssue = await response.json();
    expect(retrievedIssue.id).toBe(mockIssueUuid);
    expect(retrievedIssue.publicId).toBe(publicId);
    
    // Verify the database was queried with the correct publicId
    expect(getAfu9IssueByPublicId).toHaveBeenCalledWith(
      expect.anything(),
      publicId
    );
  });

  test('should return 404 for non-existent UUID', async () => {
    const { getAfu9IssueById } = require('../../src/lib/db/afu9Issues');
    
    const nonExistentUuid = '00000000-0000-0000-0000-000000000000';
    
    getAfu9IssueById.mockResolvedValue({
      success: false,
      error: 'Issue not found',
    });

    process.env.ENGINE_BASE_URL = 'https://engine.example.com';
    process.env.ENGINE_SERVICE_TOKEN = 'engine-token';

    const fetchMock = jest.spyOn(global, 'fetch' as any).mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({}),
    } as any);

    const request = new NextRequest(`http://localhost/api/issues/${nonExistentUuid}`);
    const response = await getIssue(request, {
      params: Promise.resolve({ id: nonExistentUuid }),
    });

    expect(response.status).toBe(404);
    
    const body = await response.json();
    expect(body).toMatchObject({
      errorCode: 'issue_not_found',
      issueId: nonExistentUuid,
      lookupStore: 'control',
    });

    fetchMock.mockRestore();
    delete process.env.ENGINE_BASE_URL;
    delete process.env.ENGINE_SERVICE_TOKEN;
  });

  test('should return 400 for invalid UUID format', async () => {
    const invalidId = 'not-a-valid-uuid-or-publicid';

    const request = new NextRequest(`http://localhost/api/issues/${invalidId}`);
    const response = await getIssue(request, {
      params: Promise.resolve({ id: invalidId }),
    });

    expect(response.status).toBe(400);
    
    const body = await response.json();
    expect(body.error).toContain('Invalid issue ID format');
  });

  test('params must be awaited to access id property', async () => {
    // This test documents the bug that was fixed
    // Without await, params is a Promise object, not the actual value
    
    const asyncParams = Promise.resolve({ id: mockIssueUuid });
    
    // Wrong way (the bug):
    // const { id } = asyncParams;
    // console.log(id); // undefined - because we're trying to destructure a Promise
    
    // Correct way (the fix):
    const { id } = await asyncParams;
    expect(id).toBe(mockIssueUuid);
    expect(typeof id).toBe('string');
  });
});
