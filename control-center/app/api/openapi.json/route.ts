import { jsonResponse, getRequestId } from '@/lib/api/response-helpers';
import { buildAfu9ControlOpenApiDocument } from '@/lib/openapi/afu9ControlOpenapi';

export async function GET(request: Request) {
  const requestId = getRequestId(request);
  const document = buildAfu9ControlOpenApiDocument();

  return jsonResponse(document, {
    requestId,
    headers: {
      'Cache-Control': 'no-store, max-age=0',
      Pragma: 'no-cache',
    },
  });
}
