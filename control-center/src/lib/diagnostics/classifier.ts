/**
 * Deterministic Incident Classifier
 * 
 * Rules-based classifier for INTENT authoring incidents.
 * No LLM dependency - purely deterministic classification.
 */

import type { IncidentEvidencePack } from './incidentSchema';

/**
 * Classification Codes
 */
export enum ClassificationCode {
  C1_MISSING_READ_PATH = 'C1_MISSING_READ_PATH',
  C2_READ_ROUTE_MISSING_404 = 'C2_READ_ROUTE_MISSING_404',
  C3_AUTH_MISMATCH = 'C3_AUTH_MISMATCH',
  C4_AGENT_TEXT_ONLY = 'C4_AGENT_TEXT_ONLY',
  C5_TOOL_EXEC_FAILED = 'C5_TOOL_EXEC_FAILED',
  C6_SCHEMA_MISMATCH = 'C6_SCHEMA_MISMATCH',
  C7_REFRESH_WIRING_MISSING = 'C7_REFRESH_WIRING_MISSING',
}

/**
 * Required Proof IDs for each classification
 */
export const CLASSIFICATION_PROOFS: Record<ClassificationCode, string[]> = {
  [ClassificationCode.C1_MISSING_READ_PATH]: ['PROOF_GET_404', 'PROOF_POST_SUCCESS'],
  [ClassificationCode.C2_READ_ROUTE_MISSING_404]: ['PROOF_GET_404'],
  [ClassificationCode.C3_AUTH_MISMATCH]: ['PROOF_AUTH_ERROR', 'PROOF_401_403'],
  [ClassificationCode.C4_AGENT_TEXT_ONLY]: ['PROOF_TOOL_CALL_MISSING', 'PROOF_TEXT_RESPONSE'],
  [ClassificationCode.C5_TOOL_EXEC_FAILED]: ['PROOF_TOOL_ERROR'],
  [ClassificationCode.C6_SCHEMA_MISMATCH]: ['PROOF_VALIDATION_ERROR'],
  [ClassificationCode.C7_REFRESH_WIRING_MISSING]: ['PROOF_STALE_DATA', 'PROOF_NO_REFRESH'],
};

/**
 * Classification metadata
 */
export interface ClassificationMeta {
  code: ClassificationCode;
  title: string;
  description: string;
  requiredProofs: string[];
}

/**
 * All classification metadata
 */
export const CLASSIFICATIONS: Record<ClassificationCode, ClassificationMeta> = {
  [ClassificationCode.C1_MISSING_READ_PATH]: {
    code: ClassificationCode.C1_MISSING_READ_PATH,
    title: 'Missing GET Endpoint for Issue Draft',
    description: 'POST/PUT operations succeed but GET endpoint returns 404, causing NO_DRAFT status',
    requiredProofs: CLASSIFICATION_PROOFS[ClassificationCode.C1_MISSING_READ_PATH],
  },
  [ClassificationCode.C2_READ_ROUTE_MISSING_404]: {
    code: ClassificationCode.C2_READ_ROUTE_MISSING_404,
    title: 'Read Route Missing (404)',
    description: 'GET endpoint not implemented or route missing',
    requiredProofs: CLASSIFICATION_PROOFS[ClassificationCode.C2_READ_ROUTE_MISSING_404],
  },
  [ClassificationCode.C3_AUTH_MISMATCH]: {
    code: ClassificationCode.C3_AUTH_MISMATCH,
    title: 'Authentication Mismatch',
    description: 'Authentication/authorization errors (401/403)',
    requiredProofs: CLASSIFICATION_PROOFS[ClassificationCode.C3_AUTH_MISMATCH],
  },
  [ClassificationCode.C4_AGENT_TEXT_ONLY]: {
    code: ClassificationCode.C4_AGENT_TEXT_ONLY,
    title: 'Agent Responding Text-Only (No Tool Calls)',
    description: 'INTENT agent returns text without making expected tool calls',
    requiredProofs: CLASSIFICATION_PROOFS[ClassificationCode.C4_AGENT_TEXT_ONLY],
  },
  [ClassificationCode.C5_TOOL_EXEC_FAILED]: {
    code: ClassificationCode.C5_TOOL_EXEC_FAILED,
    title: 'Tool Execution Failed',
    description: 'INTENT tool execution encountered errors',
    requiredProofs: CLASSIFICATION_PROOFS[ClassificationCode.C5_TOOL_EXEC_FAILED],
  },
  [ClassificationCode.C6_SCHEMA_MISMATCH]: {
    code: ClassificationCode.C6_SCHEMA_MISMATCH,
    title: 'Schema Validation Mismatch',
    description: 'Request/response schema validation failed',
    requiredProofs: CLASSIFICATION_PROOFS[ClassificationCode.C6_SCHEMA_MISMATCH],
  },
  [ClassificationCode.C7_REFRESH_WIRING_MISSING]: {
    code: ClassificationCode.C7_REFRESH_WIRING_MISSING,
    title: 'Refresh/Polling Wiring Missing',
    description: 'UI not refreshing or polling missing for data updates',
    requiredProofs: CLASSIFICATION_PROOFS[ClassificationCode.C7_REFRESH_WIRING_MISSING],
  },
};

