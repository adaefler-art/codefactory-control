import { z } from 'zod';
import {
  OpenAPIRegistry,
  OpenApiGeneratorV31,
  extendZodWithOpenApi,
} from '@asteasolutions/zod-to-openapi';

extendZodWithOpenApi(z);

const registry = new OpenAPIRegistry();

const ErrorResponseSchema = registry.register(
  'ErrorResponse',
  z
    .object({
      errorCode: z.string(),
      requestId: z.string(),
      message: z.string().optional(),
      details: z.unknown().optional(),
    })
    .passthrough()
);

const UnavailablePayloadSchema = registry.register(
  'UnavailablePayload',
  z
    .object({
      status: z.literal('UNAVAILABLE'),
      code: z.string(),
      message: z.string(),
      requestId: z.string().optional(),
      upstreamStatus: z.number().int().optional(),
    })
    .passthrough()
);

const StageActionSchema = registry.register(
  'StageAction',
  z
    .object({
      actionId: z.string(),
      state: z.enum(['ready', 'blocked']),
      blockedReason: z.string().optional(),
    })
    .passthrough()
);

const StageStatusSchema = registry.register(
  'StageStatus',
  z
    .object({
      stageId: z.string(),
      actions: z.array(StageActionSchema),
    })
    .passthrough()
);

const WorkflowStateSchema = registry.register(
  'WorkflowState',
  z
    .object({
      completed: z.array(z.string()),
      nextStep: z.string(),
      current: z.string().optional(),
    })
    .passthrough()
);

const GithubLinkSchema = registry.register(
  'GithubLink',
  z
    .object({
      repo: z.string().optional(),
      issueNumber: z.number().int().optional(),
      url: z.string().url().optional(),
    })
    .passthrough()
);

const Afu9IssueSchema = registry.register(
  'Afu9Issue',
  z
    .object({
      id: z.string(),
      publicId: z.string().nullable().optional(),
      canonicalId: z.string().nullable().optional(),
      title: z.string(),
      status: z.string(),
      labels: z.array(z.string()),
      githubIssueNumber: z.number().int().nullable().optional(),
      githubUrl: z.string().nullable().optional(),
      githubRepo: z.string().nullable().optional(),
      createdAt: z.string().nullable().optional(),
      updatedAt: z.string().nullable().optional(),
    })
    .passthrough()
);

const IssueListResponseSchema = registry.register(
  'IssueListResponse',
  z
    .object({
      issues: z.array(Afu9IssueSchema),
      total: z.number().int(),
      filtered: z.number().int(),
      limit: z.number().int(),
      offset: z.number().int(),
    })
    .passthrough()
);

const IssueDetailS2Schema = registry.register(
  'IssueDetailS2',
  z
    .object({
      status: z.string(),
      scope: z.string().nullable(),
      acceptanceCriteria: z.array(z.string()),
      specReadyAt: z.string().nullable(),
      executionState: z.enum(['ready', 'blocked']),
      missingConfig: z.array(z.string()).optional(),
      blockedReason: z.string().optional(),
    })
    .passthrough()
);

const IssueDetailResponseSchema = registry.register(
  'IssueDetailResponse',
  z
    .object({
      ok: z.literal(true),
      issue: Afu9IssueSchema,
      id: z.string(),
      title: z.string(),
      github: GithubLinkSchema.nullable().optional(),
      stateQuality: z.enum(['complete', 'partial']),
      workflow: WorkflowStateSchema,
      stages: z.array(StageStatusSchema),
      s2: IssueDetailS2Schema.optional(),
      runs: z.union([z.array(z.unknown()), UnavailablePayloadSchema]).optional(),
      stateFlow: z.union([z.record(z.string(), z.unknown()), UnavailablePayloadSchema]).optional(),
      execution: z.union([z.record(z.string(), z.unknown()), UnavailablePayloadSchema]).optional(),
      diagnostics: z
        .object({
          migrationApplied: z.array(z.string()),
        })
        .optional(),
    })
    .passthrough()
);

