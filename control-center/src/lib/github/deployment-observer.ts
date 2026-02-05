/**
 * GitHub Deployment Observer Service (E9.3-CTRL-05)
 * 
 * Provides read-only observation of GitHub deployments for AFU-9 issues.
 * Implements S6 step executor contract for deployment observation.
 * 
 * Key features:
 * - Read-only: No deployment triggers or modifications
 * - Authentic: Validates deployments via GitHub API
 * - Idempotent: Safe to observe same deployment multiple times
 * - Deterministic: Same inputs produce same outputs
 */

import { Pool } from 'pg';
import { Octokit } from '@octokit/rest';

export interface DeploymentObservation {
  id?: string;
  issue_id: string;
  github_deployment_id: number;
  environment: string;
  sha: string;
  target_url?: string;
  description?: string;
  created_at: string;
  observed_at?: string;
  deployment_status?: string;
  is_authentic: boolean;
  raw_payload: Record<string, unknown>;
}

export interface ObserveDeploymentsParams {
  pool: Pool;
  octokit: Octokit;
  issueId: string;
  owner: string;
  repo: string;
  sha: string;
}

export interface ObserveDeploymentsResult {
  success: boolean;
  deploymentsFound: number;
  observations: DeploymentObservation[];
  error?: string;
}

/**
 * Observe GitHub deployments for a specific commit SHA
 * 
 * This is the main entry point for S6 deployment observation.
 * 
 * @param params - Observation parameters
 * @returns Observation result with deployments found
 */
