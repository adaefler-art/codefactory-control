/**
 * ECS Operations Adapter (E77.4)
 * 
 * Provides safe, bounded ECS operations for service health reset.
 * All operations are deny-by-default and require lawbook parameters.
 * 
 * Operations:
 * - forceNewDeployment: Triggers ECS service to force new deployment
 * - describeService: Gets current service state
 * - pollServiceStability: Waits for service to reach stable state
 */

import { Pool } from 'pg';
import { ECS } from '@aws-sdk/client-ecs';

export interface EcsServiceInfo {
  serviceArn: string;
  clusterArn: string;
  desiredCount: number;
  runningCount: number;
  taskDefinition: string;
  deployments: Array<{
    id: string;
    status: string;
    desiredCount: number;
    runningCount: number;
  }>;
}

export interface ForceNewDeploymentParams {
  cluster: string;
  service: string;
  correlationId: string; // For tracking/logging
}

export interface ForceNewDeploymentResult {
  success: boolean;
  serviceArn?: string;
  deploymentId?: string;
  error?: {
    code: string;
    message: string;
    details?: string;
  };
}

export interface PollServiceStabilityParams {
  cluster: string;
  service: string;
  maxWaitSeconds: number;
  checkIntervalSeconds?: number;
}

export interface PollServiceStabilityResult {
  success: boolean;
  stable: boolean;
  finalState?: EcsServiceInfo;
  error?: {
    code: string;
    message: string;
    details?: string;
  };
}

/**
 * Check if ECS operations are allowed by lawbook
 * Deny-by-default: returns false if parameter not found or disabled
 */
async function isEcsForceNewDeploymentAllowed(pool: Pool): Promise<boolean> {
  try {
    const result = await pool.query(
      `SELECT value FROM lawbook_parameters WHERE key = $1`,
      ['ecs_force_new_deployment_enabled']
    );
    
    if (result.rows.length === 0) {
      return false; // Deny by default
    }
    
    const value = result.rows[0].value;
    return value === true || value === 'true' || value === 1;
  } catch (error) {
    // Fail-safe: deny on any error
    return false;
  }
}

/**
 * Describe ECS service to get current state
 * Returns snapshot of service configuration and deployment status
 */
export async function describeService(
  cluster: string,
  service: string
): Promise<{ success: boolean; service?: EcsServiceInfo; error?: any }> {
  try {
    const ecs = new ECS({});
    
    const response = await ecs.describeServices({
      cluster,
      services: [service],
    });
    
    if (!response.services || response.services.length === 0) {
      return {
        success: false,
        error: {
          code: 'SERVICE_NOT_FOUND',
          message: `Service ${service} not found in cluster ${cluster}`,
        },
      };
    }
    
    const svc = response.services[0];
    
    return {
      success: true,
      service: {
        serviceArn: svc.serviceArn || '',
        clusterArn: svc.clusterArn || '',
        desiredCount: svc.desiredCount || 0,
        runningCount: svc.runningCount || 0,
        taskDefinition: svc.taskDefinition || '',
        deployments: (svc.deployments || []).map(d => ({
          id: d.id || '',
          status: d.status || '',
          desiredCount: d.desiredCount || 0,
          runningCount: d.runningCount || 0,
        })),
      },
    };
  } catch (error: any) {
    return {
      success: false,
      error: {
        code: 'DESCRIBE_FAILED',
        message: error.message || 'Failed to describe ECS service',
        details: error.stack,
      },
    };
  }
}

/**
 * Force new deployment on ECS service
 * HARDENING: Requires lawbook parameter to be enabled
 * HARDENING: Does not modify desiredCount or other service config
 */
export async function forceNewDeployment(
  pool: Pool,
  params: ForceNewDeploymentParams
): Promise<ForceNewDeploymentResult> {
  try {
    // DENY-BY-DEFAULT: Check lawbook permission
    const allowed = await isEcsForceNewDeploymentAllowed(pool);
    if (!allowed) {
      return {
        success: false,
        error: {
          code: 'LAWBOOK_DENIED',
          message: 'ECS force new deployment is not allowed by lawbook',
          details: 'Set lawbook parameter ecs_force_new_deployment_enabled=true to enable',
        },
      };
    }
    
    // Get current service state for validation
    const describeResult = await describeService(params.cluster, params.service);
    if (!describeResult.success) {
      return {
        success: false,
        error: describeResult.error,
      };
    }
    
    // Execute force new deployment
    const ecs = new ECS({});
    
    const response = await ecs.updateService({
      cluster: params.cluster,
      service: params.service,
      forceNewDeployment: true,
    });
    
    const deploymentId = response.service?.deployments?.[0]?.id;
    
    return {
      success: true,
      serviceArn: response.service?.serviceArn,
      deploymentId,
    };
  } catch (error: any) {
    return {
      success: false,
      error: {
        code: 'FORCE_DEPLOYMENT_FAILED',
        message: error.message || 'Failed to force new deployment',
        details: error.stack,
      },
    };
  }
}

/**
 * Poll ECS service until stable or timeout
 * HARDENING: Bounded by maxWaitSeconds parameter
 * 
 * A service is considered stable when:
 * - All deployments are in PRIMARY status OR
 * - Only one deployment exists and is ACTIVE
 * - runningCount == desiredCount
 */
export async function pollServiceStability(
  pool: Pool,
  params: PollServiceStabilityParams
): Promise<PollServiceStabilityResult> {
  try {
    const checkInterval = params.checkIntervalSeconds || 10;
    const maxChecks = Math.ceil(params.maxWaitSeconds / checkInterval);
    
    let checks = 0;
    
    while (checks < maxChecks) {
      const describeResult = await describeService(params.cluster, params.service);
      
      if (!describeResult.success) {
        return {
          success: false,
          stable: false,
          error: describeResult.error,
        };
      }
      
      const service = describeResult.service!;
      
      // Check if service is stable
      const isStable = 
        service.runningCount === service.desiredCount &&
        service.deployments.length === 1 &&
        (service.deployments[0].status === 'PRIMARY' || service.deployments[0].status === 'ACTIVE');
      
      if (isStable) {
        return {
          success: true,
          stable: true,
          finalState: service,
        };
      }
      
      // Wait before next check
      await new Promise(resolve => setTimeout(resolve, checkInterval * 1000));
      checks++;
    }
    
    // Timeout reached
    const finalDescribe = await describeService(params.cluster, params.service);
    return {
      success: true,
      stable: false,
      finalState: finalDescribe.service,
      error: {
        code: 'TIMEOUT',
        message: `Service did not stabilize within ${params.maxWaitSeconds} seconds`,
      },
    };
  } catch (error: any) {
    return {
      success: false,
      stable: false,
      error: {
        code: 'POLL_FAILED',
        message: error.message || 'Failed to poll service stability',
        details: error.stack,
      },
    };
  }
}