const S1S3IssueSchema = registry.register(
  'S1S3Issue',
  z
    .object({
      id: z.string(),
      public_id: z.string(),
      canonical_id: z.string().nullable(),
      repo_full_name: z.string(),
      github_issue_number: z.number().int(),
      github_issue_url: z.string(),
      owner: z.string(),
      status: z.string(),
      problem: z.string().nullable(),
      scope: z.string().nullable(),
      acceptance_criteria: z.union([z.array(z.string()), z.string()]),
      notes: z.string().nullable(),
      pr_number: z.number().int().nullable(),
      pr_url: z.string().nullable(),
      branch_name: z.string().nullable(),
      created_at: z.string(),
      updated_at: z.string(),
      spec_ready_at: z.string().nullable(),
      pr_created_at: z.string().nullable(),
    })
    .passthrough()
);

const S1S3RunSchema = registry.register(
  'S1S3Run',
  z
    .object({
      id: z.string(),
      type: z.string(),
      issue_id: z.string(),
      request_id: z.string(),
      actor: z.string(),
      status: z.string(),
      error_message: z.string().nullable(),
      created_at: z.string(),
      started_at: z.string().nullable(),
      completed_at: z.string().nullable(),
    })
    .passthrough()
);

const S1S3StepSchema = registry.register(
  'S1S3RunStep',
  z
    .object({
      id: z.string(),
      run_id: z.string(),
      step_id: z.string(),
      step_name: z.string(),
      status: z.string(),
      evidence_refs: z.unknown(),
      error_message: z.string().nullable(),
      created_at: z.string(),
    })
    .passthrough()
);

const S1PickRequestSchema = registry.register(
  'S1PickRequest',
  z.object({
    repo: z.string(),
    issueNumber: z.number().int(),
    owner: z.string().optional(),
    canonicalId: z.string().optional(),
  })
);

const S1PickResponseSchema = registry.register(
  'S1PickResponse',
  z
    .object({
      issue: S1S3IssueSchema,
      run: S1S3RunSchema,
      step: S1S3StepSchema,
    })
    .passthrough()
);

const S2SpecRequestSchema = registry.register(
  'S2SpecRequest',
  z.object({
    problem: z.string().optional(),
    scope: z.string().optional(),
    acceptanceCriteria: z.array(z.string()).min(1),
    notes: z.string().optional(),
  })
);

const S2SpecResponseSchema = registry.register(
  'S2SpecResponse',
  z
    .object({
      ok: z.literal(true),
      issueId: z.string(),
      updatedAt: z.string().nullable(),
      s2: z
        .object({
          status: z.string(),
          scope: z.string().nullable(),
          acceptanceCriteria: z.array(z.string()),
          specReadyAt: z.string().nullable(),
        })
        .passthrough(),
      workflow: z
        .object({
          current: z.string(),
        })
        .passthrough(),
      issue: S1S3IssueSchema,
      run: S1S3RunSchema,
      step: S1S3StepSchema,
    })
    .passthrough()
);

const S3ImplementRequestSchema = registry.register(
  'S3ImplementRequest',
  z.object({
    baseBranch: z.string().optional(),
    prTitle: z.string().optional(),
    prBody: z.string().optional(),
  })
);

const S3ImplementResponseSchema = registry.register(
  'S3ImplementResponse',
  z
    .object({
      ok: z.literal(true),
      stage: z.literal('S3'),
      runId: z.string(),
      mutationId: z.string(),
      issueId: z.string(),
      startedAt: z.string(),
      issue: S1S3IssueSchema,
      run: S1S3RunSchema,
      step: S1S3StepSchema,
      pr: z
        .object({
          number: z.number().int(),
          url: z.string().url(),
          branch: z.string(),
        })
        .passthrough(),
      message: z.string().optional(),
    })
    .passthrough()
);

const HealthResponseSchema = registry.register(
  'HealthResponse',
  z
    .object({
      ok: z.literal(true),
      service: z.string(),
      healthContractVersion: z.string(),
      stage: z.string(),
      commitSha: z.string(),
      version: z.string(),
      intentEnabled: z.boolean(),
      timestamp: z.string(),
    })
    .passthrough()
);

const IssueIdParamSchema = z.object({
  id: z.string(),
});

