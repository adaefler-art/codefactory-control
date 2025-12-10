import Link from "next/link";

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
          <Link
            href="/new-feature"
            className="block p-6 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg hover:bg-blue-100 dark:hover:bg-blue-900/30 transition-colors"
          >
            <h2 className="text-xl font-semibold mb-2 text-black dark:text-white">
              Neues Feature erstellen
            </h2>
            <p className="text-gray-600 dark:text-gray-400">
              Feature-Briefing eingeben und automatisch GitHub-Issue generieren
            </p>
          </Link>

          <Link
            href="/features"
            className="block p-6 bg-gray-50 dark:bg-gray-900/20 border border-gray-200 dark:border-gray-800 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-900/30 transition-colors"
          >
            <h2 className="text-xl font-semibold mb-2 text-black dark:text-white">
              Features anzeigen
            </h2>
            <p className="text-gray-600 dark:text-gray-400">
              Übersicht aller durch AFU-9 erstellten Features
            </p>
          </Link>
        </div>
      </div>
    </div>
  );
}
