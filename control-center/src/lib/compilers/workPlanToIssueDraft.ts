/**
 * Work Plan to Issue Draft Compiler
 * V09-I05: Compile Plan → Draft (Deterministischer Compiler)
 * 
 * Transforms a WorkPlanV1 into an IssueDraft deterministically.
 * 
 * NON-NEGOTIABLES:
 * - Deterministic compilation (same plan → same draft)
 * - Stable ordering and formatting
 * - No randomness or timestamps in draft content
 * - CanonicalId derived when possible, placeholder otherwise
 * - Output conforms to IssueDraft schema (E81.1)
 */

import type { WorkPlanContentV1 } from '../schemas/workPlan';
import type { IssueDraft } from '../schemas/issueDraft';
import { ISSUE_DRAFT_VERSION } from '../schemas/issueDraft';
import { createHash } from 'crypto';

/**
 * Result of compiling a work plan to issue draft
 */
export interface CompilePlanToDraftResult {
  success: true;
  draft: IssueDraft;
  bodyHash: string;
}

export interface CompilePlanToDraftError {
  success: false;
  error: string;
  code?: string;
}

export type CompilePlanResult = CompilePlanToDraftResult | CompilePlanToDraftError;

/**
 * Compile a work plan into an issue draft
 * 
 * This function deterministically transforms a WorkPlanV1 into an IssueDraft.
 * All output is stable and reproducible for the same input.
 * 
 * @param plan - Work plan content to compile
 * @returns Compilation result with draft or error
 */
export function compileWorkPlanToIssueDraftV1(
  plan: WorkPlanContentV1
): CompilePlanResult {
  try {
    // Derive title from first goal or use placeholder
    const title = deriveTitle(plan);
    
    // Build body from plan content
    const body = buildBody(plan);
    
    // Derive canonical ID from context if possible
    const canonicalId = deriveCanonicalId(plan);
    
    // Extract labels from context/goals
    const labels = deriveLabels(plan);
    
    // Build acceptance criteria from goals and todos
    const acceptanceCriteria = deriveAcceptanceCriteria(plan);
    
    // Build verification from context or use default
    const verify = deriveVerification(plan);
    
    // Determine priority from goals
    const priority = derivePriority(plan);
    
    // Build dependencies from context
    const dependsOn = deriveDependencies(plan);
    
    // Create the draft
    const draft: IssueDraft = {
      issueDraftVersion: ISSUE_DRAFT_VERSION,
      title,
      body,
      type: 'issue', // Plans default to issues, not epics
      canonicalId,
      labels,
      dependsOn,
      priority,
      acceptanceCriteria,
      verify,
      guards: {
        env: 'development',
        prodBlocked: true,
      },
    };
    
    // Compute body hash for tracking
    const bodyHash = computeBodyHash(body);
    
    return {
      success: true,
      draft,
      bodyHash,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown compilation error',
      code: 'COMPILATION_FAILED',
    };
  }
}

/**
 * Derive title from plan content
 * Priority: first goal text > context summary > placeholder
 */
function deriveTitle(plan: WorkPlanContentV1): string {
  // Try first goal
  if (plan.goals && plan.goals.length > 0) {
    const firstGoal = plan.goals[0];
    // Truncate to 200 chars max (IssueDraft title limit)
    const title = firstGoal.text.trim();
    return title.length > 200 ? title.substring(0, 197) + '...' : title;
  }
  
  // Try context (first line)
  if (plan.context && plan.context.trim()) {
    const firstLine = plan.context.trim().split('\n')[0];
    const title = firstLine.trim();
    return title.length > 200 ? title.substring(0, 197) + '...' : title;
  }
  
  // Placeholder
  return 'Work Plan: [Untitled]';
}

/**
 * Build body content from plan
 * Includes all sections in stable order
 */
