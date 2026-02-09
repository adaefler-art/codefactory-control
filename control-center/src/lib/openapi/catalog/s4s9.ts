export type DiscoveredAfu9Endpoint = {
  stage?: "S4" | "S5" | "S6" | "S7" | "S8" | "S9";
  key: string;
  method: "POST";
  path: string;
  handler: string;
  request?: {
    paramsSchema?: string;
    bodySchema?: string;
  };
  responses: {
    successStatus: number;
    schema: string;
    errorStatuses: number[];
    notes?: string;
  };
};

export const discoveredS4S9Endpoints: DiscoveredAfu9Endpoint[] = [
  {
    stage: "S4",
    key: "verdict",
    method: "POST",
    path: "/api/afu9/issues/{id}/verdict",
    handler: "app/api/afu9/issues/[id]/verdict/route.ts",
    request: {
      paramsSchema: "IssueIdParam",
      bodySchema: "VerdictRequest",
    },
    responses: {
      successStatus: 200,
      schema: "VerdictResponse",
      errorStatuses: [400, 404, 500],
    },
  },
  {
    stage: "S5",
    key: "merge",
    method: "POST",
    path: "/api/afu9/issues/{id}/merge",
    handler: "app/api/afu9/issues/[id]/merge/route.ts",
    request: {
      paramsSchema: "IssueIdParam",
      bodySchema: "S5MergeRequest",
    },
    responses: {
      successStatus: 200,
      schema: "S5MergeResponse",
      errorStatuses: [400, 404, 409, 500],
      notes: "409 may return blocked merge details.",
    },
  },
  {
    stage: "S7",
    key: "verify",
    method: "POST",
    path: "/api/afu9/runs/{runId}/verify",
    handler: "app/api/afu9/runs/[runId]/verify/route.ts",
    request: {
      paramsSchema: "RunIdParam",
      bodySchema: "S7VerifyRequest",
    },
    responses: {
      successStatus: 200,
      schema: "S7VerifyResponse",
      errorStatuses: [400, 404, 500],
    },
  },
];

export const s4s9AuditNotes = [
  "S6/S8/S9: no route handlers discovered under app/api in this repo.",
  "Search: \\bS6\\b|\\bS8\\b|\\bS9\\b|stageId:\\s*\"S6\"|stageId:\\s*\"S8\"|stageId:\\s*\"S9\"",
  "Search: deploy|deployment|promote|release|verify|verdict|close|closing|hold|unhold|remediate|remediation|rollback|transition",
  "Search: export\\s+async\\s+function\\s+(GET|POST|PUT|PATCH|DELETE)\\b",
  "Search: /api/afu9/|app/api/afu9/|afu9/s1s9|s4s9|stage-registry|stages\\W*\\[",
];
