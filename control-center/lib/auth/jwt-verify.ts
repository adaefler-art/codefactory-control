import type {
  JWTPayload,
  createRemoteJWKSet as createRemoteJWKSetType,
  jwtVerify as jwtVerifyType,
} from 'jose';

type RemoteJWKSet = ReturnType<typeof createRemoteJWKSetType>;

let joseModulePromise: Promise<{
  jwtVerify: typeof jwtVerifyType;
  createRemoteJWKSet: typeof createRemoteJWKSetType;
}> | null = null;

async function getJose() {
  if (!joseModulePromise) {
    joseModulePromise = import('jose') as any;
  }
  return joseModulePromise;
}

// Cache JWKS fetcher (edge runtime compatible)
let jwksCache: RemoteJWKSet | null = null;
let cachedJwksUrl: string | null = null;

export interface CognitoJWTPayload extends JWTPayload {
  'cognito:groups'?: string[];
  token_use?: string;
  sub?: string;
}

export interface JWTVerifySuccess {
  success: true;
  payload: CognitoJWTPayload;
}

export interface JWTVerifyFailure {
  success: false;
  error: string;
}

export type JWTVerifyResult = JWTVerifySuccess | JWTVerifyFailure;

/**
 * Get environment configuration (re-read on each call for testability)
 */
function getConfig() {
  const COGNITO_REGION = process.env.COGNITO_REGION || 'eu-central-1';
  const COGNITO_USER_POOL_ID = process.env.COGNITO_USER_POOL_ID || '';
  const COGNITO_ISSUER_URL = process.env.COGNITO_ISSUER_URL || 
    (COGNITO_USER_POOL_ID ? `https://cognito-idp.${COGNITO_REGION}.amazonaws.com/${COGNITO_USER_POOL_ID}` : '');
  const JWKS_URL = COGNITO_ISSUER_URL ? `${COGNITO_ISSUER_URL}/.well-known/jwks.json` : '';
  
  return { COGNITO_ISSUER_URL, JWKS_URL };
}

/**
 * Get or create JWKS fetcher with fail-closed error handling
 * @returns JWKS fetcher or null if configuration is invalid
 */
async function getJWKS(): Promise<RemoteJWKSet | null> {
  try {
    const { JWKS_URL } = getConfig();
    
    // Recreate cache if URL changed (for testing)
    if (cachedJwksUrl !== JWKS_URL) {
      jwksCache = null;
      cachedJwksUrl = JWKS_URL;
    }
    
    if (!jwksCache) {
      if (!JWKS_URL) {
        console.error('[JWT-VERIFY] JWKS URL not configured. Set COGNITO_USER_POOL_ID and COGNITO_REGION environment variables.');
        return null;
      }
      const { createRemoteJWKSet } = await getJose();
      jwksCache = createRemoteJWKSet(new URL(JWKS_URL));
    }
    return jwksCache;
  } catch (error) {
    console.error('[JWT-VERIFY] Failed to create JWKS fetcher:', error);
    return null;
  }
}

/**
 * Verify JWT token with fail-closed behavior
 * 
 * This function implements explicit fail-closed security:
 * - JWKS fetch errors return failure
 * - Invalid signatures return failure
 * - Expired tokens return failure
 * - Wrong issuer returns failure
 * - Missing configuration returns failure
 * 
 * @param token - The JWT token to verify (ID token)
 * @returns JWTVerifyResult with success/failure status and payload/error
 */
export async function verifyJWT(token: string): Promise<JWTVerifyResult> {
  // Fail closed: empty token
  if (!token || token.trim() === '') {
    console.error('[JWT-VERIFY] Empty token provided');
    return { success: false, error: 'Empty token' };
  }

  // Get configuration (re-read for testability)
  const { COGNITO_ISSUER_URL } = getConfig();

  // Fail closed: missing configuration
  if (!COGNITO_ISSUER_URL) {
    console.error('[JWT-VERIFY] COGNITO_ISSUER_URL not configured');
    return { success: false, error: 'JWT verification not configured' };
  }

  try {
    const jwks = await getJWKS();
    
    // Fail closed: JWKS fetcher creation failed
    if (!jwks) {
      console.error('[JWT-VERIFY] JWKS fetcher unavailable');
      return { success: false, error: 'JWKS fetcher unavailable' };
    }

    const { jwtVerify } = await getJose();

    // Verify JWT signature, issuer, and expiration
    // Cognito ID tokens don't use audience claim, so we set it to undefined
    const { payload } = await jwtVerify(token, jwks, {
      issuer: COGNITO_ISSUER_URL,
      audience: undefined,
    });

    const cognitoPayload = payload as CognitoJWTPayload;

    // Success: token is valid
    console.log('[JWT-VERIFY] Token verified successfully for subject:', cognitoPayload.sub);
    return { success: true, payload: cognitoPayload };
  } catch (error: any) {
    // Fail closed: log detailed error server-side, return generic error
    if (error.code === 'ERR_JWT_EXPIRED') {
      console.error('[JWT-VERIFY] Token expired:', error.message);
      return { success: false, error: 'Token expired' };
    } else if (error.code === 'ERR_JWS_SIGNATURE_VERIFICATION_FAILED') {
      console.error('[JWT-VERIFY] Signature verification failed:', error.message);
      return { success: false, error: 'Invalid signature' };
    } else if (error.code === 'ERR_JWT_CLAIM_VALIDATION_FAILED') {
      console.error('[JWT-VERIFY] Claim validation failed:', error.message);
      return { success: false, error: 'Invalid claims' };
    } else if (error.name === 'TypeError' || error.cause?.code === 'ENOTFOUND' || error.cause?.code === 'ECONNREFUSED') {
      // JWKS fetch error - explicit fail-closed handling for network errors
      console.error('[JWT-VERIFY] JWKS fetch error (fail-closed):', error.message);
      return { success: false, error: 'JWKS fetch failed' };
    } else {
      console.error('[JWT-VERIFY] Verification failed:', error);
      return { success: false, error: 'Verification failed' };
    }
  }
}
