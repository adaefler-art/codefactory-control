/**
 * Proof Runner
 * 
 * Deterministic proof checks based on Evidence Pack data.
 * Each proof is a verifiable assertion about the incident.
 */

import type { IncidentEvidencePack } from './incidentSchema';

/**
 * Proof Status
 */
export enum ProofStatus {
  PASS = 'PASS',
  FAIL = 'FAIL',
  INSUFFICIENT_DATA = 'INSUFFICIENT_DATA',
}

/**
 * Proof Result
 */
export interface ProofResult {
  id: string;
  name: string;
  status: ProofStatus;
  evidenceRefs: string[];
  details?: string;
}

/**
 * All Proof Results
 */
export interface ProofRunnerOutput {
  proofs: ProofResult[];
  summary: {
    total: number;
    passed: number;
    failed: number;
    insufficient: number;
  };
}

/**
 * Run all required proofs based on classification
 * 
 * @param pack - Evidence pack
 * @param requiredProofIds - List of required proof IDs
 * @returns Proof runner output
 */
export function runProofs(
  pack: IncidentEvidencePack,
  requiredProofIds: string[]
): ProofRunnerOutput {
  const proofs: ProofResult[] = [];
  
  for (const proofId of requiredProofIds) {
    const proof = runSingleProof(pack, proofId);
    proofs.push(proof);
  }
  
  const summary = {
    total: proofs.length,
    passed: proofs.filter(p => p.status === ProofStatus.PASS).length,
    failed: proofs.filter(p => p.status === ProofStatus.FAIL).length,
    insufficient: proofs.filter(p => p.status === ProofStatus.INSUFFICIENT_DATA).length,
  };
  
  return { proofs, summary };
}

/**
 * Run a single proof check
 */
function runSingleProof(pack: IncidentEvidencePack, proofId: string): ProofResult {
  switch (proofId) {
    case 'PROOF_GET_404':
      return proofGet404(pack);
    case 'PROOF_POST_SUCCESS':
      return proofPostSuccess(pack);
    case 'PROOF_AUTH_ERROR':
      return proofAuthError(pack);
    case 'PROOF_401_403':
      return proof401Or403(pack);
    case 'PROOF_TOOL_CALL_MISSING':
      return proofToolCallMissing(pack);
    case 'PROOF_TEXT_RESPONSE':
      return proofTextResponse(pack);
    case 'PROOF_TOOL_ERROR':
      return proofToolError(pack);
    case 'PROOF_VALIDATION_ERROR':
      return proofValidationError(pack);
    case 'PROOF_STALE_DATA':
      return proofStaleData(pack);
    case 'PROOF_NO_REFRESH':
      return proofNoRefresh(pack);
    default:
      return {
        id: proofId,
        name: 'Unknown Proof',
        status: ProofStatus.INSUFFICIENT_DATA,
        evidenceRefs: [],
        details: `Proof ${proofId} not implemented`,
      };
  }
}

/**
 * PROOF_GET_404: GET request returns 404
 */
function proofGet404(pack: IncidentEvidencePack): ProofResult {
  const snippets = pack.apiSnippets || [];
  const get404Snippets = snippets.filter(s => 
    s.method === 'GET' && s.status === 404
  );
  
  if (get404Snippets.length > 0) {
    return {
      id: 'PROOF_GET_404',
      name: 'GET request returns 404',
      status: ProofStatus.PASS,
      evidenceRefs: get404Snippets.map(s => `apiSnippets[${s.endpoint}]`),
      details: `Found ${get404Snippets.length} GET requests with 404 status`,
    };
  }
  
  if (snippets.length === 0) {
    return {
      id: 'PROOF_GET_404',
      name: 'GET request returns 404',
      status: ProofStatus.INSUFFICIENT_DATA,
      evidenceRefs: [],
      details: 'No API snippets available',
    };
  }
  
  return {
    id: 'PROOF_GET_404',
    name: 'GET request returns 404',
    status: ProofStatus.FAIL,
    evidenceRefs: [],
    details: 'No GET 404 found in API snippets',
  };
}

/**
 * PROOF_POST_SUCCESS: POST request succeeds (200)
 */
