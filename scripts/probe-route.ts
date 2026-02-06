type ProbeResult = {
  status: number;
  handler: string;
  authPath: string;
  route: string;
  requestId: string;
  errorCode: string;
};

function normalizeBaseUrl(value: string): string {
  return value.replace(/\/$/, "");
}

function headerValue(headers: Headers, name: string): string {
  return headers.get(name) || "-";
}

async function probe(url: string): Promise<ProbeResult> {
  const response = await fetch(url, {
    method: "GET",
    headers: {
      Accept: "application/json",
    },
  });

  let errorCode = "-";
  try {
    const text = await response.text();
    if (text) {
      const parsed = JSON.parse(text) as { errorCode?: string };
      if (parsed && typeof parsed.errorCode === "string") {
        errorCode = parsed.errorCode;
      }
    }
  } catch {
    errorCode = "-";
  }

  return {
    status: response.status,
    handler: headerValue(response.headers, "x-afu9-handler"),
    authPath: headerValue(response.headers, "x-afu9-auth-path"),
    route: headerValue(response.headers, "x-afu9-route"),
    requestId: headerValue(response.headers, "x-afu9-request-id"),
    errorCode,
  };
}

async function run() {
  const args = process.argv.slice(2);
  const baseUrl = args[0] || process.env.CONTROL_BASE_URL || process.env.NEXT_PUBLIC_APP_ORIGIN || process.env.APP_ORIGIN;
  const shortId = args[1];
  const uuid = args[2];

  if (!baseUrl || !shortId) {
    console.error("Usage: node scripts/probe-route.ts <baseUrl> <shortId> [uuid]");
    process.exit(1);
  }

  const normalizedBase = normalizeBaseUrl(baseUrl);
  const targets = [
    `/api/control/afu9/s1s3/issues/${encodeURIComponent(shortId)}`,
    uuid ? `/api/control/afu9/s1s3/issues/${encodeURIComponent(uuid)}` : null,
  ].filter((value): value is string => Boolean(value));

  for (const path of targets) {
    const url = `${normalizedBase}${path}`;
    console.log(`Request: GET ${path}`);
    const result = await probe(url);
    console.log(`Status: ${result.status}`);
    console.log(`X-AFU9-HANDLER: ${result.handler}`);
    console.log(`X-AFU9-AUTH-PATH: ${result.authPath}`);
    console.log(`X-AFU9-ROUTE: ${result.route}`);
    console.log(`X-AFU9-REQUEST-ID: ${result.requestId}`);
    console.log(`errorCode: ${result.errorCode}`);
    console.log("---");
  }
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
