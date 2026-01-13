/**
 * State Machine Specification Loader
 * E85.2: Bi-directional Sync (AFU-9 ↔ GitHub)
 * 
 * Loads and validates state machine specification from E85.1
 * Provides functions to validate transitions, check preconditions, and extract GitHub mappings.
 */

import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';

/**
 * State definition from state machine spec
 */
export interface StateDefinition {
  name: string;
  category: string;
  terminal: boolean;
  active: boolean;
  ui_color: string;
  ui_icon: string;
  entry_conditions: string[];
  exit_conditions: string[];
  predecessors: string[];
  successors: string[];
}

/**
 * Transition definition from transitions spec
 */
export interface TransitionDefinition {
  from: string;
  to: string;
  name: string;
  type: string;
  description: string;
  preconditions: Array<{
    type: string;
    required: boolean;
  }>;
  side_effects: Array<{
    type: string;
    action: string;
    value?: string;
  }>;
  evidence_required: boolean;
  evidence_types?: string[];
  auto_transition: boolean;
  auto_transition_on?: string[];
}

/**
 * GitHub mapping from github-mapping spec
 */
export interface GitHubMapping {
  afu9_to_github_labels: Record<string, {
    primary_label: string;
    additional_labels: string[];
    description: string;
  }>;
  github_to_afu9_state: {
    project_status: Record<string, string>;
    labels: Record<string, string>;
    issue_state: Record<string, string | null>;
  };
  github_pr_status_to_afu9: Record<string, string | null>;
  github_checks_requirements: Record<string, {
    required_checks: Array<{
      name: string;
      status: string;
      description: string;
    }>;
    optional_checks: Array<{
      name: string;
      status: string;
      description: string;
    }>;
  }>;
}

/**
 * State machine specification
 */
export interface StateMachineSpec {
  states: Map<string, StateDefinition>;
  transitions: Map<string, TransitionDefinition>;
  githubMapping: GitHubMapping;
}

/**
 * Load state machine specification from YAML files
 * 
 * @param specDir - Directory containing state machine spec files (default: docs/state-machine/v1)
 * @returns Parsed state machine specification
 */