/**
 * Classification Result
 */
export interface ClassificationResult {
  code: ClassificationCode;
  title: string;
  description: string;
  confidence: number; // 0.0 to 1.0
  matchedRules: string[];
  requiredProofs: string[];
}

/**
 * Classify incident based on evidence pack
 * 
 * Uses deterministic rules to classify the incident.
 * 
 * @param pack - Evidence pack
 * @returns Classification result
 */
export function classifyIncident(pack: IncidentEvidencePack): ClassificationResult {
  // Check for C1: Missing GET endpoint (POST/PUT work, GET 404)
  if (checkC1MissingReadPath(pack)) {
    const meta = CLASSIFICATIONS[ClassificationCode.C1_MISSING_READ_PATH];
    return {
      code: meta.code,
      title: meta.title,
      description: meta.description,
      confidence: 0.95,
      matchedRules: ['GET_404_POST_SUCCESS'],
      requiredProofs: meta.requiredProofs,
    };
  }
  
  // Check for C2: Read route missing (GET 404)
  if (checkC2ReadRouteMissing(pack)) {
    const meta = CLASSIFICATIONS[ClassificationCode.C2_READ_ROUTE_MISSING_404];
    return {
      code: meta.code,
      title: meta.title,
      description: meta.description,
      confidence: 0.85,
      matchedRules: ['GET_404'],
      requiredProofs: meta.requiredProofs,
    };
  }
  
  // Check for C3: Auth mismatch
  if (checkC3AuthMismatch(pack)) {
    const meta = CLASSIFICATIONS[ClassificationCode.C3_AUTH_MISMATCH];
    return {
      code: meta.code,
      title: meta.title,
      description: meta.description,
      confidence: 0.90,
      matchedRules: ['AUTH_ERROR_401_403'],
      requiredProofs: meta.requiredProofs,
    };
  }
  
  // Check for C4: Agent text-only
  if (checkC4AgentTextOnly(pack)) {
    const meta = CLASSIFICATIONS[ClassificationCode.C4_AGENT_TEXT_ONLY];
    return {
      code: meta.code,
      title: meta.title,
      description: meta.description,
      confidence: 0.80,
      matchedRules: ['NO_TOOL_CALLS'],
      requiredProofs: meta.requiredProofs,
    };
  }
  
  // Check for C5: Tool execution failed
  if (checkC5ToolExecFailed(pack)) {
    const meta = CLASSIFICATIONS[ClassificationCode.C5_TOOL_EXEC_FAILED];
    return {
      code: meta.code,
      title: meta.title,
      description: meta.description,
      confidence: 0.85,
      matchedRules: ['TOOL_ERROR'],
      requiredProofs: meta.requiredProofs,
    };
  }
  
  // Check for C6: Schema mismatch
  if (checkC6SchemaMismatch(pack)) {
    const meta = CLASSIFICATIONS[ClassificationCode.C6_SCHEMA_MISMATCH];
    return {
      code: meta.code,
      title: meta.title,
      description: meta.description,
      confidence: 0.90,
      matchedRules: ['VALIDATION_ERROR'],
      requiredProofs: meta.requiredProofs,
    };
  }
  
  // Check for C7: Refresh wiring missing
  if (checkC7RefreshWiringMissing(pack)) {
    const meta = CLASSIFICATIONS[ClassificationCode.C7_REFRESH_WIRING_MISSING];
    return {
      code: meta.code,
      title: meta.title,
      description: meta.description,
      confidence: 0.75,
      matchedRules: ['STALE_DATA'],
      requiredProofs: meta.requiredProofs,
    };
  }
  
  // Default: C2 (most generic)
  const meta = CLASSIFICATIONS[ClassificationCode.C2_READ_ROUTE_MISSING_404];
  return {
    code: meta.code,
    title: meta.title,
    description: meta.description,
    confidence: 0.50,
    matchedRules: ['DEFAULT'],
    requiredProofs: meta.requiredProofs,
  };
}

