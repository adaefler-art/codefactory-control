import { SQSClient, ReceiveMessageCommand, DeleteMessageCommand } from '@aws-sdk/client-sqs';
import { getPool } from '../db';
import { extractGithubEvent, parseEnvelope, newRequestId } from './extract';
import { upsertGithubActionDelivery, markGithubActionDeliveryProcessed } from './persistence';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isEnabled(): boolean {
  return process.env.AFU9_GITHUB_EVENTS_CONSUMER_ENABLED === 'true';
}

function getQueueUrl(): string | null {
  const raw = process.env.AFU9_GITHUB_EVENTS_QUEUE_URL;
  const trimmed = typeof raw === 'string' ? raw.trim() : '';
  return trimmed.length > 0 ? trimmed : null;
}

export function startGithubEventsConsumer(): void {
  if (!isEnabled()) {
    console.log('[GitHubEventsConsumer] Disabled (set AFU9_GITHUB_EVENTS_CONSUMER_ENABLED=true to enable).');
    return;
  }

  const queueUrl = getQueueUrl();
  if (!queueUrl) {
    console.log('[GitHubEventsConsumer] Disabled (missing AFU9_GITHUB_EVENTS_QUEUE_URL).');
    return;
  }

  const globalKey = '__afu9_github_events_consumer_started__';
  const anyGlobal = globalThis as any;
  if (anyGlobal[globalKey]) {
    return;
  }
  anyGlobal[globalKey] = true;

  const region = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || 'eu-central-1';
  const sqs = new SQSClient({ region });

  console.log('[GitHubEventsConsumer] Starting poll loop:', { region, queueUrl });

  void runLoop({ sqs, queueUrl });
}

async function runLoop(params: { sqs: SQSClient; queueUrl: string }): Promise<void> {
  const { sqs, queueUrl } = params;

  // Long polling loop. Deterministic processing: sequential within each batch.
  // DLQ handling is done by SQS redrive policy; we do NOT delete messages on failure.
  // This ensures repeated failures move the message to DLQ.

  while (true) {
    const requestId = newRequestId();

    try {
      const response = await sqs.send(
        new ReceiveMessageCommand({
          QueueUrl: queueUrl,
          MaxNumberOfMessages: 10,
          WaitTimeSeconds: 20,
          VisibilityTimeout: 30,
          AttributeNames: ['ApproximateReceiveCount', 'SentTimestamp'],
          MessageAttributeNames: ['All'],
        })
      );

      const messages = response.Messages || [];
      if (messages.length === 0) {
        continue;
      }

      for (const message of messages) {
        const receiptHandle = message.ReceiptHandle;
        const body = message.Body;
        if (!receiptHandle || !body) {
          // Malformed message: leave it for retry/DLQ.
          console.error('[GitHubEventsConsumer] Malformed SQS message (missing receipt/body)', {
            requestId,
            messageId: message.MessageId,
          });
          continue;
        }

        try {
          const envelope = parseEnvelope(body);
          const extracted = extractGithubEvent(envelope as any, body);

          const pool = getPool();
          const upsert = await upsertGithubActionDelivery(pool, extracted);

          if (upsert.status === 'duplicate' && upsert.processed) {
            // Already handled.
            await sqs.send(new DeleteMessageCommand({ QueueUrl: queueUrl, ReceiptHandle: receiptHandle }));
            continue;
          }

          // For now: log + mark processed.
          console.log('[GitHubEventsConsumer] Received event', {
            requestId,
            delivery_id: extracted.delivery_id,
            event_name: extracted.event_name,
            repository_full_name: extracted.repository_full_name,
            messageId: message.MessageId,
            approxReceiveCount: message.Attributes?.ApproximateReceiveCount,
          });

          await markGithubActionDeliveryProcessed(pool, extracted.delivery_id, null);

          await sqs.send(new DeleteMessageCommand({ QueueUrl: queueUrl, ReceiptHandle: receiptHandle }));
        } catch (error) {
          console.error('[GitHubEventsConsumer] Failed to process message; leaving for retry/DLQ', {
            requestId,
            messageId: message.MessageId,
            error: error instanceof Error ? error.message : String(error),
          });

          // Best-effort: if we extracted delivery_id earlier, we'd mark error.
          // Keeping minimal for now; SQS will retry and eventually DLQ.
        }
      }
    } catch (error) {
      console.error('[GitHubEventsConsumer] Poll error; backing off', {
        requestId,
        error: error instanceof Error ? error.message : String(error),
      });
      await sleep(5000);
    }
  }
}
