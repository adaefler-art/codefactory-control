import { SFNClient, StartExecutionCommand } from "@aws-sdk/client-sfn";

const sfn = new SFNClient({});

const STATE_MACHINE_ARN = process.env.AFU9_STATE_MACHINE_ARN!;

interface GithubPayload {
  repo: string;
  ref: string;
  targetBranch: string;
  issueNumber?: string;
  githubRunId: string;
}

export const handler = async (event: GithubPayload) => {
  console.log("AFU-9 Orchestrator v0.1 start", { event });

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
  console.log("Started AFU-9 State Machine", { result });

  return {
    statusCode: 200,
    body: JSON.stringify({
      message: "AFU-9 State Machine started",
      executionArn: result.executionArn
    })
  };
};
