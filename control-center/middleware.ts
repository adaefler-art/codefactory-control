import { NextRequest, NextResponse } from 'next/server';
import { jwtVerify, createRemoteJWKSet, JWTPayload } from 'jose';

// Environment configuration
const COGNITO_REGION = process.env.COGNITO_REGION || 'eu-central-1';
const COGNITO_USER_POOL_ID = process.env.COGNITO_USER_POOL_ID || '';
const COGNITO_ISSUER_URL = process.env.COGNITO_ISSUER_URL || 
  (COGNITO_USER_POOL_ID ? `https://cognito-idp.${COGNITO_REGION}.amazonaws.com/${COGNITO_USER_POOL_ID}` : '');
const LANDING_PAGE_URL = process.env.LANDING_PAGE_URL || 'https://afu-9.com/';

// Construct JWKS URL from issuer
const JWKS_URL = COGNITO_ISSUER_URL ? `${COGNITO_ISSUER_URL}/.well-known/jwks.json` : '';

// Cache JWKS fetcher
let jwksCache: ReturnType<typeof createRemoteJWKSet> | null = null;

function getJWKS() {
  if (!jwksCache) {
    if (!JWKS_URL) {
      throw new Error('JWKS URL not configured. Set COGNITO_USER_POOL_ID and COGNITO_REGION environment variables.');
    }
    jwksCache = createRemoteJWKSet(new URL(JWKS_URL));
  }
  return jwksCache;
}

// Environment-based access control mapping
// Group names map to environments
const GROUP_TO_ENV_MAP: Record<string, string> = {
  'afu9-admin-prod': 'prod',
  'afu9-engineer-stage': 'stage',
  'afu9-readonly-stage': 'stage',
};

interface CognitoJWTPayload extends JWTPayload {
  'cognito:groups'?: string[];
  token_use?: string;
}

/**
 * Verify JWT token and extract user information
 * @param token - The JWT token to verify (ID token)
 * @returns Verified JWT payload or null if invalid
 */
async function verifyToken(token: string): Promise<CognitoJWTPayload | null> {
  try {
    const jwks = getJWKS();
    
    // Verify JWT signature, issuer, and expiration
    const { payload } = await jwtVerify(token, jwks, {
      issuer: COGNITO_ISSUER_URL,
      audience: undefined, // Cognito doesn't use audience for access tokens
    });

    // Ensure this is an ID token (contains user info and groups)
    const cognitoPayload = payload as CognitoJWTPayload;
    
    return cognitoPayload;
  } catch (error) {
    // Fail closed: log error and return null
    console.error('JWT verification failed:', error);
    return null;
  }
}

/**
 * Extract environment from hostname
 * @param hostname - Request hostname
 * @returns Environment name (prod, stage) or null
 */
function getEnvironmentFromHost(hostname: string): string | null {
  // Exact match or subdomain of expected domains
  // Prevent subdomain spoofing by ensuring hostname ends with domain or is exact match
  if (hostname === 'stage.afu-9.com' || hostname === 'localhost' || hostname === '127.0.0.1') {
    return 'stage';
  }
  if (hostname === 'afu-9.com' || hostname === 'prod.afu-9.com' || hostname === 'www.afu-9.com') {
    return 'prod';
  }
  return null;
}

/**
 * Check if user has access to the requested environment
 * @param groups - User's Cognito groups
 * @param requiredEnv - Required environment
 * @returns True if user has access, false otherwise
 */
function hasEnvironmentAccess(groups: string[] | undefined, requiredEnv: string): boolean {
  if (!groups || groups.length === 0) {
    return false;
  }

  // Check if any of the user's groups grant access to the required environment
  return groups.some(group => {
    const allowedEnv = GROUP_TO_ENV_MAP[group];
    return allowedEnv === requiredEnv;
  });
}

/**
 * Middleware to protect routes and verify authentication
 */
export async function middleware(request: NextRequest) {
  const { pathname, hostname } = request.nextUrl;

  // Public routes that don't require authentication
  const publicRoutes = [
    '/api/auth/login',
    '/api/health',
    '/api/ready',
    '/favicon.ico',
    '/_next',
    '/public',
  ];

  // Check if this is a public route
  const isPublicRoute = publicRoutes.some(route => pathname.startsWith(route));
  
  if (isPublicRoute) {
    return NextResponse.next();
  }

  // Extract JWT tokens from cookies
  const idToken = request.cookies.get('afu9_id')?.value;
  const accessToken = request.cookies.get('afu9_access')?.value;

  // If no tokens present, redirect to landing page
  if (!idToken && !accessToken) {
    console.log('No authentication tokens found, redirecting to landing page');
    return NextResponse.redirect(LANDING_PAGE_URL);
  }

  // Verify the ID token (contains user info and groups)
  const verifiedPayload = await verifyToken(idToken || '');
  
  if (!verifiedPayload) {
    // Fail closed: invalid or expired token, redirect to landing page
    console.log('Token verification failed, redirecting to landing page');
    
    // Clear invalid cookies
    const response = NextResponse.redirect(LANDING_PAGE_URL);
    response.cookies.delete('afu9_id');
    response.cookies.delete('afu9_access');
    
    return response;
  }

  // Check environment-based access control
  const requiredEnv = getEnvironmentFromHost(hostname);
  
  if (requiredEnv) {
    const userGroups = verifiedPayload['cognito:groups'];
    const hasAccess = hasEnvironmentAccess(userGroups, requiredEnv);
    
    if (!hasAccess) {
      console.log(`User does not have access to ${requiredEnv} environment`);
      
      // Return 403 Forbidden or redirect to landing page
      return NextResponse.redirect(LANDING_PAGE_URL, {
        status: 403,
      });
    }
  }

  // Authentication and authorization successful, allow request to proceed
  return NextResponse.next();
}

// Configure which routes the middleware should run on
export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     */
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
};