const IssueListQuerySchema = z.object({
  canonicalId: z.string().optional(),
  canonical_id: z.string().optional(),
  publicId: z.string().optional(),
  public_id: z.string().optional(),
  status: z.string().optional(),
  handoff_state: z.string().optional(),
  limit: z.string().optional(),
  offset: z.string().optional(),
});

const S1S3IssueIdParamSchema = z.object({
  id: z.string(),
});

registry.registerPath({
  method: 'get',
  path: '/api/afu9/issues/{id}',
  tags: ['AFU9 Read'],
  request: {
    params: IssueIdParamSchema,
  },
  responses: {
    200: {
      description: 'AFU-9 issue detail',
      content: {
        'application/json': {
          schema: IssueDetailResponseSchema,
        },
      },
    },
    400: {
      description: 'Invalid identifier',
      content: {
        'application/json': { schema: ErrorResponseSchema },
      },
    },
    404: {
      description: 'Issue not found',
      content: {
        'application/json': { schema: ErrorResponseSchema },
      },
    },
    500: {
      description: 'Server error',
      content: {
        'application/json': { schema: ErrorResponseSchema },
      },
    },
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/afu9/s1s9/issues/{id}',
  tags: ['AFU9 Read'],
  request: {
    params: IssueIdParamSchema,
  },
  responses: {
    200: {
      description: 'AFU-9 issue detail (s1s9 scope)',
      content: {
        'application/json': {
          schema: IssueDetailResponseSchema,
        },
      },
    },
    400: {
      description: 'Invalid identifier',
      content: {
        'application/json': { schema: ErrorResponseSchema },
      },
    },
    404: {
      description: 'Issue not found',
      content: {
        'application/json': { schema: ErrorResponseSchema },
      },
    },
    500: {
      description: 'Server error',
      content: {
        'application/json': { schema: ErrorResponseSchema },
      },
    },
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/afu9/issues',
  tags: ['AFU9 Read'],
  request: {
    query: IssueListQuerySchema,
  },
  responses: {
    200: {
      description: 'AFU-9 issue list',
      content: {
        'application/json': {
          schema: IssueListResponseSchema,
        },
      },
    },
    400: {
      description: 'Invalid query',
      content: {
        'application/json': { schema: ErrorResponseSchema },
      },
    },
    500: {
      description: 'Server error',
      content: {
        'application/json': { schema: ErrorResponseSchema },
      },
    },
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/afu9/s1s3/issues/pick',
  tags: ['AFU9 Stage Actions'],
  request: {
    body: {
      content: {
        'application/json': {
          schema: S1PickRequestSchema,
        },
      },
    },
  },
  responses: {
    201: {
      description: 'S1 pick issue',
      content: {
        'application/json': {
          schema: S1PickResponseSchema,
        },
      },
    },
    400: {
      description: 'Invalid request',
      content: {
        'application/json': { schema: ErrorResponseSchema },
      },
    },
    401: {
      description: 'Unauthorized',
      content: {
        'application/json': { schema: ErrorResponseSchema },
      },
    },
    403: {
      description: 'Forbidden',
      content: {
        'application/json': { schema: ErrorResponseSchema },
      },
    },
    404: {
      description: 'Issue not found',
      content: {
        'application/json': { schema: ErrorResponseSchema },
      },
    },
    500: {
      description: 'Server error',
      content: {
        'application/json': { schema: ErrorResponseSchema },
      },
    },
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/afu9/s1s3/issues/{id}/spec',
  tags: ['AFU9 Stage Actions'],
  request: {
    params: S1S3IssueIdParamSchema,
    body: {
      content: {
        'application/json': {
          schema: S2SpecRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'S2 save spec',
      content: {
        'application/json': {
          schema: S2SpecResponseSchema,
        },
      },
    },
    401: {
      description: 'Unauthorized',
      content: {
        'application/json': { schema: ErrorResponseSchema },
      },
    },
    404: {
      description: 'Issue not found',
      content: {
        'application/json': { schema: ErrorResponseSchema },
      },
    },
    500: {
      description: 'Server error',
      content: {
        'application/json': { schema: ErrorResponseSchema },
      },
    },
    502: {
      description: 'Upstream error',
      content: {
        'application/json': { schema: ErrorResponseSchema },
      },
    },
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/afu9/s1s9/issues/{id}/spec',
  tags: ['AFU9 Stage Actions'],
  request: {
    params: S1S3IssueIdParamSchema,
    body: {
      content: {
        'application/json': {
          schema: S2SpecRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'S2 save spec (s1s9 scope)',
      content: {
        'application/json': {
          schema: S2SpecResponseSchema,
        },
      },
    },
    401: {
      description: 'Unauthorized',
      content: {
        'application/json': { schema: ErrorResponseSchema },
      },
    },
    404: {
      description: 'Issue not found',
      content: {
        'application/json': { schema: ErrorResponseSchema },
      },
    },
    500: {
      description: 'Server error',
      content: {
        'application/json': { schema: ErrorResponseSchema },
      },
    },
    502: {
      description: 'Upstream error',
      content: {
        'application/json': { schema: ErrorResponseSchema },
      },
    },
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/afu9/s1s3/issues/{id}/implement',
  tags: ['AFU9 Stage Actions'],
  request: {
    params: S1S3IssueIdParamSchema,
    body: {
      content: {
        'application/json': {
          schema: S3ImplementRequestSchema,
        },
      },
    },
  },
  responses: {
    202: {
      description: 'S3 implement',
      content: {
        'application/json': {
          schema: S3ImplementResponseSchema,
        },
      },
    },
    401: {
      description: 'Unauthorized',
      content: {
        'application/json': { schema: ErrorResponseSchema },
      },
    },
    404: {
      description: 'Issue not found',
      content: {
        'application/json': { schema: ErrorResponseSchema },
      },
    },
    409: {
      description: 'Conflict',
      content: {
        'application/json': { schema: ErrorResponseSchema },
      },
    },
    500: {
      description: 'Server error',
      content: {
        'application/json': { schema: ErrorResponseSchema },
      },
    },
    503: {
      description: 'Dispatch disabled',
      content: {
        'application/json': { schema: ErrorResponseSchema },
      },
    },
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/afu9/s1s9/issues/{id}/implement',
  tags: ['AFU9 Stage Actions'],
  request: {
    params: S1S3IssueIdParamSchema,
    body: {
      content: {
        'application/json': {
          schema: S3ImplementRequestSchema,
        },
      },
    },
  },
  responses: {
    202: {
      description: 'S3 implement (s1s9 scope)',
      content: {
        'application/json': {
          schema: S3ImplementResponseSchema,
        },
      },
    },
    401: {
      description: 'Unauthorized',
      content: {
        'application/json': { schema: ErrorResponseSchema },
      },
    },
    404: {
      description: 'Issue not found',
      content: {
        'application/json': { schema: ErrorResponseSchema },
      },
    },
    409: {
      description: 'Conflict',
      content: {
        'application/json': { schema: ErrorResponseSchema },
      },
    },
    500: {
      description: 'Server error',
      content: {
        'application/json': { schema: ErrorResponseSchema },
      },
    },
    503: {
      description: 'Dispatch disabled',
      content: {
        'application/json': { schema: ErrorResponseSchema },
      },
    },
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/health',
  tags: ['Diagnostics'],
  responses: {
    200: {
      description: 'Service health',
      content: {
        'application/json': {
          schema: HealthResponseSchema,
        },
      },
    },
  },
});

export function buildAfu9ControlOpenApiDocument() {
  const generator = new OpenApiGeneratorV31(registry.definitions);
  return generator.generateDocument({
    openapi: '3.1.0',
    info: {
      title: 'AFU-9 Control API',
      version: 'v1',
      description: 'AFU-9 Control API v1 (control-center).',
    },
    tags: [
      { name: 'AFU9 Read', description: 'AFU-9 read-only endpoints.' },
      { name: 'AFU9 Stage Actions', description: 'AFU-9 stage action endpoints.' },
      { name: 'Diagnostics', description: 'Control-center diagnostics endpoints.' },
    ],
  });
}
