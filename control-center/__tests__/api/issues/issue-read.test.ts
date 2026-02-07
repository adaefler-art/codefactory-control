/**
 * Unit Tests: Issue Read Handler
 *
 * @jest-environment node
 */

import { NextRequest } from "next/server";
import { GET } from "../../../app/api/issues/[id]/route";
import { ensureIssueInControl, normalizeIssueForApi } from "../../../app/api/issues/_shared";
import { buildContextTrace, isDebugApiEnabled } from "../../../src/lib/api/context-trace";

jest.mock("../../../app/api/issues/_shared", () => {
  const actual = jest.requireActual("../../../app/api/issues/_shared");
  return {
    ...actual,
    ensureIssueInControl: jest.fn(),
    normalizeIssueForApi: jest.fn(),
    extractServiceTokenFromHeaders: jest.fn(() => ({ reason: "missing" })),
    normalizeServiceToken: jest.fn((value: unknown) => String(value ?? "").trim()),
    tokensEqual: jest.fn(() => true),
    getServiceTokenDebugInfo: jest.fn(() => ({})),
  };
});

jest.mock("../../../src/lib/api/context-trace", () => ({
  buildContextTrace: jest.fn(),
  isDebugApiEnabled: jest.fn(() => false),
}));

describe("GET /api/issues/[id] error mapping", () => {
  const mockEnsure = ensureIssueInControl as jest.Mock;
  const mockNormalize = normalizeIssueForApi as jest.Mock;
  const mockBuildTrace = buildContextTrace as jest.Mock;
  const mockDebugEnabled = isDebugApiEnabled as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    mockDebugEnabled.mockReturnValue(false);
  });

  it("maps store read failures to ISSUE_STORE_READ_FAILED", async () => {
    mockEnsure.mockResolvedValue({
      ok: false,
      status: 500,
      body: { error: "Failed to fetch issue" },
    });

    const request = new NextRequest("http://localhost/api/issues/issue-1", {
      headers: {
        "x-request-id": "req-1",
        "x-afu9-sub": "user-1",
      },
    });

    const response = await GET(request, { params: Promise.resolve({ id: "issue-1" }) });

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      code: "ISSUE_STORE_READ_FAILED",
      requestId: "req-1",
    });
    expect(response.headers.get("x-afu9-error-code")).toBe("ISSUE_STORE_READ_FAILED");
    expect(response.headers.get("x-afu9-handler")).toBe("control-center.issue-read");
    expect(response.headers.get("x-afu9-request-id")).toBe("req-1");
  });

  it("maps invalid stored state to INVALID_STORED_STATE", async () => {
    mockEnsure.mockResolvedValue({
      ok: true,
      issue: { id: "issue-2" },
      source: "control",
    });
    mockNormalize.mockImplementation(() => {
      throw new Error("Afu9IssueOutput contract validation failed");
    });

    const request = new NextRequest("http://localhost/api/issues/issue-2", {
      headers: {
        "x-request-id": "req-2",
        "x-afu9-sub": "user-2",
      },
    });

    const response = await GET(request, { params: Promise.resolve({ id: "issue-2" }) });

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      code: "INVALID_STORED_STATE",
      requestId: "req-2",
    });
    expect(response.headers.get("x-afu9-error-code")).toBe("INVALID_STORED_STATE");
  });

  it("maps serialization failures to SERIALIZATION_FAILED", async () => {
    mockEnsure.mockResolvedValue({
      ok: true,
      issue: { id: "issue-3" },
      source: "control",
    });

    const circular: Record<string, unknown> = { id: "issue-3" };
    (circular as { self?: unknown }).self = circular;
    mockNormalize.mockReturnValue(circular);

    const request = new NextRequest("http://localhost/api/issues/issue-3", {
      headers: {
        "x-request-id": "req-3",
        "x-afu9-sub": "user-3",
      },
    });

    const response = await GET(request, { params: Promise.resolve({ id: "issue-3" }) });

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      code: "SERIALIZATION_FAILED",
      requestId: "req-3",
    });
  });

  it("maps GitHub API errors to GITHUB_API_ERROR", async () => {
    mockEnsure.mockResolvedValue({
      ok: true,
      issue: { id: "issue-4" },
      source: "control",
    });
    mockNormalize.mockReturnValue({ id: "issue-4", title: "Issue" });
    mockDebugEnabled.mockReturnValue(true);
    const error = new Error("GitHub API error");
    (error as { status?: number }).status = 502;
    mockBuildTrace.mockRejectedValueOnce(error);

    const request = new NextRequest("http://localhost/api/issues/issue-4", {
      headers: {
        "x-request-id": "req-4",
        "x-afu9-sub": "user-4",
      },
    });

    const response = await GET(request, { params: Promise.resolve({ id: "issue-4" }) });

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      code: "GITHUB_API_ERROR",
      requestId: "req-4",
      upstreamStatus: 502,
    });
  });
});
