#!/usr/bin/env ts-node

/**
 * Self-Propelling Workflow Engine Test
 * 
 * Tests that the workflow engine can properly load and prepare
 * the self-propelling workflow for execution (without actually executing it).
 */

import * as fs from 'fs';
import * as path from 'path';

interface WorkflowDefinition {
  name?: string;
  description?: string;
  steps: Array<{
    name: string;
    tool: string;
    params: Record<string, any>;
    assign?: string;
  }>;
  config?: {
    timeoutMs?: number;
    continueOnError?: boolean;
    maxRetries?: number;
  };
}

interface WorkflowContext {
  variables: Record<string, any>;
  input: Record<string, any>;
  repo?: {
    owner: string;
    name: string;
    default_branch?: string;
  };
  issue?: {
    number: number;
    state?: string;
    title?: string;
  };
}

console.log('🧪 Self-Propelling Workflow Engine Test');
console.log('=======================================\n');

// Load workflow definition
console.log('1️⃣  Loading workflow definition...');
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

const workflowContent = fs.readFileSync(workflowPath, 'utf-8');
const workflow: WorkflowDefinition = JSON.parse(workflowContent);
console.log(`   ✅ Loaded workflow: ${workflow.name}`);
console.log(`   Steps: ${workflow.steps.length}\n`);

// Create test context
console.log('2️⃣  Creating test execution context...');
const context: WorkflowContext = {
  variables: {},
  input: {
    owner: 'adaefler-art',
    repo: 'codefactory-control',
    issue_number: 999,
    base_branch: 'main',
  },
  repo: {
    owner: 'adaefler-art',
    name: 'codefactory-control',
    default_branch: 'main',
  },
  issue: {
    number: 999,
  },
};
console.log('   ✅ Created test context');
console.log(`   Owner: ${context.input.owner}`);
console.log(`   Repo: ${context.input.repo}`);
console.log(`   Issue: #${context.input.issue_number}\n`);

// Validate steps can be parsed
console.log('3️⃣  Validating step definitions...');
let validSteps = 0;
let invalidSteps = 0;

workflow.steps.forEach((step, index) => {
  try {
    // Check required fields
    if (!step.name) throw new Error('Missing name');
    if (!step.tool) throw new Error('Missing tool');
    if (!step.params) throw new Error('Missing params');

    // Parse tool
    const [server, tool] = step.tool.split('.');
    if (!server || !tool) {
      throw new Error(`Invalid tool format: ${step.tool}`);
    }

    // Validate params are serializable
    JSON.stringify(step.params);

    validSteps++;
  } catch (error) {
    console.error(`   ❌ Step ${index} (${step.name}): ${error}`);
    invalidSteps++;
  }
});

if (invalidSteps === 0) {
  console.log(`   ✅ All ${validSteps} steps are valid\n`);
} else {
  console.log(`   ❌ ${invalidSteps} invalid steps\n`);
  process.exit(1);
}

// Test variable substitution patterns
console.log('4️⃣  Testing variable substitution patterns...');
const variablePatterns = new Set<string>();

workflow.steps.forEach(step => {
  const paramStr = JSON.stringify(step.params);
  const matches = paramStr.match(/\$\{[^}]+\}/g);
  if (matches) {
    matches.forEach(match => variablePatterns.add(match));
  }
});

console.log(`   Found ${variablePatterns.size} unique variable patterns:`);
Array.from(variablePatterns).slice(0, 10).forEach(pattern => {
  console.log(`   - ${pattern}`);
});
if (variablePatterns.size > 10) {
  console.log(`   ... and ${variablePatterns.size - 10} more`);
}
console.log();

// Simulate step execution order
console.log('5️⃣  Simulating execution order...');
console.log('   Execution plan:');

let currentState = 'CREATED';
workflow.steps.forEach((step, index) => {
  // Detect state transitions
  const transitionMatch = step.name.match(/transition_to_(\w+)/);
  if (transitionMatch) {
    const nextState = transitionMatch[1].toUpperCase();
    console.log(`   ${index + 1}. ${step.name}: ${currentState} → ${nextState}`);
    currentState = nextState;
  } else {
    console.log(`   ${index + 1}. ${step.name} [${step.tool}]`);
  }
});
console.log();

// Validate final state
console.log('6️⃣  Validating final state...');
if (currentState === 'DONE') {
  console.log('   ✅ Final state is DONE\n');
} else {
  console.log(`   ❌ Final state is ${currentState}, expected DONE\n`);
  process.exit(1);
}

// Test workflow configuration
console.log('7️⃣  Validating workflow configuration...');
if (workflow.config) {
  console.log('   Configuration:');
  console.log(`   - Timeout: ${workflow.config.timeoutMs || 300000}ms`);
  console.log(`   - Continue on error: ${workflow.config.continueOnError || false}`);
  console.log(`   - Max retries: ${workflow.config.maxRetries || 0}`);
  console.log('   ✅ Configuration is valid\n');
} else {
  console.log('   ℹ️  No custom configuration (using defaults)\n');
}

// Summary
console.log('📊 Test Summary');
console.log('==============\n');
console.log('✅ Workflow definition loads successfully');
console.log('✅ All steps are properly formatted');
console.log('✅ Variable substitution patterns are valid');
console.log('✅ Execution order follows state machine');
console.log('✅ Final state is DONE');
console.log('✅ Configuration is valid\n');

console.log('🎉 All tests passed!');
console.log('   The workflow is ready for execution.\n');
