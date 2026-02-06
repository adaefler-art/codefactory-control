import { NextRequest } from 'next/server';
import { GET as getS1S3Issue } from '../../../s1s3/issues/[id]/route';
import { withAfu9ScopeFallback } from '../../_shared';

interface RouteContext {
	params: Promise<{
		id: string;
	}>;
}

export async function GET(request: NextRequest, context: RouteContext) {
	return withAfu9ScopeFallback({
		primary: () => getS1S3Issue(request, context),
		fallback: () => getS1S3Issue(request, context),
		primaryScope: 's1s9',
		fallbackScope: 's1s3',
	});
}
