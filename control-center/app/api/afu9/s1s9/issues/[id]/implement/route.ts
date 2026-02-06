import { NextRequest } from 'next/server';
import { POST as postS1S3Implement } from '../../../../s1s3/issues/[id]/implement/route';
import { withAfu9ScopeFallback } from '../../../_shared';

interface RouteContext {
	params: Promise<{
		id: string;
	}>;
}

export async function POST(request: NextRequest, context: RouteContext) {
	return withAfu9ScopeFallback({
		primary: () => postS1S3Implement(request, context),
		fallback: () => postS1S3Implement(request, context),
		primaryScope: 's1s9',
		fallbackScope: 's1s3',
	});
}
