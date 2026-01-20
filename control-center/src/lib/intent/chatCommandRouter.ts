/**
 * Chat Command Router
 * 
 * Detects and routes chat commands to the appropriate actions.
 * 
 * Issue: I201.8 - INTENT Chat Command Router
 * Requirements:
 * - R1: Command Detection (minimal, robust)
 * - R3: Deterministisches Verhalten
 * - R4: Fallback to LLM if no command detected
 */

export type CommandType = 
  | "validate"
  | "commit"
  | "publish"
  | "create_issue"
  | "copy_snippet"
  | null; // null = no command detected, fallback to LLM

/**
 * Command detection patterns (DE/EN)
 * 
 * R1: Commands should be detected as "action intents":
 * - validate|validiere|prüfe
 * - commit|committe|versioniere|commit version
 * - publish|github|handoff|publish to github
 * - create issue|issue anlegen|create afu9 issue
 * - copy snippet|export (optional)
 */
const COMMAND_PATTERNS: Record<CommandType, RegExp | null> = {
  validate: /^(?:validate|validiere|prüfe|check)$/i,
  commit: /^(?:commit(?:\s+version)?|committe|versioniere)$/i,
  publish: /^(?:publish(?:\s+to\s+github)?|github|handoff)$/i,
  create_issue: /^(?:create\s+(?:afu9\s+)?issue|issue\s+anlegen|create\s+afu-9\s+issue)$/i,
  copy_snippet: /^(?:copy\s+snippet|export|copy)$/i,
  null: null, // fallback
};

/**
 * Detect command type from user input
 * 
 * R1: Command Detection (minimal, robust)
 * - Trim whitespace and normalize
 * - Match exact patterns (case-insensitive)
 * - Return null if no match (R4: fallback to LLM)
 */
export function detectCommand(input: string): CommandType {
  const trimmed = input.trim();
  
  // Check each command pattern
  for (const [commandType, pattern] of Object.entries(COMMAND_PATTERNS)) {
    if (commandType === "null" || !pattern) continue;
    
    if (pattern.test(trimmed)) {
      return commandType as CommandType;
    }
  }
  
  // R4: No command detected, fallback to LLM
  return null;
}

/**
 * Get a human-readable action name for the command
 */
export function getActionName(command: CommandType): string {
  switch (command) {
    case "validate":
      return "VALIDATE";
    case "commit":
      return "COMMIT_VERSION";
    case "publish":
      return "PUBLISH_TO_GITHUB";
    case "create_issue":
      return "CREATE_AFU9_ISSUE";
    case "copy_snippet":
      return "COPY_SNIPPET";
    default:
      return "UNKNOWN";
  }
}

/**
 * Check if a command requires a draft to be present
 */
export function requiresDraft(command: CommandType): boolean {
  // All commands except null require a draft
  return command !== null;
}

/**
 * Check if a command requires validation to pass
 */
export function requiresValidation(command: CommandType): boolean {
  // Commit, publish, and create_issue require validation
  return command === "commit" || command === "publish" || command === "create_issue";
}
