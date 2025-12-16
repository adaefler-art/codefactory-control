/**
 * AFU-9 Deploy Memory - Verdict Integration
 * 
 * Extends the verdict engine payload with deploy memory recommendations
 */

import {
  collectCfnFailureSignals,
  collectCdkOutputSignals,
  classifyFailure,
  getPlaybook,
  determineFactoryAction,
  DeployMemoryRecommendation,
  DeployMemoryStore,
} from '../../packages/deploy-memory/dist/index';

export interface VerdictPayload {
  repo: string;
  targetBranch: string;
  issue?: any;
  classification?: any;
  deployMemory?: DeployMemoryRecommendation;
}

export interface DeployFailureContext {
  stackName?: string;
  region?: string;
  profile?: string;
  cdkLogContent?: string;
}

/**
 * Analyzes deploy failures and extends verdict payload with recommendations
 * 
 * @param context Deploy failure context (stack name or CDK log)
 * @param region AWS region (default: us-east-1)
 * @param persist Whether to persist the event to DynamoDB (default: true)
 * @returns Deploy memory recommendation or null
 */
export async function analyzeDeployFailure(
  context: DeployFailureContext,
  region: string = 'us-east-1',
  persist: boolean = true
): Promise<DeployMemoryRecommendation | null> {
  try {
    let signals: any[] = [];

    // Collect signals from CloudFormation or CDK log
    if (context.stackName) {
      signals = await collectCfnFailureSignals({
        stackName: context.stackName,
        region: context.region || region,
        profile: context.profile,
      });
    } else if (context.cdkLogContent) {
      signals = collectCdkOutputSignals(context.cdkLogContent);
    } else {
      return null; // No failure context provided
    }

    if (signals.length === 0) {
      return null; // No failures detected
    }

    // Classify the failure
    const classification = classifyFailure(signals);

    // Get playbook and determine action
    const playbook = getPlaybook(classification.errorClass);
    const factoryAction = determineFactoryAction(
      classification.errorClass,
      classification.confidence
    );

    // Build recommendation
    const recommendation: DeployMemoryRecommendation = {
      fingerprintId: classification.fingerprintId,
      proposedFactoryAction: factoryAction,
      recommendedSteps: playbook.steps,
      confidence: classification.confidence,
      errorClass: classification.errorClass,
    };

    // Persist to DynamoDB if enabled
    if (persist) {
      try {
        const store = new DeployMemoryStore(region);
        await store.putEvent({
          fingerprintId: classification.fingerprintId,
          errorClass: classification.errorClass,
          service: classification.service,
          confidence: classification.confidence,
          tokens: classification.tokens,
          timestamp: new Date().toISOString(),
          stackName: context.stackName,
          region: context.region || region,
          rawSignals: JSON.stringify(signals),
        });
      } catch (error) {
        // Log but don't fail on persistence errors
        console.error('Failed to persist deploy memory event:', error);
      }
    }

    return recommendation;
  } catch (error) {
    console.error('Error analyzing deploy failure:', error);
    return null;
  }
}

/**
 * Extends a verdict payload with deploy memory recommendation
 * 
 * @param verdict Base verdict payload
 * @param context Deploy failure context
 * @returns Extended verdict payload
 */
export async function extendVerdictWithDeployMemory(
  verdict: VerdictPayload,
  context: DeployFailureContext
): Promise<VerdictPayload> {
  const recommendation = await analyzeDeployFailure(context);
  
  if (recommendation) {
    return {
      ...verdict,
      deployMemory: recommendation,
    };
  }

  return verdict;
}
