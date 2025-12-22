import DeployEventsClient from './DeployEventsClient';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export default function DeployEventsPage() {
  const databaseEnabled = process.env.DATABASE_ENABLED === 'true';

  if (!databaseEnabled) {
    return (
      <div className="space-y-4">
        <div className="rounded-md border p-3 text-sm">
          <div className="font-medium">DB disabled</div>
          <div className="mt-1">
            DATABASE_ENABLED is not set to "true". Deploy events are unavailable.
          </div>
        </div>
      </div>
    );
  }

  const buildVersion = process.env.BUILD_VERSION || 'local';
  const buildCommitHash = process.env.BUILD_COMMIT_HASH || 'local';

  return (
    <DeployEventsClient
      defaultEnv="prod"
      defaultService="control-center"
      buildVersion={buildVersion}
      buildCommitHash={buildCommitHash}
    />
  );
}
