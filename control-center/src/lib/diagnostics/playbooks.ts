/**
 * Playbook Registry
 * 
 * Maps classification codes to remediation playbooks.
 * Each playbook contains patch plan, verification checks, and Copilot prompt.
 */

import { ClassificationCode } from './classifier';

/**
 * Patch Plan Entry
 */
export interface PatchPlanEntry {
  file: string;
  intent: string;
  priority: 'HIGH' | 'MEDIUM' | 'LOW';
}

/**
 * Verification Check
 */
export interface VerificationCheck {
  id: string;
  description: string;
  type: 'API' | 'UI' | 'LOG';
  command?: string;
}

/**
 * Playbook Entry
 */
export interface PlaybookEntry {
  id: string;
  classificationCode: ClassificationCode;
  title: string;
  patchPlan: PatchPlanEntry[];
  verificationChecks: VerificationCheck[];
  copilotPrompt: string;
  estimatedEffort: string;
}

/**
 * Playbook Registry
 */
export const PLAYBOOK_REGISTRY: Record<ClassificationCode, PlaybookEntry> = {
  /**
   * C1: Missing GET Endpoint for Issue Draft
   * 
   * Full implementation with complete patch plan and verification.
   */
  [ClassificationCode.C1_MISSING_READ_PATH]: {
    id: 'PB-C1-MISSING-READ-PATH',
    classificationCode: ClassificationCode.C1_MISSING_READ_PATH,
    title: 'Add Missing GET Endpoint for Issue Draft',
    patchPlan: [
      {
        file: 'control-center/app/api/intent/sessions/[id]/issue-draft/route.ts',
        intent: 'Implement GET handler to fetch existing draft from database',
        priority: 'HIGH',
      },
      {
        file: 'control-center/src/lib/db/intentIssueDrafts.ts',
        intent: 'Add getIssueDraft() function if not present',
        priority: 'HIGH',
      },
      {
        file: 'control-center/__tests__/api/intent-draft-access-e2e.test.ts',
        intent: 'Add test case for GET endpoint returning draft or NO_DRAFT state',
        priority: 'MEDIUM',
      },
    ],
    verificationChecks: [
      {
        id: 'V1_GET_ENDPOINT_EXISTS',
        description: 'Verify GET endpoint returns 200 for existing draft',
        type: 'API',
        command: 'curl -X GET http://localhost:3000/api/intent/sessions/[id]/issue-draft',
      },
      {
        id: 'V2_GET_NO_DRAFT',
        description: 'Verify GET endpoint returns deterministic NO_DRAFT for new session',
        type: 'API',
      },
      {
        id: 'V3_DRAFT_VISIBLE',
        description: 'Verify INTENT UI shows draft after GET succeeds',
        type: 'UI',
      },
    ],
    copilotPrompt: `Implement the missing GET endpoint for INTENT issue drafts.

**Problem**: The INTENT UI shows "NO DRAFT" because the GET endpoint at \`/api/intent/sessions/[id]/issue-draft\` returns 404, even though POST/PUT operations succeed.

**Root Cause**: The GET handler is missing or not properly wired in the route file.

**Required Changes**:

1. **File**: \`control-center/app/api/intent/sessions/[id]/issue-draft/route.ts\`
   - Add \`export async function GET(request: NextRequest, { params }: { params: { id: string } })\`
   - Fetch draft from database using session ID
   - Return deterministic states:
     - If draft exists: \`{ status: 'DRAFT', draft: {...} }\`
     - If no draft: \`{ status: 'NO_DRAFT' }\`
   - Handle errors gracefully with appropriate status codes

2. **File**: \`control-center/src/lib/db/intentIssueDrafts.ts\`
   - Verify \`getIssueDraft(sessionId: string)\` function exists
   - If missing, implement it to query \`intent_issue_drafts\` table
   - Return null if no draft found (for deterministic NO_DRAFT state)

3. **Testing**:
   - Add test case in \`__tests__/api/intent-draft-access-e2e.test.ts\`
   - Test GET returns 200 with draft when draft exists
   - Test GET returns 200 with NO_DRAFT status when no draft exists
   - Test GET returns 404 or 400 for invalid session ID

**Verification**:
After implementation, verify:
- GET endpoint returns 200 (not 404)
- INTENT UI correctly shows draft content or "Start Drafting" button
- No stale data or refresh issues

**Reference**: Issue I902 (Draft Access Reliability)`,
    estimatedEffort: '1-2 hours',
  },

  /**
   * C2: Read Route Missing (404)
   * 
   * Minimal implementation (not fully specified in MVP).
   */
  [ClassificationCode.C2_READ_ROUTE_MISSING_404]: {
    id: 'PB-C2-READ-ROUTE-MISSING',
    classificationCode: ClassificationCode.C2_READ_ROUTE_MISSING_404,
    title: 'Implement Missing Read Route',
    patchPlan: [
      {
        file: 'TBD - depends on missing route',
        intent: 'Implement the missing GET endpoint',
        priority: 'HIGH',
      },
    ],
    verificationChecks: [
      {
        id: 'V1_ROUTE_EXISTS',
        description: 'Verify route returns 200 instead of 404',
        type: 'API',
      },
    ],
    copilotPrompt: 'Implement the missing GET endpoint that is returning 404. Review the evidence pack to identify the specific endpoint and implement appropriate handler.',
    estimatedEffort: '1-3 hours',
  },

  /**
   * C3: Authentication Mismatch
   */
  [ClassificationCode.C3_AUTH_MISMATCH]: {
    id: 'PB-C3-AUTH-MISMATCH',
    classificationCode: ClassificationCode.C3_AUTH_MISMATCH,
    title: 'Fix Authentication/Authorization Issues',
    patchPlan: [
      {
        file: 'TBD - depends on auth layer',
        intent: 'Fix authentication or authorization logic',
        priority: 'HIGH',
      },
    ],
    verificationChecks: [
      {
        id: 'V1_AUTH_SUCCESS',
        description: 'Verify authenticated requests succeed',
        type: 'API',
      },
    ],
    copilotPrompt: 'Investigate and fix authentication/authorization errors. Check for missing auth headers, expired tokens, or permission mismatches.',
    estimatedEffort: '2-4 hours',
  },

  /**
   * C4: Agent Text-Only (No Tool Calls)
   */
  [ClassificationCode.C4_AGENT_TEXT_ONLY]: {
    id: 'PB-C4-AGENT-TEXT-ONLY',
    classificationCode: ClassificationCode.C4_AGENT_TEXT_ONLY,
    title: 'Fix Agent Tool Calling',
    patchPlan: [
      {
        file: 'control-center/src/lib/intent-agent.ts',
        intent: 'Review and fix tool registration or prompting',
        priority: 'HIGH',
      },
    ],
    verificationChecks: [
      {
        id: 'V1_TOOL_CALLS',
        description: 'Verify agent makes expected tool calls',
        type: 'LOG',
      },
    ],
    copilotPrompt: 'Investigate why INTENT agent is not calling tools. Check tool registration, prompt engineering, and agent configuration.',
    estimatedEffort: '2-4 hours',
  },

  /**
   * C5: Tool Execution Failed
   */
  [ClassificationCode.C5_TOOL_EXEC_FAILED]: {
    id: 'PB-C5-TOOL-EXEC-FAILED',
    classificationCode: ClassificationCode.C5_TOOL_EXEC_FAILED,
    title: 'Fix Tool Execution Errors',
    patchPlan: [
      {
        file: 'control-center/src/lib/intent-agent-tool-executor.ts',
        intent: 'Debug and fix tool execution errors',
        priority: 'HIGH',
      },
    ],
    verificationChecks: [
      {
        id: 'V1_TOOL_SUCCESS',
        description: 'Verify tool executes without errors',
        type: 'LOG',
      },
    ],
    copilotPrompt: 'Debug tool execution failures. Check tool implementation, error handling, and input validation.',
    estimatedEffort: '1-3 hours',
  },

  /**
   * C6: Schema Mismatch
   */
  [ClassificationCode.C6_SCHEMA_MISMATCH]: {
    id: 'PB-C6-SCHEMA-MISMATCH',
    classificationCode: ClassificationCode.C6_SCHEMA_MISMATCH,
    title: 'Fix Schema Validation Issues',
    patchPlan: [
      {
        file: 'TBD - depends on schema location',
        intent: 'Update schema or fix validation logic',
        priority: 'HIGH',
      },
    ],
    verificationChecks: [
      {
        id: 'V1_VALIDATION_PASS',
        description: 'Verify schema validation passes',
        type: 'API',
      },
    ],
    copilotPrompt: 'Fix schema validation errors. Check for mismatched types, missing required fields, or outdated schema definitions.',
    estimatedEffort: '1-2 hours',
  },

  /**
   * C7: Refresh/Polling Wiring Missing
   */
  [ClassificationCode.C7_REFRESH_WIRING_MISSING]: {
    id: 'PB-C7-REFRESH-WIRING',
    classificationCode: ClassificationCode.C7_REFRESH_WIRING_MISSING,
    title: 'Add Missing Refresh/Polling Logic',
    patchPlan: [
      {
        file: 'TBD - depends on UI component',
        intent: 'Add polling or refresh mechanism to UI',
        priority: 'MEDIUM',
      },
    ],
    verificationChecks: [
      {
        id: 'V1_DATA_REFRESHES',
        description: 'Verify data refreshes automatically',
        type: 'UI',
      },
    ],
    copilotPrompt: 'Add missing refresh/polling logic to keep UI data up-to-date. Consider using React hooks or polling intervals.',
    estimatedEffort: '2-3 hours',
  },
};

/**
 * Get playbook for classification code
 * 
 * @param code - Classification code
 * @returns Playbook entry
 */
export function getPlaybook(code: ClassificationCode): PlaybookEntry {
  return PLAYBOOK_REGISTRY[code];
}

/**
 * Get all playbooks
 * 
 * @returns Array of all playbook entries
 */
export function getAllPlaybooks(): PlaybookEntry[] {
  return Object.values(PLAYBOOK_REGISTRY);
}
