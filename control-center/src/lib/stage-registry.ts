export type StageId = "S1" | "S2" | "S3" | "S4" | "S5" | "S6" | "S7" | "S8" | "S9";

export type StageRouteKey =
  | "pick"
  | "spec"
  | "implement"
  | "review"
  | "merge"
  | "deploy"
  | "verify"
  | "close"
  | "remediate";

export type StageRoute = {
  key: StageRouteKey;
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  handler: string;
};

export type StageCapabilities = {
  runner?: boolean;
  githubWrite?: boolean;
  eventsQueue?: boolean;
};

export type StageRegistryEntry = {
  stageId: StageId;
  title: string;
  routes: Partial<Record<StageRouteKey, StageRoute>>;
  capabilities?: StageCapabilities;
  featureFlags?: string[];
};

export type StageRegistryError = {
  code: "ENGINE_MISCONFIGURED";
  message: string;
  stageId: StageId;
};

export const REQUIRED_STAGE_ROUTES: Record<StageId, StageRouteKey[]> = {
  S1: ["pick"],
  S2: ["spec"],
  S3: ["implement"],
  S4: ["review"],
  S5: ["merge"],
  S6: ["deploy"],
  S7: ["verify"],
  S8: ["close"],
  S9: ["remediate"],
};

const STAGE_FLAG_PREFIX = "AFU9_STAGE_";

function makeRoute(params: {
  key: StageRouteKey;
  method: StageRoute["method"];
  path: string;
  handler: string;
}): StageRoute {
  return {
    key: params.key,
    method: params.method,
    path: params.path,
    handler: params.handler,
  };
}

export const STAGE_REGISTRY: Record<StageId, StageRegistryEntry> = {
  S1: {
    stageId: "S1",
    title: "Link",
    routes: {
      pick: makeRoute({
        key: "pick",
        method: "POST",
        path: "/api/afu9/s1s3/issues/pick",
        handler: "control.s1s3.pick",
      }),
    },
    featureFlags: [`${STAGE_FLAG_PREFIX}S1_ENABLED`],
  },
  S2: {
    stageId: "S2",
    title: "Specify",
    routes: {
      spec: makeRoute({
        key: "spec",
        method: "POST",
        path: "/api/afu9/s1s3/issues/:id/spec",
        handler: "control.s1s3.spec",
      }),
    },
    featureFlags: [`${STAGE_FLAG_PREFIX}S2_ENABLED`],
  },
  S3: {
    stageId: "S3",
    title: "Implement",
    routes: {
      implement: makeRoute({
        key: "implement",
        method: "POST",
        path: "/api/afu9/s1s3/issues/:id/implement",
        handler: "control.s1s3.implement",
      }),
    },
    capabilities: {
      runner: true,
      githubWrite: true,
      eventsQueue: true,
    },
    featureFlags: [`${STAGE_FLAG_PREFIX}S3_ENABLED`],
  },
  S4: {
    stageId: "S4",
    title: "Review",
    routes: {
      review: makeRoute({
        key: "review",
        method: "POST",
        path: "/api/afu9/s1s9/issues/:id/review",
        handler: "control.s1s9.review",
      }),
    },
    capabilities: {
      githubWrite: true,
    },
    featureFlags: [`${STAGE_FLAG_PREFIX}S4_ENABLED`],
  },
  S5: {
    stageId: "S5",
    title: "Merge",
    routes: {
      merge: makeRoute({
        key: "merge",
        method: "POST",
        path: "/api/afu9/s1s9/issues/:id/merge",
        handler: "control.s1s9.merge",
      }),
    },
    featureFlags: [`${STAGE_FLAG_PREFIX}S5_ENABLED`],
  },
  S6: {
    stageId: "S6",
    title: "Deploy",
    routes: {
      deploy: makeRoute({
        key: "deploy",
        method: "POST",
        path: "/api/afu9/s1s9/issues/:id/deploy",
        handler: "control.s1s9.deploy",
      }),
    },
    featureFlags: [`${STAGE_FLAG_PREFIX}S6_ENABLED`],
  },
  S7: {
    stageId: "S7",
    title: "Verify",
    routes: {
      verify: makeRoute({
        key: "verify",
        method: "POST",
        path: "/api/afu9/s1s9/issues/:id/verify",
        handler: "control.s1s9.verify",
      }),
    },
    featureFlags: [`${STAGE_FLAG_PREFIX}S7_ENABLED`],
  },
  S8: {
    stageId: "S8",
    title: "Close",
    routes: {
      close: makeRoute({
        key: "close",
        method: "POST",
        path: "/api/afu9/s1s9/issues/:id/close",
        handler: "control.s1s9.close",
      }),
    },
    featureFlags: [`${STAGE_FLAG_PREFIX}S8_ENABLED`],
  },
  S9: {
    stageId: "S9",
    title: "Remediate",
    routes: {
      remediate: makeRoute({
        key: "remediate",
        method: "POST",
        path: "/api/afu9/s1s9/issues/:id/remediate",
        handler: "control.s1s9.remediate",
      }),
    },
    featureFlags: [`${STAGE_FLAG_PREFIX}S9_ENABLED`],
  },
};

function hasValue(value: string | undefined | null): boolean {
  return Boolean(value && value.trim().length > 0);
}

export function getStageRegistryEntry(stageId: StageId): StageRegistryEntry | null {
  return STAGE_REGISTRY[stageId] ?? null;
}

export function getStageRegistryError(stageId: StageId): StageRegistryError {
  return {
    code: "ENGINE_MISCONFIGURED",
    message: `missing registry entry ${stageId}`,
    stageId,
  };
}

export function resolveStageMissingConfig(entry: StageRegistryEntry): string[] {
  const missing = new Set<string>();
  const capabilities = entry.capabilities || {};

  if (capabilities.runner) {
    const runnerEndpoint = process.env.MCP_RUNNER_URL || process.env.MCP_RUNNER_ENDPOINT;
    if (!hasValue(runnerEndpoint)) {
      missing.add("MCP_RUNNER_URL");
    }
  }

  if (capabilities.eventsQueue) {
    const queueUrl = process.env.AFU9_GITHUB_EVENTS_QUEUE_URL;
    if (!hasValue(queueUrl)) {
      missing.add("AFU9_GITHUB_EVENTS_QUEUE_URL");
    }
  }

  if (capabilities.githubWrite) {
    const appId = process.env.GITHUB_APP_ID || process.env.GH_APP_ID;
    const appKey = process.env.GITHUB_APP_PRIVATE_KEY_PEM || process.env.GH_APP_PRIVATE_KEY_PEM;
    const appSecretId = process.env.GITHUB_APP_SECRET_ID || process.env.GH_APP_SECRET_ID;
    const dispatcherConfigured = (hasValue(appId) && hasValue(appKey)) || hasValue(appSecretId);
    if (!dispatcherConfigured) {
      missing.add("GITHUB_APP_ID");
      missing.add("GITHUB_APP_PRIVATE_KEY_PEM");
    }
  }

  return Array.from(missing);
}

export function isStageEnabled(entry: StageRegistryEntry): boolean {
  if (!entry.featureFlags || entry.featureFlags.length === 0) {
    return true;
  }

  return entry.featureFlags.every((flag) => process.env[flag] !== "0");
}