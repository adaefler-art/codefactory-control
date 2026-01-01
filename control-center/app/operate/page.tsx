"use client";

import Link from "next/link";

export default function OperatePage() {
  const operateItems = [
    {
      href: "/workflows",
      title: "Workflows",
      description: "Workflow-Definitionen verwalten und Workflows auslösen",
      icon: "⚙️",
    },
    {
      href: "/agents",
      title: "Agents",
      description: "LLM-basierte Agent Runs und Token-Statistiken überwachen",
      icon: "🤖",
    },
    {
      href: "/factory",
      title: "Factory Status",
      description: "Read-only Übersicht der Factory Runs, Verdicts und KPIs",
      icon: "🏭",
    },
    {
      href: "/deploy/status",
      title: "Deploy Status",
      description: "ECS Service Status und Deployment-Überwachung",
      icon: "🚀",
    },
    {
      href: "/repositories",
      title: "Repositories",
      description: "Verbundene GitHub-Repositories verwalten",
      icon: "📚",
    },
  ];

  return (
    <div className="min-h-screen bg-[#0d1117] text-gray-200">
      <div className="border-b border-gray-800 bg-[#161b22]">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <h1 className="text-2xl font-semibold text-gray-200">Operate</h1>
          <p className="text-sm text-gray-400 mt-1">
            Workflow-Ausführung, Agent-Runs, Factory Status und Repository-Verwaltung
          </p>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-8">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {operateItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="block bg-gray-900/50 border border-gray-800 rounded-lg p-6 hover:bg-gray-900/70 hover:border-purple-800 transition-all"
            >
              <div className="flex items-start gap-4">
                <div className="text-3xl">{item.icon}</div>
                <div className="flex-1">
                  <h3 className="text-lg font-semibold text-gray-200 mb-2">
                    {item.title}
                  </h3>
                  <p className="text-sm text-gray-400">{item.description}</p>
                </div>
                <svg
                  className="w-5 h-5 text-gray-500"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9 5l7 7-7 7"
                  />
                </svg>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
