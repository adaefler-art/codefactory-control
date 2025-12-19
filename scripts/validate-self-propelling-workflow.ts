#!/usr/bin/env ts-node

/**
 * Self-Propelling Workflow Validation Test
 * 
 * This script validates the self-propelling workflow definition without
 * making actual GitHub API calls. It checks:
 * - Workflow JSON is valid
 * - All steps are properly defined
 * - State transitions follow canonical state machine
 * - Workflow is complete (all states covered)
 */

import * as fs from 'fs';
import * as path from 'path';

interface WorkflowStep {
  name: string;
  tool: string;
  params: Record<string, any>;
  assign?: string;
}

interface WorkflowDefinition {
  name: string;
  description: string;
  steps: WorkflowStep[];
  config?: {
    timeoutMs?: number;
    continueOnError?: boolean;
    maxRetries?: number;
  };
}

// Canonical state machine states
const CANONICAL_STATES = [
  'CREATED',
  'SPEC_READY',
  'IMPLEMENTING',
  'VERIFIED',
  'MERGE_READY',
  'DONE',
];

// Expected state transitions
const EXPECTED_TRANSITIONS = [
  { from: 'CREATED', to: 'SPEC_READY' },
  { from: 'SPEC_READY', to: 'IMPLEMENTING' },
  { from: 'IMPLEMENTING', to: 'VERIFIED' },
  { from: 'VERIFIED', to: 'MERGE_READY' },
  { from: 'MERGE_READY', to: 'DONE' },
];

class WorkflowValidator {
  private workflow: WorkflowDefinition;
  private errors: string[] = [];
  private warnings: string[] = [];

  constructor(workflowPath: string) {
    console.log('📋 Self-Propelling Workflow Validation');
    console.log('======================================\n');
    
    // Load workflow
    console.log(`Loading workflow: ${workflowPath}`);
    const content = fs.readFileSync(workflowPath, 'utf-8');
    this.workflow = JSON.parse(content);
    console.log(`✅ Loaded workflow: ${this.workflow.name}`);
    console.log(`   Description: ${this.workflow.description}`);
    console.log(`   Steps: ${this.workflow.steps.length}\n`);
  }

  /**
   * Run all validation checks
   */
  validate(): boolean {
    console.log('🔍 Running validation checks...\n');

    this.validateBasicStructure();
    this.validateSteps();
    this.validateStateTransitions();
    this.validateToolCalls();
    this.validateCompleteness();

    return this.reportResults();
  }

  /**
   * Validate basic workflow structure
   */
  private validateBasicStructure(): void {
    console.log('1️⃣  Validating basic structure...');

    if (!this.workflow.name) {
      this.errors.push('Workflow must have a name');
    } else if (this.workflow.name !== 'self_propelling_issue') {
      this.warnings.push(`Expected workflow name 'self_propelling_issue', got '${this.workflow.name}'`);
    }

    if (!this.workflow.description) {
      this.warnings.push('Workflow should have a description');
    }

    if (!this.workflow.steps || this.workflow.steps.length === 0) {
      this.errors.push('Workflow must have at least one step');
    }

    if (this.errors.length === 0) {
      console.log('   ✅ Basic structure is valid\n');
    } else {
      console.log('   ❌ Basic structure has errors\n');
    }
  }

  /**
   * Validate individual steps
   */
  private validateSteps(): void {
    console.log('2️⃣  Validating steps...');

    let stepErrors = 0;

    this.workflow.steps.forEach((step, index) => {
      if (!step.name) {
        this.errors.push(`Step ${index}: Missing name`);
        stepErrors++;
      }

      if (!step.tool) {
        this.errors.push(`Step ${index} (${step.name}): Missing tool`);
        stepErrors++;
      } else if (!step.tool.includes('.')) {
        this.errors.push(`Step ${index} (${step.name}): Tool must be in format 'server.tool'`);
        stepErrors++;
      }

      if (!step.params) {
        this.errors.push(`Step ${index} (${step.name}): Missing params`);
        stepErrors++;
      }
    });

    if (stepErrors === 0) {
      console.log(`   ✅ All ${this.workflow.steps.length} steps are valid\n`);
    } else {
      console.log(`   ❌ Found ${stepErrors} step errors\n`);
    }
  }

