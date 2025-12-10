/**
 * Issue Analysis Lambda Function
 * Triggered by GitHub webhook for new issues
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { SFNClient, StartExecutionCommand } from '@aws-sdk/client-sfn';
import { parseWebhookEvent, verifyWebhookSignature } from '../github/github-client';
import { configManager } from '../config/config-manager';

const sfnClient = new SFNClient({ region: process.env.AWS_REGION });

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  try {
    // Verify webhook signature
    const signature = event.headers['x-hub-signature-256'] || '';
    const config = configManager.getConfig();
    
    if (!verifyWebhookSignature(event.body || '', signature, config.github.webhookSecret)) {
      return {
        statusCode: 401,
        body: JSON.stringify({ message: 'Invalid signature' }),
      };
    }

    // Parse webhook event
    const webhookEvent = parseWebhookEvent(event.body || '');

    // Only process issue events
    if (!webhookEvent.issue) {
      return {
        statusCode: 200,
        body: JSON.stringify({ message: 'Not an issue event' }),
      };
    }

    // Only process opened issues
    if (webhookEvent.action !== 'opened') {
      return {
        statusCode: 200,
        body: JSON.stringify({ message: 'Ignoring non-opened issue action' }),
      };
    }

    // Start Step Functions workflow
    const input = {
      issueNumber: webhookEvent.issue.number,
      repository: `${webhookEvent.repository.owner.login}/${webhookEvent.repository.name}`,
      owner: webhookEvent.repository.owner.login,
      repo: webhookEvent.repository.name,
      title: webhookEvent.issue.title,
      body: webhookEvent.issue.body,
      labels: webhookEvent.issue.labels.map(l => l.name),
      defaultBranch: webhookEvent.repository.default_branch,
    };

    const command = new StartExecutionCommand({
      stateMachineArn: config.aws.stepFunctionArn,
      input: JSON.stringify(input),
    });

    const result = await sfnClient.send(command);

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: 'Workflow started',
        executionArn: result.executionArn,
      }),
    };
  } catch (error) {
    console.error('Error processing webhook:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ message: 'Internal server error' }),
    };
  }
}
