import { SFNClient, StartExecutionCommand } from "@aws-sdk/client-sfn";
import { LambdaLogger } from "./logger";

const sfn = new SFNClient({});
const logger = new LambdaLogger('afu9-orchestrator');

const STATE_MACHINE_ARN = process.env.AFU9_STATE_MACHINE_ARN;

interface GithubPayload {
  repo: string;
  ref: string;
  targetBranch: string;
  issueNumber?: string;
  githubRunId: string;
}

export const handler = async (event: GithubPayload) => {
  logger.info("AFU-9 Orchestrator started", { 
    repo: event.repo,
    ref: event.ref,
    issueNumber: event.issueNumber ? String(event.issueNumber) : undefined,
    githubRunId: event.githubRunId
  });

  // Validate required environment variables
  if (!STATE_MACHINE_ARN) {
    logger.error("Configuration error: AFU9_STATE_MACHINE_ARN is not set");
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: "Configuration error: AFU9_STATE_MACHINE_ARN is not set"
      })
    };
  }

  try {
    const input = {
      repo: event.repo,
      ref: event.ref,
      targetBranch: event.targetBranch,
      issueNumber: event.issueNumber ?? null,
      githubRunId: event.githubRunId,
      timestamp: new Date().toISOString()
    };

    const command = new StartExecutionCommand({
      stateMachineArn: STATE_MACHINE_ARN,
      input: JSON.stringify(input)
    });

    const result = await sfn.send(command);
    logger.info("AFU-9 State Machine started successfully", { 
      executionArn: result.executionArn,
      startDate: result.startDate?.toISOString(),
      repo: event.repo,
      issueNumber: event.issueNumber ? String(event.issueNumber) : undefined
    });

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: "AFU-9 State Machine started",
        executionArn: result.executionArn
      })
    };
  } catch (error) {
    logger.error("Failed to start AFU-9 State Machine", error, {
      repo: event.repo,
      issueNumber: event.issueNumber ? String(event.issueNumber) : undefined,
      githubRunId: event.githubRunId
    });

    return {
      statusCode: 500,
      body: JSON.stringify({
        error: "Failed to start AFU-9 State Machine",
        message: error instanceof Error ? error.message : "Unknown error"
      })
    };
  }
};
