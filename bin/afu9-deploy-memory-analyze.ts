#!/usr/bin/env node

/**
 * AFU-9 Deploy Memory Analyzer CLI
 * 
 * Analyzes deploy failures and provides recommendations
 * Usage:
 *   afu9-deploy-memory-analyze --stack-name <name> --region <region>
 *   afu9-deploy-memory-analyze --cdk-log <file>
 */

import * as fs from 'fs';
import * as path from 'path';

// Import types first
type DeployMemoryModule = typeof import('../packages/deploy-memory/src/index');

// Import from local package
let deployMemory: DeployMemoryModule;
try {
  // Try to import from compiled package
  deployMemory = require('../packages/deploy-memory/dist/index');
} catch {
  // Fallback to source during development
  deployMemory = require('../packages/deploy-memory/src/index');
}

const {
  collectCfnFailureSignals,
  collectCdkOutputSignals,
  classifyFailure,
  getPlaybook,
  determineFactoryAction,
  DeployMemoryStore,
} = deployMemory;

interface CliOptions {
  stackName?: string;
  region?: string;
  profile?: string;
  cdkLog?: string;
  output?: string;
  persist?: boolean;
}

/**
 * Parses command line arguments
 */
function parseArgs(): CliOptions {
  const args = process.argv.slice(2);
  const options: CliOptions = {
    region: process.env.AWS_REGION || 'us-east-1',
    persist: true,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const next = args[i + 1];

    switch (arg) {
      case '--stack-name':
        options.stackName = next;
        i++;
        break;
      case '--region':
        options.region = next;
        i++;
        break;
      case '--profile':
        options.profile = next;
        i++;
        break;
      case '--cdk-log':
        options.cdkLog = next;
        i++;
        break;
      case '--output':
        options.output = next;
        i++;
        break;
      case '--no-persist':
        options.persist = false;
        break;
      case '--help':
      case '-h':
        printHelp();
        process.exit(0);
        break;
    }
  }

  return options;
}

/**
 * Prints CLI help
 */
function printHelp(): void {
  console.log(`
AFU-9 Deploy Memory Analyzer

Usage:
  afu9-deploy-memory-analyze [options]

Options:
  --stack-name <name>    CloudFormation stack name to analyze
  --region <region>      AWS region (default: us-east-1 or AWS_REGION)
  --profile <profile>    AWS profile to use
  --cdk-log <file>       Path to CDK CLI output log file
  --output <file>        Output file for JSON results (default: stdout)
  --no-persist           Don't persist event to DynamoDB
  --help, -h             Show this help message

Examples:
  # Analyze a CloudFormation stack
  afu9-deploy-memory-analyze --stack-name MyStack --region us-east-1

  # Analyze CDK CLI output
  afu9-deploy-memory-analyze --cdk-log deploy.log

  # Analyze and save to file without persisting
  afu9-deploy-memory-analyze --stack-name MyStack --output result.json --no-persist

Environment Variables:
  AWS_REGION              Default AWS region
  AFU9_DEPLOY_MEMORY_TABLE  DynamoDB table name (default: afu9_deploy_memory)
`);
}

/**
 * Main CLI function
 */
async function main(): Promise<void> {
  const options = parseArgs();

  try {
    let signals: any[] = [];

    // Collect signals from CloudFormation or CDK log
    if (options.stackName) {
      console.error(`Collecting failure signals from stack: ${options.stackName}`);
      signals = await collectCfnFailureSignals({
        stackName: options.stackName,
        region: options.region,
        profile: options.profile,
      });
      console.error(`Collected ${signals.length} failure signals`);
    } else if (options.cdkLog) {
      console.error(`Parsing CDK output from: ${options.cdkLog}`);
      const logContent = fs.readFileSync(options.cdkLog, 'utf-8');
      signals = collectCdkOutputSignals(logContent);
      console.error(`Extracted ${signals.length} failure signals`);
    } else {
      console.error('Error: Must specify either --stack-name or --cdk-log');
      printHelp();
      process.exit(1);
    }

    if (signals.length === 0) {
      console.error('No failure signals found');
      const result = {
        success: false,
        message: 'No failure signals detected',
      };
      outputResult(result, options.output);
      process.exit(0);
    }

    // Classify the failure
    console.error('Classifying failure...');
    const classification = classifyFailure(signals);
    console.error(`Classification: ${classification.errorClass} (confidence: ${classification.confidence})`);

    // Get playbook
    const playbook = getPlaybook(classification.errorClass);
    const factoryAction = determineFactoryAction(
      classification.errorClass,
      classification.confidence
    );

    // Build result
    const result = {
      success: true,
      fingerprintId: classification.fingerprintId,
      errorClass: classification.errorClass,
      service: classification.service,
      confidence: classification.confidence,
      tokens: classification.tokens,
      proposedFactoryAction: factoryAction,
      recommendedSteps: playbook.steps,
      guardrails: playbook.guardrails,
      signalCount: signals.length,
      timestamp: new Date().toISOString(),
    };

    // Persist to DynamoDB if enabled
    if (options.persist) {
      console.error('Persisting event to DynamoDB...');
      try {
        const store = new DeployMemoryStore(options.region);
        await store.putEvent({
          fingerprintId: classification.fingerprintId,
          errorClass: classification.errorClass,
          service: classification.service,
          confidence: classification.confidence,
          tokens: classification.tokens,
          timestamp: new Date().toISOString(),
          stackName: options.stackName,
          region: options.region,
          rawSignals: JSON.stringify(signals),
        });
        console.error('Event persisted successfully');
      } catch (error) {
        console.error(`Warning: Failed to persist event: ${error instanceof Error ? error.message : 'Unknown error'}`);
        // Don't fail the CLI if persistence fails
      }
    }

    // Output result
    outputResult(result, options.output);

  } catch (error) {
    console.error(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    process.exit(1);
  }
}

/**
 * Outputs result to stdout or file
 */
function outputResult(result: any, outputFile?: string): void {
  const json = JSON.stringify(result, null, 2);

  if (outputFile) {
    fs.writeFileSync(outputFile, json);
    console.error(`Results written to: ${outputFile}`);
  } else {
    console.log(json);
  }
}

// Run CLI
if (require.main === module) {
  main().catch(error => {
    console.error(`Fatal error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    process.exit(1);
  });
}
