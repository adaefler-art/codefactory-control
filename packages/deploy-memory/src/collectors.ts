/**
 * AFU-9 Deploy Memory - CloudFormation Collector
 * 
 * Collects failure signals from AWS CloudFormation using AWS SDK v3
 */

import {
  CloudFormationClient,
  DescribeStacksCommand,
  DescribeStackEventsCommand,
  Stack,
  StackEvent,
} from '@aws-sdk/client-cloudformation';
import { CfnFailureSignal } from './types';

export interface CollectCfnOptions {
  stackName: string;
  region?: string;
  profile?: string;
  maxEvents?: number;
}

/**
 * Collects failure signals from CloudFormation stack events
 * 
 * @param options Collection options including stackName, region, profile
 * @returns Array of normalized CloudFormation failure signals
 */
export async function collectCfnFailureSignals(
  options: CollectCfnOptions
): Promise<CfnFailureSignal[]> {
  const { stackName, region = 'us-east-1', maxEvents = 50 } = options;

  const client = new CloudFormationClient({
    region,
    ...(options.profile && { profile: options.profile }),
  });

  try {
    // Get stack information
    const describeStacksResponse = await client.send(
      new DescribeStacksCommand({
        StackName: stackName,
      })
    );

    const stack: Stack | undefined = describeStacksResponse.Stacks?.[0];
    if (!stack) {
      throw new Error(`Stack ${stackName} not found`);
    }

    // Get stack events (last maxEvents events)
    const describeEventsResponse = await client.send(
      new DescribeStackEventsCommand({
        StackName: stackName,
      })
    );

    const events: StackEvent[] = describeEventsResponse.StackEvents || [];
    const recentEvents = events.slice(0, maxEvents);

    // Filter for failure events and normalize
    const failureSignals: CfnFailureSignal[] = [];

    for (const event of recentEvents) {
      const status = event.ResourceStatus || '';
      const isFailure =
        status.includes('FAILED') ||
        status.includes('ROLLBACK') ||
        status === 'DELETE_IN_PROGRESS';

      if (isFailure && event.ResourceStatusReason) {
        failureSignals.push({
          resourceType: event.ResourceType || 'Unknown',
          logicalId: event.LogicalResourceId || 'Unknown',
          statusReason: event.ResourceStatusReason,
          timestamp: event.Timestamp || new Date(),
          physicalResourceId: event.PhysicalResourceId,
          resourceStatus: event.ResourceStatus,
        });
      }
    }

    return failureSignals;
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Failed to collect CFN signals: ${error.message}`);
    }
    throw error;
  }
}

/**
 * Parses CDK CLI output to extract failure signals
 * 
 * This is a fallback collector when CloudFormation API is unavailable
 * or for capturing CDK-level failures that don't reach CloudFormation
 * 
 * @param logText CDK CLI output text
 * @returns Array of parsed CDK output signals
 */
export function collectCdkOutputSignals(logText: string): CfnFailureSignal[] {
  const signals: CfnFailureSignal[] = [];
  const lines = logText.split('\n');

  // Pattern: Stack deployment failed
  const stackFailurePattern = /(\w+Stack)\s+\|\s+.*\s+(FAILED|ROLLBACK)/i;
  
  // Pattern: Resource creation failed - more flexible
  const resourceFailurePattern = /(\S+)\s+\|\s+([A-Z]+::[A-Z]+::[A-Z]+)\s+\|\s+(CREATE_FAILED|UPDATE_FAILED|DELETE_FAILED)/i;
  
  // Pattern: Error messages
  const errorPattern = /^(Error:|✘|❌|Failed:)\s+(.+)$/i;

  // Pattern: Rollback status
  const rollbackStatusPattern = /(\w+)\s+\|\s+(UPDATE_ROLLBACK_IN_PROGRESS|ROLLBACK_IN_PROGRESS|UPDATE_ROLLBACK_COMPLETE)/i;

  let currentStack: string | null = null;
  let currentError: string | null = null;

  for (const line of lines) {
    // Extract stack name from context
    const stackMatch = line.match(/Stack\s+(\w+Stack)/i);
    if (stackMatch) {
      currentStack = stackMatch[1];
    }

    // Check for rollback status first (most specific)
    const rollbackStatusMatch = line.match(rollbackStatusPattern);
    if (rollbackStatusMatch) {
      signals.push({
        resourceType: 'AWS::CloudFormation::Stack',
        logicalId: rollbackStatusMatch[1],
        statusReason: `Stack is in ${rollbackStatusMatch[2]} state`,
        timestamp: new Date(),
        resourceStatus: rollbackStatusMatch[2],
      });
      continue;
    }

    // Check for stack-level failures
    const stackFailureMatch = line.match(stackFailurePattern);
    if (stackFailureMatch) {
      signals.push({
        resourceType: 'AWS::CloudFormation::Stack',
        logicalId: stackFailureMatch[1],
        statusReason: `Stack deployment ${stackFailureMatch[2]}: ${currentError || 'See logs'}`,
        timestamp: new Date(),
      });
      continue;
    }

    // Check for resource-level failures
    const resourceFailureMatch = line.match(resourceFailurePattern);
    if (resourceFailureMatch) {
      const [, logicalId, resourceType, status] = resourceFailureMatch;
      signals.push({
        resourceType,
        logicalId,
        statusReason: currentError || `Resource ${status}`,
        timestamp: new Date(),
        resourceStatus: status,
      });
      currentError = null; // Reset after using
      continue;
    }

    // Capture error messages for context
    const errorMatch = line.match(errorPattern);
    if (errorMatch) {
      currentError = errorMatch[2].trim();
      
      // If we have a stack context but no specific resource, create a signal
      if (currentStack && !line.includes('::')) {
        signals.push({
          resourceType: 'AWS::CloudFormation::Stack',
          logicalId: currentStack,
          statusReason: currentError,
          timestamp: new Date(),
        });
      }
    }

    // Check for specific CDK error patterns
    if (line.includes('ResourceNotFoundException')) {
      signals.push({
        resourceType: 'Unknown',
        logicalId: currentStack || 'Unknown',
        statusReason: line.trim(),
        timestamp: new Date(),
      });
    }
  }

  return signals;
}