function proofPostSuccess(pack: IncidentEvidencePack): ProofResult {
  const snippets = pack.apiSnippets || [];
  const postSuccessSnippets = snippets.filter(s =>
    (s.method === 'POST' || s.method === 'PUT') && s.status === 200
  );
  
  if (postSuccessSnippets.length > 0) {
    return {
      id: 'PROOF_POST_SUCCESS',
      name: 'POST/PUT request succeeds',
      status: ProofStatus.PASS,
      evidenceRefs: postSuccessSnippets.map(s => `apiSnippets[${s.endpoint}]`),
      details: `Found ${postSuccessSnippets.length} successful POST/PUT requests`,
    };
  }
  
  if (snippets.length === 0) {
    return {
      id: 'PROOF_POST_SUCCESS',
      name: 'POST/PUT request succeeds',
      status: ProofStatus.INSUFFICIENT_DATA,
      evidenceRefs: [],
      details: 'No API snippets available',
    };
  }
  
  return {
    id: 'PROOF_POST_SUCCESS',
    name: 'POST/PUT request succeeds',
    status: ProofStatus.FAIL,
    evidenceRefs: [],
    details: 'No successful POST/PUT found',
  };
}

/**
 * PROOF_AUTH_ERROR: Authentication error in logs
 */
function proofAuthError(pack: IncidentEvidencePack): ProofResult {
  const logs = pack.serverLogRefs || [];
  const authErrorLogs = logs.filter(log =>
    log.message.toLowerCase().includes('auth') ||
    log.message.toLowerCase().includes('unauthorized') ||
    log.message.toLowerCase().includes('forbidden')
  );
  
  if (authErrorLogs.length > 0) {
    return {
      id: 'PROOF_AUTH_ERROR',
      name: 'Authentication error in logs',
      status: ProofStatus.PASS,
      evidenceRefs: authErrorLogs.map(l => `serverLogRefs[${l.requestId || 'unknown'}]`),
      details: `Found ${authErrorLogs.length} auth-related log entries`,
    };
  }
  
  return {
    id: 'PROOF_AUTH_ERROR',
    name: 'Authentication error in logs',
    status: ProofStatus.FAIL,
    evidenceRefs: [],
    details: 'No auth errors in logs',
  };
}

/**
 * PROOF_401_403: HTTP 401 or 403 status
 */
function proof401Or403(pack: IncidentEvidencePack): ProofResult {
  const snippets = pack.apiSnippets || [];
  const authErrorSnippets = snippets.filter(s => s.status === 401 || s.status === 403);
  
  if (authErrorSnippets.length > 0) {
    return {
      id: 'PROOF_401_403',
      name: 'HTTP 401/403 status code',
      status: ProofStatus.PASS,
      evidenceRefs: authErrorSnippets.map(s => `apiSnippets[${s.endpoint}]`),
      details: `Found ${authErrorSnippets.length} requests with 401/403 status`,
    };
  }
  
  return {
    id: 'PROOF_401_403',
    name: 'HTTP 401/403 status code',
    status: ProofStatus.FAIL,
    evidenceRefs: [],
    details: 'No 401/403 status codes found',
  };
}

/**
 * PROOF_TOOL_CALL_MISSING: Tool calls missing in logs
 */
function proofToolCallMissing(pack: IncidentEvidencePack): ProofResult {
  const logs = pack.serverLogRefs || [];
  const notes = pack.notes || '';
  
  const hasNoToolCallsLog = logs.some(log =>
    log.message.toLowerCase().includes('no tool')
  );
  
  const hasNoToolCallsNote = notes.toLowerCase().includes('no tool');
  
  if (hasNoToolCallsLog || hasNoToolCallsNote) {
    return {
      id: 'PROOF_TOOL_CALL_MISSING',
      name: 'Tool calls missing',
      status: ProofStatus.PASS,
      evidenceRefs: hasNoToolCallsLog ? ['serverLogRefs'] : ['notes'],
      details: 'Evidence of missing tool calls found',
    };
  }
  
  return {
    id: 'PROOF_TOOL_CALL_MISSING',
    name: 'Tool calls missing',
    status: ProofStatus.INSUFFICIENT_DATA,
    evidenceRefs: [],
    details: 'Cannot determine if tool calls are missing',
  };
}

/**
 * PROOF_TEXT_RESPONSE: Agent returned text-only response
 */
