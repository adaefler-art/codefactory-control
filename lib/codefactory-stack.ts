import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import * as tasks from 'aws-cdk-lib/aws-stepfunctions-tasks';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';

export class CodeFactoryStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Secrets - NOT HARDCODED
    const githubSecret = secretsmanager.Secret.fromSecretNameV2(
      this,
      'GitHubSecret',
      'codefactory/github-private-key'
    );

    // Lambda execution role
    const lambdaRole = new iam.Role(this, 'LambdaExecutionRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
      ],
    });

    githubSecret.grantRead(lambdaRole);

    // Lambda functions
    const issueInterpreterLambda = new lambda.Function(this, 'IssueInterpreterLambda', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'issue-interpreter/issue-interpreter.handler',
      code: lambda.Code.fromAsset('dist'),
      role: lambdaRole,
      environment: {
        GITHUB_PRIVATE_KEY_SECRET_ARN: githubSecret.secretArn,
      },
      timeout: cdk.Duration.seconds(30),
    });

    const patchGeneratorLambda = new lambda.Function(this, 'PatchGeneratorLambda', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'lambdas/patch-generation-handler.handler',
      code: lambda.Code.fromAsset('dist'),
      role: lambdaRole,
      environment: {
        GITHUB_PRIVATE_KEY_SECRET_ARN: githubSecret.secretArn,
      },
      timeout: cdk.Duration.seconds(60),
    });

    const prCreatorLambda = new lambda.Function(this, 'PRCreatorLambda', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'lambdas/pr-creation-handler.handler',
      code: lambda.Code.fromAsset('dist'),
      role: lambdaRole,
      environment: {
        GITHUB_PRIVATE_KEY_SECRET_ARN: githubSecret.secretArn,
      },
      timeout: cdk.Duration.seconds(60),
    });

    const ciFeedbackLambda = new lambda.Function(this, 'CIFeedbackLambda', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'lambdas/ci-feedback-handler.handler',
      code: lambda.Code.fromAsset('dist'),
      role: lambdaRole,
      environment: {
        GITHUB_PRIVATE_KEY_SECRET_ARN: githubSecret.secretArn,
      },
      timeout: cdk.Duration.seconds(30),
    });

    // Step Functions tasks
    const analyzeIssueTask = new tasks.LambdaInvoke(this, 'AnalyzeIssue', {
      lambdaFunction: issueInterpreterLambda,
      resultPath: '$.issueAnalysis',
    });

    const generatePatchTask = new tasks.LambdaInvoke(this, 'GeneratePatch', {
      lambdaFunction: patchGeneratorLambda,
      resultPath: '$.patchResult',
    });

    const createPRTask = new tasks.LambdaInvoke(this, 'CreatePR', {
      lambdaFunction: prCreatorLambda,
      resultPath: '$.prResult',
    });

    const processCITask = new tasks.LambdaInvoke(this, 'ProcessCI', {
      lambdaFunction: ciFeedbackLambda,
      resultPath: '$.ciResult',
    });

    // Build workflow
    const checkActionable = new sfn.Choice(this, 'CheckIfActionable')
      .when(sfn.Condition.booleanEquals('$.issueAnalysis.actionableTask', true), generatePatchTask)
      .otherwise(new sfn.Succeed(this, 'NotActionable'));

    const validatePatch = new sfn.Choice(this, 'ValidatePatch')
      .when(sfn.Condition.booleanEquals('$.patchResult.validation.valid', true), createPRTask)
      .otherwise(new sfn.Fail(this, 'PatchValidationFailed'));

    const waitForCI = new sfn.Wait(this, 'WaitForCI', {
      time: sfn.WaitTime.duration(cdk.Duration.seconds(60)),
    });

    const checkCIStatus = new sfn.Choice(this, 'CheckCIStatus')
      .when(sfn.Condition.stringEquals('$.ciResult.feedback.overallStatus', 'success'), 
        new sfn.Succeed(this, 'CISuccess'))
      .when(sfn.Condition.stringEquals('$.ciResult.feedback.overallStatus', 'failure'),
        new sfn.Fail(this, 'CIFailure'))
      .otherwise(waitForCI);

    // Chain the workflow
    const definition = analyzeIssueTask
      .next(checkActionable);

    generatePatchTask.next(validatePatch);
    createPRTask.next(waitForCI);
    waitForCI.next(processCITask);
    processCITask.next(checkCIStatus);

    // Create State Machine
    const stateMachine = new sfn.StateMachine(this, 'CodeFabricationWorkflow', {
      definition,
      timeout: cdk.Duration.hours(1),
    });

    // Webhook handler Lambda
    const webhookHandler = new lambda.Function(this, 'WebhookHandler', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'lambdas/issue-analysis-handler.handler',
      code: lambda.Code.fromAsset('dist'),
      role: lambdaRole,
      environment: {
        STEP_FUNCTION_ARN: stateMachine.stateMachineArn,
        GITHUB_PRIVATE_KEY_SECRET_ARN: githubSecret.secretArn,
      },
      timeout: cdk.Duration.seconds(30),
    });

    stateMachine.grantStartExecution(webhookHandler);

    // API Gateway for webhooks
    const api = new apigateway.RestApi(this, 'WebhookAPI', {
      restApiName: 'CodeFactory Webhook API',
      description: 'Receives GitHub webhooks for AFU-9',
    });

    const webhookIntegration = new apigateway.LambdaIntegration(webhookHandler);
    api.root.addResource('webhook').addMethod('POST', webhookIntegration);

    // Outputs
    new cdk.CfnOutput(this, 'WebhookURL', {
      value: api.url + 'webhook',
      description: 'GitHub Webhook URL',
    });

    new cdk.CfnOutput(this, 'StateMachineArn', {
      value: stateMachine.stateMachineArn,
      description: 'Step Functions State Machine ARN',
    });
  }
}
