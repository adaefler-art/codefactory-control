import { NextRequest } from 'next/server';
import { GET as getS1S9Issue } from '../../../../issues/[id]/route';
import { POST as postS1S3Implement } from '../../../../s1s3/issues/[id]/implement/route';
import { isIssueNotFound, withAfu9ScopeFallback, buildAfu9ScopeHeaders } from '../../../_shared';
import { getRequestId, getRouteHeaderValue, jsonResponse } from '@/lib/api/response-helpers';
import { getControlResponseHeaders } from '../../../../../issues/_shared';

interface RouteContext {
	params: Promise<{
		id: string;
	}>;
}

const HANDLER_MARKER = 's1s9-implement';
const HANDLER_VERSION = 'v1';

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
	response.headers.set('x-afu9-request-id', requestId);
	return response;
}

function isProxyTypeError(error: unknown): boolean {
	if (!(error instanceof TypeError)) return false;
	return error.message.toLowerCase().includes('proxy');
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

		return applyHandlerHeaders(response, requestId);
	} catch (error) {
		if (isProxyTypeError(error)) {
			return applyHandlerHeaders(
				jsonResponse(
					{
						ok: false,
						code: 'IMPLEMENT_PRECONDITION_FAILED',
						errorCode: 'IMPLEMENT_PRECONDITION_FAILED',
						requestId,
						scopeRequested: 's1s9',
						scopeResolved: 's1s9',
						detailsSafe: 'Implement not available: missing GitHub client/config',
						thrown: false,
					},
					{
						status: 409,
						requestId,
						headers: {
							...responseHeaders,
							'x-afu9-error-code': 'IMPLEMENT_PRECONDITION_FAILED',
						},
					}
				),
				requestId
			);
		}
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
		return applyHandlerHeaders(
			jsonResponse(
				{
					ok: false,
					code: 'IMPLEMENT_FAILED',
					errorCode: 'IMPLEMENT_FAILED',
					requestId,
					scopeRequested: 's1s9',
					scopeResolved: 's1s9',
					detailsSafe: 'Failed to implement',
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
						'x-afu9-error-code': 'IMPLEMENT_FAILED',
					},
				}
			),
			requestId
		);
	}
}