function proofTextResponse(pack: IncidentEvidencePack): ProofResult {
  const notes = pack.notes || '';
  
  if (notes.toLowerCase().includes('text only') || notes.toLowerCase().includes('text response')) {
    return {
      id: 'PROOF_TEXT_RESPONSE',
      name: 'Text-only response',
      status: ProofStatus.PASS,
      evidenceRefs: ['notes'],
      details: 'Evidence of text-only response in notes',
    };
  }
  
  return {
    id: 'PROOF_TEXT_RESPONSE',
    name: 'Text-only response',
    status: ProofStatus.INSUFFICIENT_DATA,
    evidenceRefs: [],
    details: 'Cannot determine response type',
  };
}

/**
 * PROOF_TOOL_ERROR: Tool execution error
 */
function proofToolError(pack: IncidentEvidencePack): ProofResult {
  const logs = pack.serverLogRefs || [];
  const toolErrorLogs = logs.filter(log =>
    log.logLevel === 'ERROR' &&
    log.message.toLowerCase().includes('tool')
  );
  
  if (toolErrorLogs.length > 0) {
    return {
      id: 'PROOF_TOOL_ERROR',
      name: 'Tool execution error',
      status: ProofStatus.PASS,
      evidenceRefs: toolErrorLogs.map(l => `serverLogRefs[${l.requestId || 'unknown'}]`),
      details: `Found ${toolErrorLogs.length} tool error logs`,
    };
  }
  
  return {
    id: 'PROOF_TOOL_ERROR',
    name: 'Tool execution error',
    status: ProofStatus.FAIL,
    evidenceRefs: [],
    details: 'No tool errors in logs',
  };
}

/**
 * PROOF_VALIDATION_ERROR: Schema validation error
 */
function proofValidationError(pack: IncidentEvidencePack): ProofResult {
  const logs = pack.serverLogRefs || [];
  const snippets = pack.apiSnippets || [];
  
  const hasValidationLog = logs.some(log =>
    log.message.toLowerCase().includes('validation') ||
    log.message.toLowerCase().includes('schema')
  );
  
  const has400 = snippets.some(s => s.status === 400);
  
  if (hasValidationLog || has400) {
    return {
      id: 'PROOF_VALIDATION_ERROR',
      name: 'Schema validation error',
      status: ProofStatus.PASS,
      evidenceRefs: hasValidationLog ? ['serverLogRefs'] : ['apiSnippets'],
      details: 'Evidence of validation error found',
    };
  }
  
  return {
    id: 'PROOF_VALIDATION_ERROR',
    name: 'Schema validation error',
    status: ProofStatus.FAIL,
    evidenceRefs: [],
    details: 'No validation errors found',
  };
}

/**
 * PROOF_STALE_DATA: Stale data indicator
 */
function proofStaleData(pack: IncidentEvidencePack): ProofResult {
  const notes = pack.notes || '';
  
  if (notes.toLowerCase().includes('stale')) {
    return {
      id: 'PROOF_STALE_DATA',
      name: 'Stale data detected',
      status: ProofStatus.PASS,
      evidenceRefs: ['notes'],
      details: 'Stale data mentioned in notes',
    };
  }
  
  return {
    id: 'PROOF_STALE_DATA',
    name: 'Stale data detected',
    status: ProofStatus.INSUFFICIENT_DATA,
    evidenceRefs: [],
    details: 'Cannot determine data staleness',
  };
}

/**
 * PROOF_NO_REFRESH: No refresh/polling
 */
function proofNoRefresh(pack: IncidentEvidencePack): ProofResult {
  const notes = pack.notes || '';
  
  if (notes.toLowerCase().includes('no refresh') || notes.toLowerCase().includes('not refresh')) {
    return {
      id: 'PROOF_NO_REFRESH',
      name: 'No refresh mechanism',
      status: ProofStatus.PASS,
      evidenceRefs: ['notes'],
      details: 'Missing refresh mentioned in notes',
    };
  }
  
  return {
    id: 'PROOF_NO_REFRESH',
    name: 'No refresh mechanism',
    status: ProofStatus.INSUFFICIENT_DATA,
    evidenceRefs: [],
    details: 'Cannot determine refresh status',
  };
}