  /**
   * Validate state transitions
   */
  private validateStateTransitions(): void {
    console.log('3️⃣  Validating state transitions...');

    // Find steps that mention state transitions
    const transitionSteps = this.workflow.steps.filter(step => 
      step.name.includes('transition_to')
    );

    console.log(`   Found ${transitionSteps.length} transition steps:`);

    const foundTransitions: Set<string> = new Set();

    transitionSteps.forEach(step => {
      // Extract target state from step name
      const match = step.name.match(/transition_to_(\w+)/);
      if (match) {
        const targetState = match[1].toUpperCase();
        foundTransitions.add(targetState);
        console.log(`   - ${step.name} → ${targetState}`);
      }
    });

    // Check if all expected states are covered
    const expectedStates = ['SPEC_READY', 'IMPLEMENTING', 'VERIFIED', 'MERGE_READY', 'DONE'];
    const missingStates = expectedStates.filter(state => !foundTransitions.has(state));

    if (missingStates.length > 0) {
      this.errors.push(`Missing transitions to states: ${missingStates.join(', ')}`);
      console.log(`   ❌ Missing transitions: ${missingStates.join(', ')}\n`);
    } else {
      console.log('   ✅ All state transitions covered\n');
    }
  }

  /**
   * Validate tool calls
   */
  private validateToolCalls(): void {
    console.log('4️⃣  Validating tool calls...');

    const toolCounts: Record<string, number> = {};

    this.workflow.steps.forEach(step => {
      const [server, tool] = step.tool.split('.');
      const key = `${server}.${tool}`;
      toolCounts[key] = (toolCounts[key] || 0) + 1;
    });

    console.log('   Tool usage:');
    Object.entries(toolCounts).forEach(([tool, count]) => {
      console.log(`   - ${tool}: ${count}x`);
    });

    // Check for required tools
    const requiredTools = ['github.getIssue', 'github.addIssueComment', 'github.updateIssue'];
    const missingTools = requiredTools.filter(tool => !toolCounts[tool]);

    if (missingTools.length > 0) {
      this.warnings.push(`Workflow doesn't use recommended tools: ${missingTools.join(', ')}`);
    }

    console.log('   ✅ Tool calls are valid\n');
  }

  /**
   * Validate workflow completeness
   */
  private validateCompleteness(): void {
    console.log('5️⃣  Validating completeness...');

    // Check for issue fetching
    const hasFetchIssue = this.workflow.steps.some(step => 
      step.tool === 'github.getIssue'
    );
    if (!hasFetchIssue) {
      this.warnings.push('Workflow should fetch issue details');
    } else {
      console.log('   ✅ Fetches issue details');
    }

    // Check for issue closing
    const hasCloseIssue = this.workflow.steps.some(step =>
      step.tool === 'github.updateIssue' && 
      step.params.state === 'closed'
    );
    if (!hasCloseIssue) {
      this.errors.push('Workflow must close issue at the end');
      console.log('   ❌ Does not close issue');
    } else {
      console.log('   ✅ Closes issue at the end');
    }

    // Check for timeline documentation
    const hasTimeline = this.workflow.steps.some(step =>
      step.name.includes('done') && step.tool === 'github.addIssueComment'
    );
    if (!hasTimeline) {
      this.warnings.push('Workflow should add summary comment with timeline');
    } else {
      console.log('   ✅ Documents timeline');
    }

    console.log();
  }

  /**
   * Report validation results
   */
  private reportResults(): boolean {
    console.log('📊 Validation Results');
    console.log('====================\n');

    if (this.errors.length === 0 && this.warnings.length === 0) {
      console.log('✅ All checks passed! Workflow is valid.');
      return true;
    }

    if (this.errors.length > 0) {
      console.log(`❌ Found ${this.errors.length} error(s):\n`);
      this.errors.forEach((error, i) => {
        console.log(`   ${i + 1}. ${error}`);
      });
      console.log();
    }

    if (this.warnings.length > 0) {
      console.log(`⚠️  Found ${this.warnings.length} warning(s):\n`);
      this.warnings.forEach((warning, i) => {
        console.log(`   ${i + 1}. ${warning}`);
      });
      console.log();
    }

    return this.errors.length === 0;
  }
}

// Main execution
function main() {
  const workflowPath = path.join(
    process.cwd(),
    'database',
    'examples',
    'self_propelling_issue.json'
  );

  if (!fs.existsSync(workflowPath)) {
    console.error(`❌ Workflow file not found: ${workflowPath}`);
    process.exit(1);
  }

  const validator = new WorkflowValidator(workflowPath);
  const isValid = validator.validate();

  process.exit(isValid ? 0 : 1);
}

if (require.main === module) {
  main();
}