/**
 * Check for C1: Missing GET endpoint (POST/PUT work, GET 404)
 */
function checkC1MissingReadPath(pack: IncidentEvidencePack): boolean {
  const snippets = pack.apiSnippets || [];
  
  // Look for GET 404 on draft endpoint
  const hasGet404 = snippets.some(s => 
    s.method === 'GET' && 
    s.status === 404 &&
    s.endpoint.includes('/issue-draft')
  );
  
  // Look for successful POST or PUT on same endpoint
  const hasPostOrPutSuccess = snippets.some(s =>
    (s.method === 'POST' || s.method === 'PUT') &&
    s.status === 200 &&
    s.endpoint.includes('/issue-draft')
  );
  
  return hasGet404 && hasPostOrPutSuccess;
}

/**
 * Check for C2: Read route missing (GET 404)
 */
function checkC2ReadRouteMissing(pack: IncidentEvidencePack): boolean {
  const snippets = pack.apiSnippets || [];
  
  return snippets.some(s => 
    s.method === 'GET' && 
    s.status === 404
  );
}

/**
 * Check for C3: Auth mismatch
 */
function checkC3AuthMismatch(pack: IncidentEvidencePack): boolean {
  const snippets = pack.apiSnippets || [];
  
  return snippets.some(s => 
    s.status === 401 || s.status === 403
  );
}

/**
 * Check for C4: Agent text-only (no tool calls)
 */
function checkC4AgentTextOnly(pack: IncidentEvidencePack): boolean {
  const logs = pack.serverLogRefs || [];
  const notes = pack.notes || '';
  const lowerNotes = notes.toLowerCase();
  
  // Check logs for "no tool calls" indicators
  const hasNoToolCallsLog = logs.some(log => {
    const lowerMessage = log.message.toLowerCase();
    return lowerMessage.includes('no tool') ||
      lowerMessage.includes('text only') ||
      lowerMessage.includes('agent did not call');
  });
  
  // Check notes
  const hasNoToolCallsNote = lowerNotes.includes('no tool') ||
    lowerNotes.includes('text only');
  
  return hasNoToolCallsLog || hasNoToolCallsNote;
}

/**
 * Check for C5: Tool execution failed
 */
function checkC5ToolExecFailed(pack: IncidentEvidencePack): boolean {
  const logs = pack.serverLogRefs || [];
  
  return logs.some(log =>
    log.logLevel === 'ERROR' &&
    (log.message.toLowerCase().includes('tool') ||
     log.message.toLowerCase().includes('execution failed'))
  );
}

/**
 * Check for C6: Schema mismatch
 */
function checkC6SchemaMismatch(pack: IncidentEvidencePack): boolean {
  const logs = pack.serverLogRefs || [];
  const snippets = pack.apiSnippets || [];
  
  const hasValidationLog = logs.some(log =>
    log.message.toLowerCase().includes('validation') ||
    log.message.toLowerCase().includes('schema')
  );
  
  const has400 = snippets.some(s => s.status === 400);
  
  return hasValidationLog || has400;
}

/**
 * Check for C7: Refresh wiring missing
 */
function checkC7RefreshWiringMissing(pack: IncidentEvidencePack): boolean {
  const notes = pack.notes || '';
  const lowerNotes = notes.toLowerCase();
  
  return lowerNotes.includes('stale') ||
    lowerNotes.includes('not refresh') ||
    lowerNotes.includes('no refresh');
}