function buildBody(plan: WorkPlanContentV1): string {
  const sections: string[] = [];
  
  // Add canonical ID marker (will be replaced if derived)
  sections.push('Canonical-ID: [TBD]');
  sections.push('');
  
  // Context section
  if (plan.context && plan.context.trim()) {
    sections.push('## Context');
    sections.push('');
    sections.push(plan.context.trim());
    sections.push('');
  }
  
  // Goals section
  if (plan.goals && plan.goals.length > 0) {
    sections.push('## Goals');
    sections.push('');
    // Sort goals by priority, then by text for determinism
    const sortedGoals = [...plan.goals].sort((a, b) => {
      const priorityOrder = { HIGH: 0, MEDIUM: 1, LOW: 2 };
      const aPriority = priorityOrder[a.priority || 'MEDIUM'];
      const bPriority = priorityOrder[b.priority || 'MEDIUM'];
      
      if (aPriority !== bPriority) {
        return aPriority - bPriority;
      }
      
      return a.text.localeCompare(b.text);
    });
    
    sortedGoals.forEach((goal, index) => {
      const checkbox = goal.completed ? '[x]' : '[ ]';
      const priorityTag = goal.priority ? ` (${goal.priority})` : '';
      sections.push(`${index + 1}. ${checkbox} ${goal.text}${priorityTag}`);
    });
    sections.push('');
  }
  
  // Options section
  if (plan.options && plan.options.length > 0) {
    sections.push('## Options Considered');
    sections.push('');
    // Sort options by title for determinism
    const sortedOptions = [...plan.options].sort((a, b) => a.title.localeCompare(b.title));
    
    sortedOptions.forEach((option, index) => {
      sections.push(`### Option ${index + 1}: ${option.title}`);
      sections.push('');
      sections.push(option.description);
      sections.push('');
      
      if (option.pros && option.pros.length > 0) {
        sections.push('**Pros:**');
        option.pros.forEach(pro => sections.push(`- ${pro}`));
        sections.push('');
      }
      
      if (option.cons && option.cons.length > 0) {
        sections.push('**Cons:**');
        option.cons.forEach(con => sections.push(`- ${con}`));
        sections.push('');
      }
    });
  }
  
  // Todos section
  if (plan.todos && plan.todos.length > 0) {
    sections.push('## Tasks');
    sections.push('');
    // Sort todos by text for determinism
    const sortedTodos = [...plan.todos].sort((a, b) => a.text.localeCompare(b.text));
    
    sortedTodos.forEach(todo => {
      const checkbox = todo.completed ? '[x]' : '[ ]';
      sections.push(`- ${checkbox} ${todo.text}`);
    });
    sections.push('');
  }
  
  // Notes section
  if (plan.notes && plan.notes.trim()) {
    sections.push('## Additional Notes');
    sections.push('');
    sections.push(plan.notes.trim());
    sections.push('');
  }
  
  const body = sections.join('\n').trim();
  
  // Ensure minimum length (10 chars for IssueDraft schema)
  if (body.length < 10) {
    return 'Canonical-ID: [TBD]\n\n## Work Plan\n\nNo content available.';
  }
  
  return body;
}

/**
 * Derive canonical ID from plan content
 * Looks for patterns like "I8xx", "E81.x", "CID:xxx" in context/goals
 * Returns placeholder if not found
 */
function deriveCanonicalId(plan: WorkPlanContentV1): string {
  const canonicalPattern = /\b(I8\d{2}|E81\.\d+)\b/;
  const cidPattern = /\bCID:(I8\d{2}|E81\.\d+)\b/;
  
  // Check context
  if (plan.context) {
    // Check for CID: prefix first
    const cidMatch = plan.context.match(cidPattern);
    if (cidMatch) return cidMatch[1]; // Extract ID from CID:xxx
    
    // Then check for direct ID
    const match = plan.context.match(canonicalPattern);
    if (match) return match[1];
  }
  
  // Check goals
  if (plan.goals) {
    for (const goal of plan.goals) {
      // Check for CID: prefix first
      const cidMatch = goal.text.match(cidPattern);
      if (cidMatch) return cidMatch[1];
      
      // Then check for direct ID
      const match = goal.text.match(canonicalPattern);
      if (match) return match[1];
    }
  }
  
  // Check notes
  if (plan.notes) {
    // Check for CID: prefix first
    const cidMatch = plan.notes.match(cidPattern);
    if (cidMatch) return cidMatch[1];
    
    // Then check for direct ID
    const match = plan.notes.match(canonicalPattern);
    if (match) return match[1];
  }
  
  // Placeholder - no randomness
  return 'CID:TBD';
}

/**
 * Derive labels from plan content
 * Extracts common patterns and returns sorted, deduped array
 */
function deriveLabels(plan: WorkPlanContentV1): string[] {
  const labels = new Set<string>();
  
  // Always add work-plan origin label
  labels.add('from-work-plan');
  
  // Extract from context
  const contextStr = plan.context || '';
  
  // Look for epic references (e.g., "epic:E81", "Epic E81")
  const epicMatches = contextStr.match(/epic[:\s]+(E\d+)/gi);
  if (epicMatches) {
    epicMatches.forEach(match => {
      const epicNum = match.match(/E\d+/i)?.[0];
      if (epicNum) labels.add(`epic:${epicNum.toUpperCase()}`);
    });
  }
  
  // Look for version references (e.g., "v0.8", "V09")
  const versionMatches = contextStr.match(/v\d+(\.\d+)?/gi);
  if (versionMatches) {
    versionMatches.forEach(match => labels.add(match.toLowerCase()));
  }
  
  // Look for layer references (e.g., "layer:B", "Layer A")
  const layerMatches = contextStr.match(/layer[:\s]+([A-D])/gi);
  if (layerMatches) {
    layerMatches.forEach(match => {
      const layer = match.match(/[A-D]/i)?.[0];
      if (layer) labels.add(`layer:${layer.toUpperCase()}`);
    });
  }
  
  // Return as sorted array (max 50 per schema)
  return Array.from(labels).sort((a, b) => a.localeCompare(b)).slice(0, 50);
}

