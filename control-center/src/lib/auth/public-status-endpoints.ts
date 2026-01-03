export function shouldAllowUnauthenticatedGithubStatusEndpoint(input: {
  method: string;
  pathname: string;
  hostname?: string;
}): boolean {
  const allowByEnv = (process.env.AFU9_PUBLIC_STATUS_ENDPOINTS || '').trim().toLowerCase() === 'true';
  const hostname = (input.hostname || '').toLowerCase();
  const isStagingHostname = hostname.startsWith('stage.');

  const isAllowedPath =
    input.pathname === '/api/integrations/github/status' ||
    input.pathname === '/api/deploy/status' ||
    input.pathname === '/api/mcp/verify';

  return (allowByEnv || isStagingHostname) && input.method === 'GET' && isAllowedPath;
}
