export const runtime = 'nodejs';

declare global {
  // eslint-disable-next-line no-var
  var __afu9GithubEventsConsumerStarted: boolean | undefined;
  // eslint-disable-next-line no-var
  var __afu9ProcessHandlersRegistered: boolean | undefined;
}

export async function register(): Promise<void> {
  // Runs on Node.js server startup (Next instrumentation hook).
  // Keep side-effects minimal and deterministic.

  // If Next ever evaluates instrumentation in an Edge context, bail out.
  if (process.env.NEXT_RUNTIME && process.env.NEXT_RUNTIME !== 'nodejs') return;

  if (!globalThis.__afu9ProcessHandlersRegistered) {
    globalThis.__afu9ProcessHandlersRegistered = true;

    process.on('uncaughtException', (error) => {
      console.error('[PROCESS] uncaughtException', {
        message: error?.message,
        stack: error?.stack,
      });
    });

    process.on('unhandledRejection', (reason) => {
      const error = reason instanceof Error ? reason : undefined;
      console.error('[PROCESS] unhandledRejection', {
        message: error?.message || String(reason),
        stack: error?.stack,
      });
    });
  }

  if (globalThis.__afu9GithubEventsConsumerStarted) return;
  if (process.env.AFU9_GITHUB_EVENTS_CONSUMER_ENABLED !== 'true') return;

  globalThis.__afu9GithubEventsConsumerStarted = true;
  // Use a runtime require so webpack doesn't try to bundle pg (Node-only) into an Edge build.
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const requireFn = eval('require') as (id: string) => any;
  const { startGithubEventsConsumer } = requireFn('./src/lib/github-events/sqs-consumer');
  startGithubEventsConsumer();
}
