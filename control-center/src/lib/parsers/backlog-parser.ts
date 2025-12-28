/**
 * Backlog File Parser
 * 
 * Parses AFU-9 backlog markdown files into Epic and Issue structures.
 * 
 * Expected format:
 * ```markdown
 * # AFU-9 Backlog v0.6
 * 
 * ## EPIC E1 — Epic Title
 * 
 * - I1 (E1.1): Issue Title 1
 * - I2 (E1.2): Issue Title 2
 * ```
 */

const MAX_ERROR_MESSAGE_LENGTH = 50;

export interface ParsedEpic {
  externalId: string;
  title: string;
  description: string;
  labels: string[];
}

export interface ParsedIssue {
  externalId: string;
  epicExternalId: string;
  title: string;
  body: string;
  labels: string[];
}

export interface ParseResult {
  epics: ParsedEpic[];
  issues: ParsedIssue[];
  errors: Array<{ line: number; message: string }>;
}

/**
 * Parse a backlog markdown file
 * 
 * @param content - Raw markdown content
 * @returns Parsed epics and issues with any parse errors
 */
export function parseBacklogFile(content: string): ParseResult {
  const lines = content.split('\n');
  const epics: ParsedEpic[] = [];
  const issues: ParsedIssue[] = [];
  const errors: Array<{ line: number; message: string }> = [];
  
  let currentEpic: ParsedEpic | null = null;
  let lineNumber = 0;
  
  for (const line of lines) {
    lineNumber++;
    const trimmedLine = line.trim();
    
    // Skip empty lines and main heading
    if (!trimmedLine || trimmedLine.startsWith('# AFU-9 Backlog')) {
      continue;
    }
    
    // Parse Epic header: ## EPIC E1 — Epic Title
    const epicMatch = trimmedLine.match(/^##\s+EPIC\s+([A-Z0-9]+)\s+[—–-]\s+(.+)$/i);
    if (epicMatch) {
      const externalId = epicMatch[1].toUpperCase();
      const title = epicMatch[2].trim();
      
      currentEpic = {
        externalId,
        title: `EPIC ${externalId} — ${title}`,
        description: '',
        labels: ['epic'],
      };
      
      epics.push(currentEpic);
      continue;
    }
    
    // Parse Issue line: - I1 (E1.1): Issue Title
    const issueMatch = trimmedLine.match(/^-\s+([A-Z0-9]+)\s+\(([^)]+)\):\s+(.+)$/i);
    if (issueMatch) {
      if (!currentEpic) {
        errors.push({
          line: lineNumber,
          message: 'Issue found before any Epic declaration',
        });
        continue;
      }
      
      const externalId = issueMatch[1].toUpperCase();
      const displayId = issueMatch[2].trim();
      const title = issueMatch[3].trim();
      
      issues.push({
        externalId,
        epicExternalId: currentEpic.externalId,
        title: `${displayId}: ${title}`,
        body: `**Epic:** ${currentEpic.title}\n**Issue ID:** ${displayId}`,
        labels: ['issue', currentEpic.externalId.toLowerCase()],
      });
      continue;
    }
    
    // If line doesn't match any pattern and is not empty, log as potential error
    if (trimmedLine && !trimmedLine.startsWith('#')) {
      // Provide specific error messages based on what the line starts with
      if (trimmedLine.startsWith('##')) {
        errors.push({
          line: lineNumber,
          message: `Epic line doesn't match expected format. Expected: "## EPIC <ID> — <Title>". Got: "${trimmedLine.substring(0, MAX_ERROR_MESSAGE_LENGTH)}..."`,
        });
      } else if (trimmedLine.startsWith('-')) {
        errors.push({
          line: lineNumber,
          message: `Issue line doesn't match expected format. Expected: "- <ID> (<DisplayID>): <Title>". Got: "${trimmedLine.substring(0, MAX_ERROR_MESSAGE_LENGTH)}..."`,
        });
      }
    }
  }
  
  return {
    epics,
    issues,
    errors,
  };
}

/**
 * Validate parsed backlog structure
 * 
 * @param result - Parse result to validate
 * @returns Validation errors or null if valid
 */
export function validateParseResult(result: ParseResult): string[] {
  const validationErrors: string[] = [];
  
  // Check for duplicate epic IDs
  const epicIds = new Set<string>();
  for (const epic of result.epics) {
    if (epicIds.has(epic.externalId)) {
      validationErrors.push(`Duplicate Epic ID: ${epic.externalId}`);
    }
    epicIds.add(epic.externalId);
  }
  
  // Check for duplicate issue IDs
  const issueIds = new Set<string>();
  for (const issue of result.issues) {
    if (issueIds.has(issue.externalId)) {
      validationErrors.push(`Duplicate Issue ID: ${issue.externalId}`);
    }
    issueIds.add(issue.externalId);
  }
  
  // Check that all issues reference valid epics
  for (const issue of result.issues) {
    if (!epicIds.has(issue.epicExternalId)) {
      validationErrors.push(
        `Issue ${issue.externalId} references non-existent Epic ${issue.epicExternalId}`
      );
    }
  }
  
  // Ensure we have at least one epic
  if (result.epics.length === 0) {
    validationErrors.push('No epics found in file');
  }
  
  return validationErrors;
}
