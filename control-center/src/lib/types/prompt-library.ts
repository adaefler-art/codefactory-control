/**
 * Prompt & Action Library Type Definitions
 * 
 * Defines types for versioned prompts, actions, and their usage tracking.
 * Implements EPIC 6: Prompt & Action Canon for Factory Intelligence.
 */

/**
 * Semantic version change types
 */
export type ChangeType = 'major' | 'minor' | 'patch';

/**
 * Prompt category
 */
export type PromptCategory = 
  | 'analysis' 
  | 'generation' 
  | 'review' 
  | 'planning' 
  | 'debugging'
  | 'deployment'
  | 'monitoring'
  | 'other';

/**
 * Action category
 */
export type ActionCategory =
  | 'github'
  | 'deploy'
  | 'observability'
  | 'workflow'
  | 'agent'
  | 'other';

/**
 * Prompt definition
 */
export interface Prompt {
  id: string;
  name: string;
  category: PromptCategory;
  description: string;
  purpose: string;
  currentVersionId?: string;
  deprecated: boolean;
  deprecatedAt?: Date;
  deprecationReason?: string;
  replacementPromptId?: string;
  createdBy?: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Prompt version
 */
export interface PromptVersion {
  id: string;
  promptId: string;
  version: string; // Semantic version: major.minor.patch
  content: string; // Full prompt text
  systemPrompt?: string; // System prompt for LLM
  userPromptTemplate?: string; // User prompt template with variables
  variables?: Record<string, string>; // Expected variables for template
  modelConfig?: {
    temperature?: number;
    maxTokens?: number;
    topP?: number;
    frequencyPenalty?: number;
    presencePenalty?: number;
  };
  changeType: ChangeType;
  changeDescription: string;
  breakingChanges?: string; // Description of breaking changes
  migrationGuide?: string; // How to migrate from previous version
  validated: boolean;
  validationResults?: Record<string, any>;
  published: boolean;
  publishedAt?: Date;
  publishedBy?: string;
  createdBy?: string;
  createdAt: Date;
}

/**
 * Prompt with current version details
 */
export interface PromptWithVersion extends Prompt {
  currentVersion?: PromptVersion;
  versionCount?: number;
}

/**
 * Action definition
 */
export interface Action {
  id: string;
  name: string;
  category: ActionCategory;
  description: string;
  currentVersionId?: string;
  deprecated: boolean;
  deprecatedAt?: Date;
  deprecationReason?: string;
  replacementActionId?: string;
  createdBy?: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Action version
 */
export interface ActionVersion {
  id: string;
  actionId: string;
  version: string; // Semantic version: major.minor.patch
  toolReference: string; // e.g., "github.createIssue"
  inputSchema: Record<string, any>; // JSON Schema for input
  outputSchema?: Record<string, any>; // JSON Schema for output
  changeType: ChangeType;
  changeDescription: string;
  breakingChanges?: string;
  migrationGuide?: string;
  validated: boolean;
  validationResults?: Record<string, any>;
  published: boolean;
  publishedAt?: Date;
  publishedBy?: string;
  createdBy?: string;
  createdAt: Date;
}

/**
 * Action with current version details
 */
export interface ActionWithVersion extends Action {
  currentVersion?: ActionVersion;
  versionCount?: number;
}

/**
 * Prompt stability metrics (KPI)
 */
export interface PromptStabilityMetrics {
  promptId: string;
  promptName: string;
  category: PromptCategory;
  currentVersion: string;
  currentVersionPublishedAt?: Date;
  totalUses: number;
  daysUsed: number;
  executionsUsingPrompt: number;
  lastUsedAt?: Date;
  firstUsedAt?: Date;
  versionCount: number;
  lastBreakingChangeAt?: Date;
  isDeprecated: boolean;
}

/**
 * Action usage metrics
 */
export interface ActionUsageMetrics {
  actionId: string;
  actionName: string;
  category: ActionCategory;
  currentVersion: string;
  currentVersionPublishedAt?: Date;
  totalCalls: number;
  daysCalled: number;
  executionsUsingAction: number;
  lastCalledAt?: Date;
  firstCalledAt?: Date;
  avgDurationMs: number;
  errorCount: number;
  versionCount: number;
  isDeprecated: boolean;
}

/**
 * Prompt usage in agent run
 */
export interface PromptUsage {
  agentRunId: string;
  promptVersionId: string;
  promptContent: string;
  promptVariables?: Record<string, any>;
  executionId: string;
  startedAt: Date;
  completedAt?: Date;
}

/**
 * Breaking change detection result
 */
export interface BreakingChangeAnalysis {
  hasBreakingChanges: boolean;
  changes: Array<{
    type: 'variable_removed' | 'variable_type_changed' | 'schema_incompatible' | 'output_changed';
    description: string;
    impact: 'high' | 'medium' | 'low';
  }>;
  recommendedChangeType: ChangeType;
  migrationRequired: boolean;
}

/**
 * Prompt creation request
 */
export interface CreatePromptRequest {
  name: string;
  category: PromptCategory;
  description: string;
  purpose: string;
  systemPrompt?: string;
  userPromptTemplate?: string;
  variables?: Record<string, string>;
  modelConfig?: PromptVersion['modelConfig'];
  createdBy?: string;
}

/**
 * Prompt version creation request
 */
export interface CreatePromptVersionRequest {
  promptId: string;
  version?: string; // If not provided, auto-increment based on change type
  content: string;
  systemPrompt?: string;
  userPromptTemplate?: string;
  variables?: Record<string, string>;
  modelConfig?: PromptVersion['modelConfig'];
  changeType: ChangeType;
  changeDescription: string;
  breakingChanges?: string;
  migrationGuide?: string;
  createdBy?: string;
}

/**
 * Action creation request
 */
export interface CreateActionRequest {
  name: string;
  category: ActionCategory;
  description: string;
  toolReference: string;
  inputSchema: Record<string, any>;
  outputSchema?: Record<string, any>;
  createdBy?: string;
}

/**
 * Action version creation request
 */
export interface CreateActionVersionRequest {
  actionId: string;
  version?: string;
  toolReference: string;
  inputSchema: Record<string, any>;
  outputSchema?: Record<string, any>;
  changeType: ChangeType;
  changeDescription: string;
  breakingChanges?: string;
  migrationGuide?: string;
  createdBy?: string;
}

/**
 * Version comparison result
 */
export interface VersionComparison {
  oldVersion: string;
  newVersion: string;
  changeType: ChangeType;
  isValid: boolean;
  errors: string[];
}
