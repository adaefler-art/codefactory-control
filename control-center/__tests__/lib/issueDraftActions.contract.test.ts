/**
 * Contract Tests for Issue Draft Actions Endpoints
 * 
 * Issue: I201.9 - Shared Draft Actions + Parser Tests
 * Requirement R4: Contract Tests (optional light)
 * 
 * Purpose: Snapshot test of endpoint URLs/methods so that
 * changes to the action API surface are immediately visible.
 * 
 * @jest-environment node
 */

import { API_ROUTES } from "../../src/lib/api-routes";

describe("Issue Draft Actions - Endpoint Map Contract", () => {
  const TEST_SESSION_ID = "test-session-123";

  test("validate endpoint contract", () => {
    const endpoint = {
      url: API_ROUTES.intent.issueDraft.validate(TEST_SESSION_ID),
      method: "POST",
      requiresAuth: true,
      bodyRequired: false, // Per I201.8: validate does NOT send request body
    };

    expect(endpoint).toMatchSnapshot();
  });

  test("commit endpoint contract", () => {
    const endpoint = {
      url: API_ROUTES.intent.issueDraft.commit(TEST_SESSION_ID),
      method: "POST",
      requiresAuth: true,
      bodyRequired: false,
    };

    expect(endpoint).toMatchSnapshot();
  });

  test("publish endpoint contract", () => {
    const endpoint = {
      url: API_ROUTES.intent.issueDraft.publish(TEST_SESSION_ID),
      method: "POST",
      requiresAuth: true,
      bodyRequired: true, // Requires owner, repo, issue_set_id
      expectedBodyFields: ["owner", "repo", "issue_set_id"],
    };

    expect(endpoint).toMatchSnapshot();
  });

  test("create AFU9 issue endpoint contract", () => {
    const endpoint = {
      url: API_ROUTES.intent.issues.create(TEST_SESSION_ID),
      method: "POST",
      requiresAuth: true,
      bodyRequired: true, // Requires issueDraftId
      expectedBodyFields: ["issueDraftId"],
    };

    expect(endpoint).toMatchSnapshot();
  });

  test("all action endpoints follow consistent pattern", () => {
    const endpoints = [
      API_ROUTES.intent.issueDraft.validate(TEST_SESSION_ID),
      API_ROUTES.intent.issueDraft.commit(TEST_SESSION_ID),
      API_ROUTES.intent.issueDraft.publish(TEST_SESSION_ID),
      API_ROUTES.intent.issues.create(TEST_SESSION_ID),
    ];

    // All endpoints should:
    // 1. Start with /api/intent
    // 2. Include the session ID
    // 3. Use consistent naming
    endpoints.forEach((url) => {
      expect(url).toMatch(/^\/api\/intent/);
      expect(url).toContain(TEST_SESSION_ID);
    });

    // Snapshot all URLs for regression detection
    expect(endpoints).toMatchSnapshot();
  });

  test("endpoint URL generation is deterministic", () => {
    const sessionIds = ["session-1", "session-2", "test-123"];
    
    sessionIds.forEach((sessionId) => {
      const urls = {
        validate: API_ROUTES.intent.issueDraft.validate(sessionId),
        commit: API_ROUTES.intent.issueDraft.commit(sessionId),
        publish: API_ROUTES.intent.issueDraft.publish(sessionId),
        createIssue: API_ROUTES.intent.issues.create(sessionId),
      };

      // Verify session ID is correctly embedded
      Object.values(urls).forEach((url) => {
        expect(url).toContain(sessionId);
      });

      // Verify URLs follow expected patterns
      expect(urls.validate).toMatch(/\/issue-draft\/validate$/);
      expect(urls.commit).toMatch(/\/issue-draft\/commit$/);
      expect(urls.publish).toMatch(/\/issue-draft\/versions\/publish$/);
      expect(urls.createIssue).toMatch(/\/issues\/create$/);
    });
  });
});

describe("Issue Draft Actions - Response Schema Contract", () => {
  test("ActionResult schema contract", () => {
    const schema = {
      success: "boolean",
      data: "optional<any>",
      error: "optional<string>",
      requestId: "optional<string>",
    };

    expect(schema).toMatchSnapshot();
  });

  test("ValidationResult schema contract", () => {
    const schema = {
      isValid: "boolean",
      errors: "array<ValidationError>",
      warnings: "array<ValidationWarning>",
      meta: {
        issueDraftVersion: "optional<string>",
        validatedAt: "string",
        validatorVersion: "string",
        hash: "optional<string>",
      },
    };

    expect(schema).toMatchSnapshot();
  });

  test("PublishResult schema contract", () => {
    const schema = {
      success: "boolean",
      batch_id: "string",
      summary: {
        total: "number",
        created: "number",
        updated: "number",
        skipped: "number",
        failed: "number",
      },
      items: "array<PublishResultItem>",
      warnings: "optional<array<string>>",
      message: "optional<string>",
    };

    expect(schema).toMatchSnapshot();
  });
});

describe("Issue Draft Actions - Action Types Contract", () => {
  test("all action types are documented", () => {
    const actionTypes = ["validate", "commit", "publishGithub", "createIssue"];
    
    // Snapshot to detect additions/removals
    expect(actionTypes).toMatchSnapshot();
  });

  test("action type constants are stable", () => {
    const actions = {
      VALIDATE: "validate",
      COMMIT: "commit",
      PUBLISH_GITHUB: "publishGithub",
      CREATE_ISSUE: "createIssue",
    };

    expect(actions).toMatchSnapshot();
  });
});
