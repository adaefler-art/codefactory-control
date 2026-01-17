/**
 * No-Questions Directive Detector (P1.1)
 * 
 * Detects user directive to skip interview loops and use deterministic defaults.
 * 
 * Triggers: "No questions", "keine Rückfragen", "keine Fragen", "don't ask"
 * 
 * When detected:
 * - Agent should not ask follow-up questions
 * - Use deterministic defaults for missing fields
 * - Execute save_issue_draft -> validate -> commit workflow automatically
 */

/**
 * Pattern matchers for no-questions directive
 */
const NO_QUESTIONS_PATTERNS = [
  /no\s*questions?/i,
  /keine\s*r[üu]ckfragen?/i,
  /keine\s*fragen?/i,
  /don'?t\s*ask/i,
  /no\s*interview/i,
  /skip\s*questions?/i,
  /no\s*clarification/i,
  /ohne\s*nachfragen?/i,
];

/**
 * Detect if user message contains no-questions directive
 * 
 * @param message - User message to check
 * @returns true if no-questions directive is detected
 */
export function hasNoQuestionsDirective(message: string): boolean {
  const normalizedMessage = message.toLowerCase().trim();
  return NO_QUESTIONS_PATTERNS.some(pattern => pattern.test(normalizedMessage));
}

/**
 * Deterministic defaults for missing IssueDraft fields (P1.1)
 * 
 * When no-questions directive is active, use these defaults
 * to avoid interview loops.
 */
export interface DeterministicDefaults {
  title: string;
  body: string;
  acceptanceCriteria: string[];
  owner: string;
  repo: string;
}

/**
 * Get default owner/repo from environment or use fallback
 */
function getDefaultRepo(): { owner: string; repo: string } {
  const owner = process.env.GITHUB_DEFAULT_OWNER || process.env.NEXT_PUBLIC_GITHUB_OWNER || 'adaefler-art';
  const repo = process.env.GITHUB_DEFAULT_REPO || process.env.NEXT_PUBLIC_GITHUB_REPO || 'codefactory-control';
  return { owner, repo };
}

/**
 * Generate deterministic defaults for missing fields
 * 
 * @param canonicalId - The canonical ID to derive title from
 * @returns Deterministic defaults object
 */
export function getDeterministicDefaults(canonicalId: string): DeterministicDefaults {
  const { owner, repo } = getDefaultRepo();
  
  return {
    title: canonicalId,
    body: '',
    acceptanceCriteria: [],
    owner,
    repo,
  };
}

/**
 * Missing field error for structured error response (P1.1)
 */
export interface MissingFieldsError {
  code: 'MISSING_FIELDS';
  fields: string[];
  message: string;
}

/**
 * Create a structured missing fields error
 * 
 * @param fields - Array of field names that are still invalid
 * @returns Structured error object
 */
export function createMissingFieldsError(fields: string[]): MissingFieldsError {
  return {
    code: 'MISSING_FIELDS',
    fields,
    message: `Draft invalid after defaults. Missing or invalid fields: ${fields.join(', ')}`,
  };
}

/**
 * Apply deterministic defaults to an IssueDraft
 * 
 * Fills in missing required fields with defaults.
 * Does NOT override existing values.
 * 
 * @param draft - Partial or complete IssueDraft
 * @param canonicalId - Canonical ID (required, used for title default)
 * @returns Draft with defaults applied
 */
export function applyDeterministicDefaults(
  draft: Record<string, unknown>,
  canonicalId: string
): Record<string, unknown> {
  const defaults = getDeterministicDefaults(canonicalId);
  
  return {
    ...draft,
    // Required fields with defaults
    title: draft.title || defaults.title,
    canonicalId: draft.canonicalId || canonicalId,
    body: draft.body !== undefined ? draft.body : defaults.body,
    acceptanceCriteria: Array.isArray(draft.acceptanceCriteria) && draft.acceptanceCriteria.length > 0
      ? draft.acceptanceCriteria
      : defaults.acceptanceCriteria,
    // Default type and priority
    type: draft.type || 'feat',
    priority: draft.priority || 'P2',
    // Default labels and dependencies
    labels: Array.isArray(draft.labels) ? draft.labels : [],
    dependsOn: Array.isArray(draft.dependsOn) ? draft.dependsOn : [],
    // Default verification
    verify: draft.verify || {
      commands: [],
      expected: [],
    },
    // Default guards
    guards: draft.guards || {
      env: 'staging',
      prodBlocked: true,
    },
    // Default targets
    targets: draft.targets || {
      repo: {
        owner: defaults.owner,
        repo: defaults.repo,
      },
    },
  };
}
