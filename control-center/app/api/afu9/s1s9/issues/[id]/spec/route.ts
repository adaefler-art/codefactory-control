import { NextRequest } from 'next/server';
import { POST as postS1S3Spec } from '../../../../s1s3/issues/[id]/spec/route';
import { getRequestId, getRouteHeaderValue } from '@/lib/api/response-helpers';
import { makeAfu9Error, S2_SPEC_CODES } from '@/lib/afu9/workflow-errors';
import { getControlResponseHeaders } from '../../../../../issues/_shared';
import { buildAfu9ScopeHeaders } from '../../../_shared';

interface RouteContext {
	params: Promise<{
		id: string;
	}>;
}

const HANDLER_MARKER = 's1s9-spec';
const HANDLER_VERSION = 'v1';

function resolveCommitSha(): string {
	const raw =
		process.env.VERCEL_GIT_COMMIT_SHA ||
		process.env.GIT_COMMIT_SHA ||
		process.env.COMMIT_SHA;
	if (!raw) return 'unknown';
	return raw.slice(0, 7);
}

function applyHandlerHeaders(response: Response): Response {
	response.headers.set('x-afu9-handler', HANDLER_MARKER);
	response.headers.set('x-afu9-handler-ver', HANDLER_VERSION);
	response.headers.set('x-afu9-commit', resolveCommitSha());
	response.headers.set('x-cf-handler', HANDLER_MARKER);
	return response;
}

export async function POST(request: NextRequest, context: RouteContext) {
	const requestId = getRequestId(request);
	const routeHeaderValue = getRouteHeaderValue(request);
	const requestedScope = request.nextUrl?.pathname?.includes('/afu9/s1s9/') ? 's1s9' : 's1s3';
	const responseHeaders = {
		...getControlResponseHeaders(requestId, routeHeaderValue),
		...buildAfu9ScopeHeaders({
			requestedScope,
			resolvedScope: 's1s9',
		}),
		'x-afu9-handler': HANDLER_MARKER,
		'x-afu9-handler-ver': HANDLER_VERSION,
		'x-afu9-commit': resolveCommitSha(),
		'x-cf-handler': HANDLER_MARKER,
	};

	try {
		const response = await postS1S3Spec(request, context);
		return applyHandlerHeaders(response);
	} catch (error) {
		return makeAfu9Error({
			stage: 'S2',
			code: S2_SPEC_CODES.INTERNAL_ERROR,
			phase: 'mapped',
			blockedBy: 'INTERNAL',
			nextAction: 'Retry spec request',
			requestId,
			handler: HANDLER_MARKER,
			extraBody: {
				scopeRequested: requestedScope,
				scopeResolved: 's1s9',
				detailsSafe: 'Failed to set spec',
				thrown: true,
			},
			extraHeaders: responseHeaders,
		});
	}
}