/**
 * Derive acceptance criteria from goals and todos
 * Returns at least one criterion (schema requirement)
 */
function deriveAcceptanceCriteria(plan: WorkPlanContentV1): string[] {
  const criteria: string[] = [];
  
  // Add high-priority goals as acceptance criteria
  if (plan.goals) {
    const highPriorityGoals = plan.goals
      .filter(g => g.priority === 'HIGH')
      .sort((a, b) => a.text.localeCompare(b.text)); // Stable sort
    
    highPriorityGoals.forEach(goal => {
      criteria.push(goal.text.trim());
    });
  }
  
  // If no high-priority goals, use all goals
  if (criteria.length === 0 && plan.goals && plan.goals.length > 0) {
    const sortedGoals = [...plan.goals].sort((a, b) => a.text.localeCompare(b.text));
    sortedGoals.forEach(goal => {
      criteria.push(goal.text.trim());
    });
  }
  
  // If still empty, use a default criterion
  if (criteria.length === 0) {
    criteria.push('Complete all tasks from work plan');
  }
  
  // Cap at 20 (schema limit)
  return criteria.slice(0, 20);
}

/**
 * Derive verification commands
 * Returns default verification or extracts from context
 */
function deriveVerification(plan: WorkPlanContentV1): { commands: string[]; expected: string[] } {
  // Look for verification hints in context/notes
  const contextStr = (plan.context || '') + '\n' + (plan.notes || '');
  
  // Default verification
  const defaultVerify = {
    commands: ['npm run repo:verify'],
    expected: ['All checks pass'],
  };
  
  // Look for command patterns (e.g., "npm test", "npm run build")
  const commandPattern = /(?:run|execute|verify with):\s*`([^`]+)`/gi;
  const commands: string[] = [];
  let match;
  
  while ((match = commandPattern.exec(contextStr)) !== null) {
    commands.push(match[1].trim());
  }
  
  // Reset lastIndex to prevent state issues with global flag
  commandPattern.lastIndex = 0;
  
  if (commands.length > 0) {
    return {
      commands: commands.slice(0, 10), // Max 10 per schema
      expected: ['Tests pass', 'No errors'],
    };
  }
  
  return defaultVerify;
}

/**
 * Derive priority from goals
 * Highest goal priority becomes issue priority
 */
function derivePriority(plan: WorkPlanContentV1): 'P0' | 'P1' | 'P2' {
  if (!plan.goals || plan.goals.length === 0) {
    return 'P2'; // Default low priority
  }
  
  // Map work plan priorities to issue priorities
  const hasHigh = plan.goals.some(g => g.priority === 'HIGH');
  const hasMedium = plan.goals.some(g => g.priority === 'MEDIUM');
  
  if (hasHigh) return 'P1';
  if (hasMedium) return 'P1';
  return 'P2';
}

/**
 * Derive dependencies from context
 * Looks for canonical ID references
 */
function deriveDependencies(plan: WorkPlanContentV1): string[] {
  const deps = new Set<string>();
  const canonicalPattern = /\b(I8\d{2}|E81\.\d+)\b/g;
  const cidPattern = /\bCID:(I8\d{2}|E81\.\d+)\b/g;
  
  // Helper to extract IDs from text
  const extractIds = (text: string) => {
    // Extract from CID: patterns
    let match;
    while ((match = cidPattern.exec(text)) !== null) {
      deps.add(match[1]); // Extract ID from CID:xxx
    }
    
    // Reset lastIndex for next pattern
    cidPattern.lastIndex = 0;
    
    // Extract direct IDs
    while ((match = canonicalPattern.exec(text)) !== null) {
      deps.add(match[1]);
    }
    
    // Reset lastIndex for next use
    canonicalPattern.lastIndex = 0;
  };
  
  // Check context
  if (plan.context) {
    extractIds(plan.context);
  }
  
  // Check notes
  if (plan.notes) {
    extractIds(plan.notes);
  }
  
  // Remove the derived canonicalId itself (can't depend on self)
  const ownId = deriveCanonicalId(plan);
  deps.delete(ownId);
  
  // Return sorted array (max 20 per schema)
  return Array.from(deps).sort((a, b) => a.localeCompare(b)).slice(0, 20);
}

/**
 * Compute SHA-256 hash of body content
 */
function computeBodyHash(body: string): string {
  return createHash('sha256').update(body, 'utf8').digest('hex').substring(0, 12);
}
