import { NextRequest } from 'next/server';
import { GET as getS1S9Issue } from '../../../../issues/[id]/route';
import { POST as postS1S3Spec } from '../../../../s1s3/issues/[id]/spec/route';
import { isIssueNotFound, withAfu9ScopeFallback } from '../../../_shared';

interface RouteContext {
	params: Promise<{
		id: string;
	}>;
}

async function postS1S9Spec(request: NextRequest, context: RouteContext) {
	const lookupResponse = await getS1S9Issue(request, context);
	if (await isIssueNotFound(lookupResponse)) {
		return lookupResponse;
	}

	return postS1S3Spec(request, context);
}

export async function POST(request: NextRequest, context: RouteContext) {
	const primaryRequest = request.clone();
	const fallbackRequest = request.clone();

	return withAfu9ScopeFallback({
		primary: () => postS1S9Spec(primaryRequest, context),
		fallback: () => postS1S3Spec(fallbackRequest, context),
		primaryScope: 's1s9',
		fallbackScope: 's1s3',
	});
}
