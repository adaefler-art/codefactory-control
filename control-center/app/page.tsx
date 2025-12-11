import FeatureCard from "@/components/FeatureCard";

export default function Home() {
  return (
    <div className="min-h-screen bg-white dark:bg-black p-8">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-4xl font-bold mb-4 text-black dark:text-white">
          AFU-9 Control Center
        </h1>
        <p className="text-xl mb-8 text-gray-600 dark:text-gray-400">
          Autonomous Fabrication Unit – Ninefold Architecture v0.1
        </p>
        
        <div className="space-y-4">
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
          />
        </div>
      </div>
    </div>
  );
}
