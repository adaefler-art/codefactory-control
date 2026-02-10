import { NextRequest } from 'next/server';
import { GET as getS1S9Issue } from '../../../../issues/[id]/route';
import { POST as postS1S3Implement } from '../../../../s1s3/issues/[id]/implement/route';
import { isIssueNotFound, withAfu9ScopeFallback } from '../../../_shared';

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

function applyHandlerHeaders(response: Response): Response {
	response.headers.set('x-afu9-handler', HANDLER_MARKER);
	response.headers.set('x-afu9-handler-ver', HANDLER_VERSION);
	response.headers.set('x-afu9-commit', resolveCommitSha());
	response.headers.set('x-cf-handler', HANDLER_MARKER);
	return response;
}

async function postS1S9Implement(request: NextRequest, context: RouteContext) {
	const lookupResponse = await getS1S9Issue(request, context);
	if (await isIssueNotFound(lookupResponse)) {
		return lookupResponse;
	}

	return postS1S3Implement(request, context);
}

export async function POST(request: NextRequest, context: RouteContext) {
	const { id } = await context.params;
	const primaryRequest = request.clone();
	const fallbackRequest = request.clone();

	const response = await withAfu9ScopeFallback({
		primary: () => postS1S9Implement(primaryRequest, context),
		fallback: () => postS1S3Implement(fallbackRequest, context),
		primaryScope: 's1s9',
		fallbackScope: 's1s3',
		requestedScope: 's1s9',
		issueId: id,
	});

	return applyHandlerHeaders(response);
}
