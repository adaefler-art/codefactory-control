export default function NinefoldPage() {
  const modules = [
    {
      name: "Intake Node",
      description: "Erfasst und validiert eingehende Feature-Requests und Issue-Informationen",
      role: "Eingangspunkt für Anforderungen",
    },
    {
      name: "Spec Engine",
      description: "Generiert technische Spezifikationen aus Feature-Briefings mittels LLM",
      role: "Anforderungsanalyse",
    },
    {
      name: "Architect Core",
      description: "Entwirft Lösungsarchitektur und definiert Implementierungsschritte",
      role: "Architekturplanung",
    },
    {
      name: "Builder Forge",
      description: "Generiert und patcht Code-Artefakte basierend auf Spezifikation",
      role: "Code-Generierung",
    },
    {
      name: "Test Lattice",
      description: "Erstellt und führt Tests aus, validiert Code-Qualität",
      role: "Qualitätssicherung",
    },
    {
      name: "Evaluator Shard",
      description: "Bewertet CI-Ergebnisse und entscheidet über nächste Schritte",
      role: "Ergebnisauswertung",
    },
    {
      name: "Integration Matrix",
      description: "Verwaltet Branch-Management und Pull Request-Integration",
      role: "Code-Integration",
    },
    {
      name: "Deployment Array",
      description: "Orchestriert Deployment-Prozesse und Rollout-Strategien",
      role: "Bereitstellung",
    },
    {
      name: "Evolution Engine",
      description: "Lernt aus Feedback und optimiert den Fabrication-Prozess kontinuierlich",
      role: "Kontinuierliche Verbesserung",
    },
  ];

  return (
    <div className="min-h-screen bg-white dark:bg-black p-8">
      <div className="max-w-7xl mx-auto">
        <h1 className="text-4xl font-bold mb-4 text-black dark:text-white">
          Ninefold Architecture
        </h1>
        <p className="text-xl mb-8 text-gray-600 dark:text-gray-400">
          Die 9 Module des AFU-9 (Autonomous Fabrication Unit) Systems
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {modules.map((module, index) => (
            <div
              key={index}
              className="p-6 bg-gray-50 dark:bg-gray-900/20 border border-gray-200 dark:border-gray-800 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-900/30 transition-colors"
            >
              <div className="flex items-start gap-3 mb-3">
                <span className="text-2xl font-bold text-purple-600 dark:text-purple-400">
                  {index + 1}
                </span>
                <h2 className="text-xl font-semibold text-black dark:text-white">
                  {module.name}
                </h2>
              </div>
              <p className="text-gray-700 dark:text-gray-300 mb-3">
                {module.description}
              </p>
              <div className="pt-3 border-t border-gray-200 dark:border-gray-700">
                <span className="text-sm font-medium text-purple-600 dark:text-purple-400">
                  Rolle:
                </span>
                <span className="text-sm text-gray-600 dark:text-gray-400 ml-2">
                  {module.role}
                </span>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-12 p-6 bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-800 rounded-lg">
          <h3 className="text-xl font-semibold mb-3 text-black dark:text-white">
            Über die Ninefold Architecture
          </h3>
          <p className="text-gray-700 dark:text-gray-300 mb-3">
            Die Ninefold Architecture ist das Herzstück von AFU-9 und orchestriert
            den gesamten autonomen Code-Fabrication-Prozess. Von der initialen
            Feature-Aufnahme bis zur finalen Deployment-Phase arbeiten alle 9 Module
            zusammen, um hochqualitative Software-Artefakte zu erzeugen.
          </p>
          <p className="text-gray-700 dark:text-gray-300">
            Jedes Modul erfüllt eine spezifische Rolle im Wertstrom und kommuniziert
            über AWS Step Functions und Lambda-Funktionen mit den anderen Modulen.
          </p>
        </div>
      </div>
    </div>
  );
}
