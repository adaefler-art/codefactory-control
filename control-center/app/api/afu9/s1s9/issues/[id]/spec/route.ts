import { NextRequest } from 'next/server';
import { POST as postS1S3Spec } from '../../../../s1s3/issues/[id]/spec/route';
import { getRequestId, getRouteHeaderValue, jsonResponse } from '@/lib/api/response-helpers';
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
		const upstreamStatus =
			typeof (error as { status?: number })?.status === 'number'
				? (error as { status?: number }).status
				: undefined;
		const errorName =
			typeof (error as { name?: string })?.name === 'string'
				? (error as { name?: string }).name
				: undefined;
		const errorMessage =
			typeof (error as { message?: string })?.message === 'string'
				? (error as { message?: string }).message
				: undefined;
		const errorMessageSafe = errorMessage ? errorMessage.slice(0, 200) : undefined;
		const status = upstreamStatus ? 502 : 500;
		return jsonResponse(
			{
				errorCode: 'spec_ready_failed',
				requestId,
				scopeRequested: requestedScope,
				scopeResolved: 's1s9',
				detailsSafe: 'Failed to set spec',
				thrown: true,
				errorName,
				errorMessageSafe,
				hasStatusField: typeof upstreamStatus === 'number',
			},
			{
				status,
				requestId,
				headers: {
					...responseHeaders,
					'x-afu9-error-code': 'spec_ready_failed',
				},
			}
		);
	}
}