export async function observeDeployments(
  params: ObserveDeploymentsParams
): Promise<ObserveDeploymentsResult> {
  const { pool, octokit, issueId, owner, repo, sha } = params;

  try {
    // Step 1: Query GitHub Deployments API
    const { data: deployments } = await octokit.rest.repos.listDeployments({
      owner,
      repo,
      sha,
      per_page: 100,
    });

    if (deployments.length === 0) {
      return {
        success: true,
        deploymentsFound: 0,
        observations: [],
      };
    }

    // Step 2: Validate and store observations
    const observations: DeploymentObservation[] = [];

    for (const deployment of deployments) {
      try {
        // Validate deployment authenticity
        const isAuthentic = await validateDeploymentAuthenticity(
          octokit,
          owner,
          repo,
          deployment.id,
          sha
        );

        // Get latest deployment status
        const deploymentStatus = await getLatestDeploymentStatus(
          octokit,
          owner,
          repo,
          deployment.id
        );

        // Create observation record
        const observation: DeploymentObservation = {
          issue_id: issueId,
          github_deployment_id: deployment.id,
          environment: deployment.environment || 'unknown',
          sha: deployment.sha,
          target_url: deployment.payload?.web_url as string | undefined,
          description: deployment.description || undefined,
          created_at: deployment.created_at,
          deployment_status: deploymentStatus,
          is_authentic: isAuthentic,
          raw_payload: deployment as unknown as Record<string, unknown>,
        };

        // Store observation in database (idempotent)
        const storedObservation = await storeDeploymentObservation(
          pool,
          observation
        );

        observations.push(storedObservation);
      } catch (error) {
        console.error(
          `Failed to process deployment ${deployment.id}:`,
          error
        );
        // Continue processing other deployments
      }
    }

    return {
      success: true,
      deploymentsFound: observations.length,
      observations,
    };
  } catch (error) {
    console.error('Failed to observe deployments:', error);
    return {
      success: false,
      deploymentsFound: 0,
      observations: [],
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Validate deployment authenticity
 * 
 * Ensures the deployment is real and not fabricated.
 * Checks:
 * 1. Deployment exists in GitHub API
 * 2. Deployment has at least one status record
 * 3. Deployment SHA matches expected SHA
 * 
 * @param octokit - GitHub client
 * @param owner - Repository owner
 * @param repo - Repository name
 * @param deploymentId - GitHub deployment ID
 * @param expectedSha - Expected commit SHA
 * @returns true if deployment is authentic
 */
async function validateDeploymentAuthenticity(
  octokit: Octokit,
  owner: string,
  repo: string,
  deploymentId: number,
  expectedSha: string
): Promise<boolean> {
  try {
    // Get deployment to verify it exists and SHA matches
    const { data: deployment } = await octokit.rest.repos.getDeployment({
      owner,
      repo,
      deployment_id: deploymentId,
    });

    // Check SHA matches
    if (deployment.sha !== expectedSha) {
      return false;
    }

    // Get deployment statuses to verify it has history
    const { data: statuses } =
      await octokit.rest.repos.listDeploymentStatuses({
        owner,
        repo,
        deployment_id: deploymentId,
        per_page: 1,
      });

    // Deployment is authentic if it has at least one status
    return statuses.length > 0;
  } catch (error) {
    console.error(
      `Failed to validate deployment ${deploymentId}:`,
      error
    );
    return false;
  }
}

/**
 * Get latest deployment status
 * 
 * @param octokit - GitHub client
 * @param owner - Repository owner
 * @param repo - Repository name
 * @param deploymentId - GitHub deployment ID
 * @returns Latest status state or undefined
 */
async function getLatestDeploymentStatus(
  octokit: Octokit,
  owner: string,
  repo: string,
  deploymentId: number
): Promise<string | undefined> {
  try {
    const { data: statuses } =
      await octokit.rest.repos.listDeploymentStatuses({
        owner,
        repo,
        deployment_id: deploymentId,
        per_page: 1,
      });

    return statuses[0]?.state;
  } catch (error) {
    console.error(
      `Failed to get deployment status for ${deploymentId}:`,
      error
    );
    return undefined;
  }
}

/**
 * Store deployment observation in database
 * 
 * Idempotent: If observation already exists (same issue + deployment ID),
 * updates the existing record instead of creating duplicate.
 * 
 * @param pool - Database connection pool
 * @param observation - Deployment observation to store
 * @returns Stored observation with ID
 */
async function storeDeploymentObservation(
  pool: Pool,
  observation: DeploymentObservation
): Promise<DeploymentObservation> {
  const query = `
    INSERT INTO deployment_observations (
      issue_id,
      github_deployment_id,
      environment,
      sha,
      target_url,
      description,
      created_at,
      deployment_status,
      is_authentic,
      raw_payload
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    ON CONFLICT (issue_id, github_deployment_id)
    DO UPDATE SET
      deployment_status = EXCLUDED.deployment_status,
      is_authentic = EXCLUDED.is_authentic,
      raw_payload = EXCLUDED.raw_payload,
      updated_at = NOW()
    RETURNING *
  `;

  const values = [
    observation.issue_id,
    observation.github_deployment_id,
    observation.environment,
    observation.sha,
    observation.target_url || null,
    observation.description || null,
    observation.created_at,
    observation.deployment_status || null,
    observation.is_authentic,
    observation.raw_payload,
  ];

  const result = await pool.query(query, values);
  return result.rows[0] as DeploymentObservation;
}

/**
 * Get deployment observations for an issue
 * 
 * @param pool - Database connection pool
 * @param issueId - Issue UUID
 * @returns Array of deployment observations
 */
export async function getDeploymentObservations(
  pool: Pool,
  issueId: string
): Promise<DeploymentObservation[]> {
  const query = `
    SELECT *
    FROM deployment_observations
    WHERE issue_id = $1
    ORDER BY created_at DESC
  `;

  const result = await pool.query(query, [issueId]);
  return result.rows as DeploymentObservation[];
}

/**
 * Get deployment observations by environment
 * 
 * @param pool - Database connection pool
 * @param issueId - Issue UUID
 * @param environment - Environment name
 * @returns Array of deployment observations
 */
export async function getDeploymentObservationsByEnvironment(
  pool: Pool,
  issueId: string,
  environment: string
): Promise<DeploymentObservation[]> {
  const query = `
    SELECT *
    FROM deployment_observations
    WHERE issue_id = $1 AND environment = $2
    ORDER BY created_at DESC
  `;

  const result = await pool.query(query, [issueId, environment]);
  return result.rows as DeploymentObservation[];
}
