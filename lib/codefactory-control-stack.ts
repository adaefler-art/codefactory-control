import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as lambdaNode from 'aws-cdk-lib/aws-lambda-nodejs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import * as tasks from 'aws-cdk-lib/aws-stepfunctions-tasks';

export class CodefactoryControlStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Common lambda props
    const lambdaDefaults: Partial<lambdaNode.NodejsFunctionProps> = {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'handler'
    };

    const issueInterpreterFn = new lambdaNode.NodejsFunction(this, 'Afu9IssueInterpreterFn', {
      entry: 'infra/lambdas/afu9_issue_interpreter.ts',
      ...lambdaDefaults
    });

    const patchGeneratorFn = new lambdaNode.NodejsFunction(this, 'Afu9PatchGeneratorFn', {
      entry: 'infra/lambdas/afu9_patch_generator.ts',
      ...lambdaDefaults
    });

    const prCreatorFn = new lambdaNode.NodejsFunction(this, 'Afu9PrCreatorFn', {
      entry: 'infra/lambdas/afu9_pr_creator.ts',
      timeout: cdk.Duration.minutes(5),
      ...lambdaDefaults
    });

    const orchestratorFn = new lambdaNode.NodejsFunction(this, 'Afu9OrchestratorFn', {
      entry: 'infra/lambdas/afu9_orchestrator.ts',
      ...lambdaDefaults
    });

    // Step Functions definition
    const issueInterpreterTask = new tasks.LambdaInvoke(this, 'IssueInterpreter', {
      lambdaFunction: issueInterpreterFn,
      outputPath: '$'
    });

    const contextBuilderPass = new sfn.Pass(this, 'ContextBuilder', {
      comment: 'v0.1: rudimentary context build (no-op)'
    });

    const patchGeneratorTask = new tasks.LambdaInvoke(this, 'PatchGenerator', {
      lambdaFunction: patchGeneratorFn,
      outputPath: '$'
    });

    const prCreatorTask = new tasks.LambdaInvoke(this, 'PrCreator', {
      lambdaFunction: prCreatorFn,
      outputPath: '$'
    });

    const definition = issueInterpreterTask
      .next(contextBuilderPass)
      .next(patchGeneratorTask)
      .next(prCreatorTask);

    const stateMachine = new sfn.StateMachine(this, 'Afu9BugfixStateMachine', {
      definition,
      stateMachineType: sfn.StateMachineType.STANDARD
    });

    // Orchestrator needs permission to start executions
    stateMachine.grantStartExecution(orchestratorFn);

    // Pass state machine ARN to orchestrator
    orchestratorFn.addEnvironment('AFU9_STATE_MACHINE_ARN', stateMachine.stateMachineArn);
  }
}
