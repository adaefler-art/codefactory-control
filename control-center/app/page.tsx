import FeatureCard from "@/components/FeatureCard";

export default function Home() {
  return (
    <div className="min-h-screen bg-white dark:bg-black p-8">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-4xl font-bold mb-4 text-black dark:text-white">
          AFU-9 Control Center
        </h1>
        <p className="text-xl mb-8 text-gray-600 dark:text-gray-400">
          Autonomous Fabrication Unit – Ninefold Architecture v0.2
        </p>
        
        <div className="space-y-4">
          <FeatureCard
            href="/dashboard"
            title="Dashboard"
            description="Übersicht über Workflows, Agents, Repositories und System-Status"
            bgColor="bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800 hover:bg-blue-100 dark:hover:bg-blue-900/30"
          />

          <FeatureCard
            href="/workflows"
            title="Workflows"
            description="Workflow-Definitionen verwalten und Workflows auslösen"
            bgColor="bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800 hover:bg-green-100 dark:hover:bg-green-900/30"
          />

          <FeatureCard
            href="/agents"
            title="Agents"
            description="LLM-basierte Agent Runs und Token-Statistiken überwachen"
            bgColor="bg-purple-50 dark:bg-purple-900/20 border-purple-200 dark:border-purple-800 hover:bg-purple-100 dark:hover:bg-purple-900/30"
          />

          <FeatureCard
            href="/repositories"
            title="Repositories"
            description="Verbundene GitHub-Repositories verwalten"
            bgColor="bg-yellow-50 dark:bg-yellow-900/20 border-yellow-200 dark:border-yellow-800 hover:bg-yellow-100 dark:hover:bg-yellow-900/30"
          />

          <FeatureCard
            href="/settings"
            title="Settings"
            description="System-Konfiguration und MCP Server-Status"
            bgColor="bg-gray-50 dark:bg-gray-900/20 border-gray-200 dark:border-gray-800 hover:bg-gray-100 dark:hover:bg-gray-900/30"
          />

          <FeatureCard
            href="/factory"
            title="Factory Status"
            description="Read-only Übersicht der Factory Runs, Verdicts und KPIs (EPIC 08)"
            bgColor="bg-orange-50 dark:bg-orange-900/20 border-orange-200 dark:border-orange-800 hover:bg-orange-100 dark:hover:bg-orange-900/30"
          />

          <FeatureCard
            href="/board"
            title="Project Board"
            description="CodeFactory Board-Ansicht im GitHub-Style – Backlog, In Progress, Done"
            bgColor="bg-purple-50 dark:bg-purple-900/20 border-purple-200 dark:border-purple-800 hover:bg-purple-100 dark:hover:bg-purple-900/30"
          />

          <FeatureCard
            href="/new-feature"
            title="Neues Feature erstellen"
            description="Feature-Briefing eingeben und automatisch GitHub-Issue generieren"
            bgColor="bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800 hover:bg-blue-100 dark:hover:bg-blue-900/30"
          />

          <FeatureCard
            href="/features"
            title="Features anzeigen"
            description="Übersicht aller durch AFU-9 erstellten Features"
            bgColor="bg-gray-50 dark:bg-gray-900/20 border-gray-200 dark:border-gray-800 hover:bg-gray-100 dark:hover:bg-gray-900/30"
          />

          <FeatureCard
            href="/ninefold"
            title="Ninefold Architecture"
            description="Übersicht der 9 Module des AFU-9 Systems"
            bgColor="bg-purple-50 dark:bg-purple-900/20 border-purple-200 dark:border-purple-800 hover:bg-purple-100 dark:hover:bg-purple-900/30"
          />

          <FeatureCard
            href="/webhooks"
            title="GitHub Webhooks"
            description="Monitor und Debug-Ansicht für eingehende GitHub Webhook Events"
            bgColor="bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800 hover:bg-green-100 dark:hover:bg-green-900/30"
          />
        </div>
      </div>
    </div>
  );
}
