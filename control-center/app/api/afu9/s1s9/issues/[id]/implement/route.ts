import { NextRequest } from 'next/server';
import { GET as getS1S9Issue } from '../../../../issues/[id]/route';
import { POST as postS1S3Implement } from '../../../../s1s3/issues/[id]/implement/route';
import { isIssueNotFound, withAfu9ScopeFallback, buildAfu9ScopeHeaders } from '../../../_shared';
import { getRequestId, getRouteHeaderValue } from '@/lib/api/response-helpers';
import { getControlResponseHeaders } from '../../../../../issues/_shared';
import { makeAfu9Error, S3_IMPLEMENT_CODES } from '@/lib/afu9/workflow-errors';

interface RouteContext {
	params: Promise<{
		id: string;
	}>;
}

const HANDLER_MARKER = 's1s9-implement';
const HANDLER_VERSION = 'v1';

type Afu9AuthPath = 'token' | 'app' | 'unknown';
type Afu9Phase = 'preflight' | 'trigger' | 'mapped' | 'success';

function resolveCommitSha(): string {
	const raw =
		process.env.VERCEL_GIT_COMMIT_SHA ||
		process.env.GIT_COMMIT_SHA ||
		process.env.COMMIT_SHA;
	if (!raw) return 'unknown';
	return raw.slice(0, 7);
}

function applyHandlerHeaders(response: Response, requestId: string): Response {
	response.headers.set('x-afu9-handler', HANDLER_MARKER);
	response.headers.set('x-afu9-handler-ver', HANDLER_VERSION);
	response.headers.set('x-afu9-commit', resolveCommitSha());
	response.headers.set('x-cf-handler', HANDLER_MARKER);
	if (!response.headers.get('x-afu9-request-id')) {
		response.headers.set('x-afu9-request-id', requestId);
	}
	return response;
}

function setAfu9Headers(
	response: Response,
	requestId: string,
	handlerName: string,
	authPath: Afu9AuthPath,
	phase: Afu9Phase,
	missingConfig?: string[]
): Response {
	const buildStamp =
		process.env.VERCEL_GIT_COMMIT_SHA ||
		process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA ||
		'unknown';
	response.headers.set('x-afu9-request-id', requestId);
	response.headers.set('x-afu9-handler', handlerName);
	response.headers.set('x-afu9-control-build', buildStamp);
	response.headers.set('x-afu9-auth-path', authPath);
	response.headers.set('x-afu9-phase', phase);
	response.headers.set('x-afu9-missing-config', missingConfig?.length ? missingConfig.join(',') : '');
	return response;
}

function parseMissingConfig(value: string | null): string[] {
	if (!value) {
		return [];
	}
	return value
		.split(',')
		.map((entry) => entry.trim())
		.filter((entry) => entry.length > 0);
}

function isProxyTypeError(error: unknown): boolean {
	if (!(error instanceof TypeError)) return false;
	return error.message.toLowerCase().includes('cannot create proxy with a non-object as target or handler');
}

async function postS1S9Implement(request: NextRequest, context: RouteContext) {
	const lookupResponse = await getS1S9Issue(request, context);
	if (await isIssueNotFound(lookupResponse)) {
		return lookupResponse;
	}

	return postS1S3Implement(request, context);
}

export async function POST(request: NextRequest, context: RouteContext) {
	const requestId = getRequestId(request);
	const routeHeaderValue = getRouteHeaderValue(request);
	const { id } = await context.params;
	const primaryRequest = request.clone();
	const fallbackRequest = request.clone();
	const responseHeaders = {
		...getControlResponseHeaders(requestId, routeHeaderValue),
		...buildAfu9ScopeHeaders({
			requestedScope: 's1s9',
			resolvedScope: 's1s9',
		}),
		'x-afu9-handler': HANDLER_MARKER,
		'x-afu9-handler-ver': HANDLER_VERSION,
		'x-afu9-commit': resolveCommitSha(),
		'x-cf-handler': HANDLER_MARKER,
	};

	try {
		const response = await withAfu9ScopeFallback({
			primary: () => postS1S9Implement(primaryRequest, context),
			fallback: () => postS1S3Implement(fallbackRequest, context),
			primaryScope: 's1s9',
			fallbackScope: 's1s3',
			requestedScope: 's1s9',
			issueId: id,
		});

		const authPath = (response.headers.get('x-afu9-auth-path') as Afu9AuthPath) || 'unknown';
		const phase = (response.headers.get('x-afu9-phase') as Afu9Phase) || 'preflight';
		const missingConfig = parseMissingConfig(response.headers.get('x-afu9-missing-config'));
		return setAfu9Headers(
			applyHandlerHeaders(response, requestId),
			requestId,
			HANDLER_MARKER,
			authPath,
			phase,
			missingConfig
		);
	} catch (error) {
		if (isProxyTypeError(error)) {
			const response = applyHandlerHeaders(
				makeAfu9Error({
					stage: 'S3',
					code: S3_IMPLEMENT_CODES.INTERNAL_ERROR,
					phase: 'preflight',
					blockedBy: 'INTERNAL',
					nextAction: 'Retry implement when proxy ready',
					requestId,
					handler: HANDLER_MARKER,
					extraBody: {
						scopeRequested: 's1s9',
						scopeResolved: 's1s9',
						detailsSafe: 'Implement precondition failed',
						thrown: false,
					},
					extraHeaders: responseHeaders,
				})
			);
			return setAfu9Headers(response, requestId, HANDLER_MARKER, 'unknown', 'preflight', []);
		}
		throw error;
	}
}
