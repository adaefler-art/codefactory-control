/**
 * Step Functions Workflow Definition
 * Orchestrates the autonomous code fabrication process
 */

export const workflowDefinition = {
  Comment: 'AFU-9 Autonomous Code Fabrication Workflow',
  StartAt: 'AnalyzeIssue',
  States: {
    AnalyzeIssue: {
      Type: 'Task',
      Resource: '${IssueInterpreterLambdaArn}',
      ResultPath: '$.issueAnalysis',
      Next: 'CheckIfActionable',
      Retry: [
        {
          ErrorEquals: ['States.TaskFailed'],
          IntervalSeconds: 2,
          MaxAttempts: 3,
          BackoffRate: 2,
        },
      ],
      Catch: [
        {
          ErrorEquals: ['States.ALL'],
          ResultPath: '$.error',
          Next: 'FailureNotification',
        },
      ],
    },
    CheckIfActionable: {
      Type: 'Choice',
      Choices: [
        {
          Variable: '$.issueAnalysis.actionableTask',
          BooleanEquals: true,
          Next: 'GeneratePatch',
        },
      ],
      Default: 'NotActionable',
    },
    NotActionable: {
      Type: 'Succeed',
      Comment: 'Issue is not actionable, workflow ends',
    },
    GeneratePatch: {
      Type: 'Task',
      Resource: '${PatchGeneratorLambdaArn}',
      ResultPath: '$.patchResult',
      Next: 'ValidatePatch',
      Retry: [
        {
          ErrorEquals: ['States.TaskFailed'],
          IntervalSeconds: 2,
          MaxAttempts: 3,
          BackoffRate: 2,
        },
      ],
      Catch: [
        {
          ErrorEquals: ['States.ALL'],
          ResultPath: '$.error',
          Next: 'FailureNotification',
        },
      ],
    },
    ValidatePatch: {
      Type: 'Choice',
      Choices: [
        {
          Variable: '$.patchResult.validation.valid',
          BooleanEquals: true,
          Next: 'CreatePullRequest',
        },
      ],
      Default: 'PatchValidationFailed',
    },
    PatchValidationFailed: {
      Type: 'Fail',
      Error: 'PatchValidationError',
      Cause: 'Generated patch failed validation',
    },
    CreatePullRequest: {
      Type: 'Task',
      Resource: '${PRCreatorLambdaArn}',
      ResultPath: '$.prResult',
      Next: 'WaitForCI',
      Retry: [
        {
          ErrorEquals: ['States.TaskFailed'],
          IntervalSeconds: 2,
          MaxAttempts: 3,
          BackoffRate: 2,
        },
      ],
      Catch: [
        {
          ErrorEquals: ['States.ALL'],
          ResultPath: '$.error',
          Next: 'FailureNotification',
        },
      ],
    },
    WaitForCI: {
      Type: 'Wait',
      Seconds: 60,
      Next: 'ProcessCIFeedback',
    },
    ProcessCIFeedback: {
      Type: 'Task',
      Resource: '${CIFeedbackLambdaArn}',
      ResultPath: '$.ciResult',
      Next: 'CheckCIStatus',
      Retry: [
        {
          ErrorEquals: ['States.TaskFailed'],
          IntervalSeconds: 2,
          MaxAttempts: 2,
          BackoffRate: 2,
        },
      ],
    },
    CheckCIStatus: {
      Type: 'Choice',
      Choices: [
        {
          Variable: '$.ciResult.feedback.overallStatus',
          StringEquals: 'success',
          Next: 'CISuccess',
        },
        {
          Variable: '$.ciResult.feedback.overallStatus',
          StringEquals: 'failure',
          Next: 'CIFailure',
        },
      ],
      Default: 'WaitForCI',
    },
    CISuccess: {
      Type: 'Succeed',
      Comment: 'PR created and CI passed, workflow complete',
    },
    CIFailure: {
      Type: 'Fail',
      Error: 'CIChecksFailed',
      Cause: 'CI checks failed for the generated pull request',
    },
    FailureNotification: {
      Type: 'Fail',
      Error: 'WorkflowError',
      Cause: 'An error occurred during the workflow execution',
    },
  },
};

export function getWorkflowDefinitionWithArns(lambdaArns: {
  issueInterpreter: string;
  patchGenerator: string;
  prCreator: string;
  ciFeedback: string;
}): string {
  return JSON.stringify(workflowDefinition)
    .replace('${IssueInterpreterLambdaArn}', lambdaArns.issueInterpreter)
    .replace('${PatchGeneratorLambdaArn}', lambdaArns.patchGenerator)
    .replace('${PRCreatorLambdaArn}', lambdaArns.prCreator)
    .replace('${CIFeedbackLambdaArn}', lambdaArns.ciFeedback);
}
