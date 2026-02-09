import { NextRequest } from 'next/server';
import { GET as getS1S9Issue } from '../../../../issues/[id]/route';
import { POST as postS1S3Spec } from '../../../../s1s3/issues/[id]/spec/route';
import { isIssueNotFound, withAfu9ScopeFallback } from '../../../_shared';
import { getRequestId, getRouteHeaderValue, jsonResponse } from '@/lib/api/response-helpers';
import { getControlResponseHeaders } from '../../../../../issues/_shared';
import { buildAfu9ScopeHeaders } from '../../../_shared';

interface RouteContext {
	params: Promise<{
		id: string;
	}>;
}

async function postS1S9Spec(request: NextRequest, context: RouteContext) {
	let lookupResponse: Response | null = null;
	try {
		lookupResponse = await getS1S9Issue(request, context);
	} catch {
		lookupResponse = null;
	}
	if (lookupResponse && await isIssueNotFound(lookupResponse)) {
		return lookupResponse;
	}

	return postS1S3Spec(request, context);
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
	};

	try {
		const { id } = await context.params;
		const primaryRequest = request.clone();
		const fallbackRequest = request.clone();

		return withAfu9ScopeFallback({
			primary: () => postS1S9Spec(primaryRequest, context),
			fallback: () => postS1S3Spec(fallbackRequest, context),
			primaryScope: 's1s9',
			fallbackScope: 's1s3',
			requestedScope: 's1s9',
			issueId: id,
		});
	} catch (error) {
		const upstreamStatus =
			typeof (error as { status?: number })?.status === 'number'
				? (error as { status?: number }).status
				: undefined;
		const status = upstreamStatus ? 502 : 500;
		return jsonResponse(
			{
				errorCode: 'spec_ready_failed',
				requestId,
				scopeRequested: requestedScope,
				scopeResolved: 's1s9',
				detailsSafe: 'Failed to set spec',
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
