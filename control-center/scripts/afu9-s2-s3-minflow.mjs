#!/usr/bin/env node

const args = new Map(
	process.argv.slice(2).map((part) => {
		const [key, ...rest] = part.split('=');
		return [key.replace(/^--/, ''), rest.join('=')];
	})
);

const baseUrl = (args.get('base-url') || process.env.AFU9_BASE_URL || '').replace(/\/$/, '');
const issueId = args.get('issue-id') || process.env.AFU9_ISSUE_ID || '';
const serviceToken = args.get('service-token') || process.env.SERVICE_READ_TOKEN || '';
const scope = args.get('scope') || 'Spec scope for S3 readiness';
const acceptanceCriteria = (args.get('ac') || 'Criterion A;Criterion B')
	.split(';')
	.map((value) => value.trim())
	.filter(Boolean);

if (!baseUrl || !issueId) {
	console.error(
		'Usage: node scripts/afu9-s2-s3-minflow.mjs --base-url=http://localhost:3000 --issue-id=<uuid|publicId|canonicalId> [--service-token=...] [--scope=...] [--ac="A;B"]'
	);
	process.exit(2);
}

const buildHeaders = (requestId) => {
	const headers = {
		accept: 'application/json',
		'content-type': 'application/json',
		'x-request-id': requestId,
	};
	if (serviceToken) {
		headers['x-afu9-service-token'] = serviceToken;
	}
	return headers;
};

const pickIssueSnapshot = async (url, requestId) => {
	const response = await fetch(url, {
		method: 'GET',
		headers: buildHeaders(requestId),
	});
	let body = null;
	try {
		body = await response.json();
	} catch {
		body = null;
	}
	return { response, body };
};

const printSnapshot = (label, payload) => {
	if (!payload) {
		console.log(`${label}: <no-json-body>`);
		return;
	}

	const issue = payload.issue && typeof payload.issue === 'object' ? payload.issue : payload;
	const acceptanceCriteria = Array.isArray(issue.acceptance_criteria)
		? issue.acceptance_criteria
		: typeof issue.acceptance_criteria === 'string'
			? (() => {
					try {
						const parsed = JSON.parse(issue.acceptance_criteria);
						return Array.isArray(parsed) ? parsed : [];
					} catch {
						return [];
					}
				})()
			: [];

	console.log(`${label}:`, {
		status: issue.status ?? null,
		spec_ready_at: issue.spec_ready_at ?? issue.specReadyAt ?? null,
		acceptance_criteria_length: acceptanceCriteria.length,
		scope: issue.scope ?? null,
		repo_full_name: issue.repo_full_name ?? issue.github_repo ?? null,
		github_issue_number: issue.github_issue_number ?? null,
		github_issue_url: issue.github_issue_url ?? issue.github_url ?? null,
	});
};

const run = async () => {
	const canonicalUrl = `${baseUrl}/api/afu9/issues/${encodeURIComponent(issueId)}`;
	const s1s3Url = `${baseUrl}/api/afu9/s1s3/issues/${encodeURIComponent(issueId)}`;
	const s2SpecUrl = `${baseUrl}/api/afu9/s1s9/issues/${encodeURIComponent(issueId)}/spec`;
	const s3ImplementUrl = `${baseUrl}/api/afu9/s1s9/issues/${encodeURIComponent(issueId)}/implement`;

	console.log('Step A) GET canonical issue detail');
	const canonicalBefore = await pickIssueSnapshot(canonicalUrl, 'trace-canonical-before');
	console.log('A.http', canonicalBefore.response.status);
	printSnapshot('A.snapshot', canonicalBefore.body);

	console.log('Step B) POST S2 spec save');
	const s2Response = await fetch(s2SpecUrl, {
		method: 'POST',
		headers: buildHeaders('trace-s2-save'),
		body: JSON.stringify({
			scope,
			acceptanceCriteria,
			notes: 'trace-run',
		}),
	});
	const s2Body = await s2Response.json().catch(() => null);
	console.log('B.http', s2Response.status);
	console.log('B.body', {
		code: s2Body?.code ?? null,
		blockedBy: s2Body?.blockedBy ?? null,
		nextAction: s2Body?.nextAction ?? null,
		requestId: s2Body?.requestId ?? null,
	});

	console.log('Step C1) GET canonical issue detail (after S2)');
	const canonicalAfter = await pickIssueSnapshot(canonicalUrl, 'trace-canonical-after');
	console.log('C1.http', canonicalAfter.response.status);
	printSnapshot('C1.snapshot', canonicalAfter.body);

	console.log('Step C2) GET s1s3 issue detail (after S2)');
	const s1s3After = await pickIssueSnapshot(s1s3Url, 'trace-s1s3-after');
	console.log('C2.http', s1s3After.response.status);
	printSnapshot('C2.snapshot', s1s3After.body);

	console.log('Step D) POST S3 implement');
	const s3Response = await fetch(s3ImplementUrl, {
		method: 'POST',
		headers: buildHeaders('trace-s3-implement'),
		body: JSON.stringify({}),
	});
	const s3Body = await s3Response.json().catch(() => null);
	console.log('D.http', s3Response.status);
	console.log('D.body', {
		code: s3Body?.code ?? null,
		blockedBy: s3Body?.blockedBy ?? null,
		phase: s3Body?.phase ?? null,
		nextAction: s3Body?.nextAction ?? null,
		requestId: s3Body?.requestId ?? null,
	});
};

run().catch((error) => {
	console.error('Trace run failed:', {
		message: error instanceof Error ? error.message : String(error),
	});
	process.exit(1);
});