export function loadStateMachineSpec(
  specDir?: string
): StateMachineSpec {
  const baseDir = specDir || path.join(process.cwd(), 'docs', 'state-machine', 'v1');

  try {
    // Load state machine YAML
    const stateMachineFile = path.join(baseDir, 'state-machine.yaml');
    if (!fs.existsSync(stateMachineFile)) {
      throw new Error(`State machine spec not found: ${stateMachineFile}`);
    }
    const stateMachineYaml = yaml.load(
      fs.readFileSync(stateMachineFile, 'utf8')
    ) as any;

    // Load transitions YAML
    const transitionsFile = path.join(baseDir, 'transitions.yaml');
    if (!fs.existsSync(transitionsFile)) {
      throw new Error(`Transitions spec not found: ${transitionsFile}`);
    }
    const transitionsYaml = yaml.load(
      fs.readFileSync(transitionsFile, 'utf8')
    ) as any;

    // Load GitHub mapping YAML
    const githubMappingFile = path.join(baseDir, 'github-mapping.yaml');
    if (!fs.existsSync(githubMappingFile)) {
      throw new Error(`GitHub mapping spec not found: ${githubMappingFile}`);
    }
    const githubMappingYaml = yaml.load(
      fs.readFileSync(githubMappingFile, 'utf8')
    ) as any;

  // Parse states
  const states = new Map<string, StateDefinition>();
  for (const [stateName, stateDef] of Object.entries(stateMachineYaml.states || {})) {
    const def = stateDef as any;
    states.set(stateName, {
      name: stateName,
      category: def.category || '',
      terminal: def.terminal || false,
      active: def.active !== false,
      ui_color: def.ui_color || '',
      ui_icon: def.ui_icon || '',
      entry_conditions: def.entry_conditions || [],
      exit_conditions: def.exit_conditions || [],
      predecessors: def.predecessors || [],
      successors: def.successors || [],
    });
  }

  // Parse transitions
  const transitions = new Map<string, TransitionDefinition>();
  for (const [transitionName, transitionDef] of Object.entries(transitionsYaml.transitions || {})) {
    const def = transitionDef as any;
    transitions.set(transitionName, {
      from: def.from || '',
      to: def.to || '',
      name: transitionName,
      type: def.type || '',
      description: def.description || '',
      preconditions: def.preconditions || [],
      side_effects: def.side_effects || [],
      evidence_required: def.evidence_required || false,
      evidence_types: def.evidence_types || [],
      auto_transition: def.auto_transition || false,
      auto_transition_on: def.auto_transition_on || [],
    });
  }

  // Parse GitHub mapping
  const githubMapping: GitHubMapping = {
    afu9_to_github_labels: githubMappingYaml.afu9_to_github_labels || {},
    github_to_afu9_state: githubMappingYaml.github_to_afu9_state || {
      project_status: {},
      labels: {},
      issue_state: {},
    },
    github_pr_status_to_afu9: githubMappingYaml.github_pr_status_to_afu9 || {},
    github_checks_requirements: githubMappingYaml.github_checks_requirements || {},
  };

  return {
    states,
    transitions,
    githubMapping,
  };
  } catch (error) {
    console.error('[loadStateMachineSpec] Failed to load state machine spec:', error);
    throw new Error(
      `Failed to load state machine specification: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}

/**
 * Validate if a state transition is allowed
 * 
 * @param spec - State machine specification
 * @param fromState - Current state
 * @param toState - Target state
 * @returns True if transition is allowed, false otherwise
 */
export function isTransitionAllowed(
  spec: StateMachineSpec,
  fromState: string,
  toState: string
): boolean {
  // Terminal states cannot transition
  const currentState = spec.states.get(fromState);
  if (currentState?.terminal) {
    return false;
  }

  // Check if toState is in successors of fromState
  const successors = currentState?.successors || [];
  return successors.includes(toState);
}

/**
 * Get transition definition for a state change
 * 
 * @param spec - State machine specification
 * @param fromState - Current state
 * @param toState - Target state
 * @returns Transition definition or null if not found
 */
export function getTransition(
  spec: StateMachineSpec,
  fromState: string,
  toState: string
): TransitionDefinition | null {
  for (const transition of spec.transitions.values()) {
    if (transition.from === fromState && transition.to === toState) {
      return transition;
    }
  }
  return null;
}

/**
 * Check if preconditions are met for a transition
 * 
 * @param transition - Transition definition
 * @param evidence - Evidence data (e.g., CI status, review approval)
 * @returns Object with result and missing preconditions
 */
export function checkPreconditions(
  transition: TransitionDefinition,
  evidence: Record<string, boolean>
): { met: boolean; missing: string[] } {
  const missing: string[] = [];

  for (const precondition of transition.preconditions) {
    if (precondition.required) {
      const isMet = evidence[precondition.type] === true;
      if (!isMet) {
        missing.push(precondition.type);
      }
    }
  }

  return {
    met: missing.length === 0,
    missing,
  };
}

/**
 * Map GitHub status to AFU-9 status
 * 
 * @param spec - State machine specification
 * @param githubStatus - GitHub status (from project, label, or PR)
 * @param source - Source of status (project_status, labels, pr_status)
 * @returns Mapped AFU-9 status or null if no mapping
 */
export function mapGitHubStatusToAfu9(
  spec: StateMachineSpec,
  githubStatus: string,
  source: 'project_status' | 'labels' | 'pr_status'
): string | null {
  switch (source) {
    case 'project_status':
      return spec.githubMapping.github_to_afu9_state.project_status[githubStatus] || null;
    case 'labels':
      return spec.githubMapping.github_to_afu9_state.labels[githubStatus] || null;
    case 'pr_status':
      return spec.githubMapping.github_pr_status_to_afu9[githubStatus] || null;
    default:
      return null;
  }
}

/**
 * Get GitHub labels for an AFU-9 state
 * 
 * @param spec - State machine specification
 * @param afu9Status - AFU-9 status
 * @returns Primary and additional labels
 */
export function getGitHubLabelsForStatus(
  spec: StateMachineSpec,
  afu9Status: string
): { primary: string; additional: string[] } | null {
  const mapping = spec.githubMapping.afu9_to_github_labels[afu9Status];
  if (!mapping) {
    return null;
  }

  return {
    primary: mapping.primary_label,
    additional: mapping.additional_labels,
  };
}

/**
 * Get required checks for a state
 * 
 * @param spec - State machine specification
 * @param afu9Status - AFU-9 status
 * @returns Required and optional checks
 */
export function getRequiredChecks(
  spec: StateMachineSpec,
  afu9Status: string
): {
  required: Array<{ name: string; status: string; description: string }>;
  optional: Array<{ name: string; status: string; description: string }>;
} | null {
  const requirements = spec.githubMapping.github_checks_requirements[afu9Status];
  if (!requirements) {
    return null;
  }

  return {
    required: requirements.required_checks || [],
    optional: requirements.optional_checks || [],
  };
}

/**
 * Check if a state is terminal
 * 
 * @param spec - State machine specification
 * @param stateName - State name
 * @returns True if terminal, false otherwise
 */
export function isTerminalState(
  spec: StateMachineSpec,
  stateName: string
): boolean {
  return spec.states.get(stateName)?.terminal || false;
}

/**
 * Get all valid next states from current state
 * 
 * @param spec - State machine specification
 * @param currentState - Current state
 * @returns List of valid next states
 */
export function getValidNextStates(
  spec: StateMachineSpec,
  currentState: string
): string[] {
  const state = spec.states.get(currentState);
  if (!state) {
    return [];
  }

  if (state.terminal) {
    return [];
  }

  return state.successors || [];
}
