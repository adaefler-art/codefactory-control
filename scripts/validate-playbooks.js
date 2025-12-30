#!/usr/bin/env node

/**
 * Validate Playbooks Script
 * 
 * Validates all playbook definition files against the schema.
 * 
 * Usage: node scripts/validate-playbooks.js
 */

const fs = require('fs');
const path = require('path');

// Simple Zod-like validation (without importing Zod in Node script)
function validatePlaybook(playbook, filename) {
  const errors = [];

  // Validate metadata
  if (!playbook.metadata) {
    errors.push('Missing metadata');
    return errors;
  }

  if (!playbook.metadata.id || typeof playbook.metadata.id !== 'string') {
    errors.push('metadata.id is required and must be a string');
  }

  if (!playbook.metadata.name || typeof playbook.metadata.name !== 'string') {
    errors.push('metadata.name is required and must be a string');
  }

  if (!playbook.metadata.version || typeof playbook.metadata.version !== 'string') {
    errors.push('metadata.version is required and must be a string');
  } else if (!/^\d+\.\d+\.\d+$/.test(playbook.metadata.version)) {
    errors.push('metadata.version must be in semver format (e.g., 1.0.0)');
  }

  if (!Array.isArray(playbook.metadata.environments) || playbook.metadata.environments.length === 0) {
    errors.push('metadata.environments is required and must be a non-empty array');
  } else {
    for (const env of playbook.metadata.environments) {
      if (env !== 'stage' && env !== 'prod') {
        errors.push(`Invalid environment: ${env}. Must be 'stage' or 'prod'`);
      }
    }
  }

  // Validate steps
  if (!Array.isArray(playbook.steps) || playbook.steps.length === 0) {
    errors.push('steps is required and must be a non-empty array');
    return errors;
  }

  playbook.steps.forEach((step, index) => {
    if (!step.id || typeof step.id !== 'string') {
      errors.push(`Step ${index}: id is required and must be a string`);
    }

    if (!step.title || typeof step.title !== 'string') {
      errors.push(`Step ${index}: title is required and must be a string`);
    }

    if (step.retries !== undefined && (typeof step.retries !== 'number' || step.retries < 0 || step.retries > 3)) {
      errors.push(`Step ${index}: retries must be a number between 0 and 3`);
    }

    if (!step.input || typeof step.input !== 'object') {
      errors.push(`Step ${index}: input is required and must be an object`);
      return;
    }

    if (step.input.type === 'http_check') {
      if (!step.input.url || typeof step.input.url !== 'string') {
        errors.push(`Step ${index}: input.url is required for http_check`);
      }
    }
  });

  return errors;
}

// Main validation
const playbooksDir = path.join(__dirname, '../docs/playbooks');

if (!fs.existsSync(playbooksDir)) {
  console.error(`Playbooks directory not found: ${playbooksDir}`);
  process.exit(1);
}

const files = fs.readdirSync(playbooksDir).filter(f => f.endsWith('.json'));

if (files.length === 0) {
  console.log('No playbook files found.');
  process.exit(0);
}

let hasErrors = false;

files.forEach(file => {
  const filepath = path.join(playbooksDir, file);
  
  try {
    const content = fs.readFileSync(filepath, 'utf-8');
    const playbook = JSON.parse(content);
    
    const errors = validatePlaybook(playbook, file);
    
    if (errors.length > 0) {
      console.error(`\n❌ ${file}:`);
      errors.forEach(err => console.error(`  - ${err}`));
      hasErrors = true;
    } else {
      console.log(`✅ ${file}: Valid`);
    }
  } catch (error) {
    console.error(`\n❌ ${file}: Failed to parse`);
    console.error(`  - ${error.message}`);
    hasErrors = true;
  }
});

if (hasErrors) {
  console.error('\n❌ Playbook validation failed');
  process.exit(1);
} else {
  console.log('\n✅ All playbooks are valid');
  process.exit(0);
}
