export const PUBLIC_ROUTES = [
  '/api/internal/deploy-events',
  // GitHub App webhook: auth is enforced exclusively via X-Hub-Signature-256 in the route handler.
  '/api/github/webhook',
  '/api/auth/login',
  '/api/auth/refresh',
  '/api/auth/forgot-password',
  '/api/auth/reset-password',
  '/api/build-metadata',
  '/api/health',
  '/api/ready',
  '/auth/refresh',
  '/login',
  '/forgot-password',
  '/reset-password',
  '/favicon.ico',
  '/_next',
  '/public',
] as const;

export function isPublicRoute(pathname: string): boolean {
  return PUBLIC_ROUTES.some((route) => pathname.startsWith(route));
}
