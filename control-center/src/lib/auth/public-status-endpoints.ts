export function shouldAllowUnauthenticatedGithubStatusEndpoint(input: {
  method: string;
  pathname: string;
  hostname?: string;
}): boolean {
  const allowByEnv = (process.env.AFU9_PUBLIC_STATUS_ENDPOINTS || '').trim().toLowerCase() === 'true';
  const hostname = (input.hostname || '').toLowerCase();
  const isStagingHostname = hostname.startsWith('stage.');

  return (allowByEnv || isStagingHostname) && input.method === 'GET' && input.pathname === '/api/integrations/github/status';
}
