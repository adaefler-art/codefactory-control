import Link from "next/link";

export default function Home() {
  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-8 py-16">
        <div className="text-center mb-12">
          <h1 className="text-4xl font-bold text-gray-900 mb-4">
            AFU-9 Control Center
          </h1>
          <p className="text-xl text-gray-600">
            Autonomous Fabrication Unit – Ninefold Architecture
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 max-w-5xl mx-auto">
          <Link
            href="/workflows"
            className="bg-white rounded-lg shadow-lg p-8 hover:shadow-xl transition-shadow"
          >
            <div className="text-3xl mb-4">🔄</div>
            <h2 className="text-xl font-semibold text-gray-900 mb-2">
              Workflows
            </h2>
            <p className="text-gray-600">
              View and manage AFU-9 workflows. Trigger executions and monitor progress.
            </p>
          </Link>

          <Link
            href="/new-feature"
            className="bg-white rounded-lg shadow-lg p-8 hover:shadow-xl transition-shadow"
          >
            <div className="text-3xl mb-4">✨</div>
            <h2 className="text-xl font-semibold text-gray-900 mb-2">
              New Feature
            </h2>
            <p className="text-gray-600">
              Create a new feature briefing and generate a GitHub issue.
            </p>
          </Link>

          <Link
            href="/features"
            className="bg-white rounded-lg shadow-lg p-8 hover:shadow-xl transition-shadow"
          >
            <div className="text-3xl mb-4">📋</div>
            <h2 className="text-xl font-semibold text-gray-900 mb-2">
              Features
            </h2>
            <p className="text-gray-600">
              View all features created by AFU-9.
            </p>
          </Link>
        </div>

        <div className="mt-16 text-center">
          <div className="inline-block bg-blue-50 rounded-lg px-6 py-4">
            <p className="text-sm text-gray-600 mb-2">Version 0.2</p>
            <p className="text-xs text-gray-500">
              Control Center + MCP Servers on ECS
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
