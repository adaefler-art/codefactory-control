"use client";

import { useEffect, useState } from "react";

interface Issue {
  number: number;
  title: string;
  state: string;
  createdAt: string;
  htmlUrl: string;
}

export default function FeaturesPage() {
  const [issues, setIssues] = useState<Issue[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchIssues() {
      try {
        const response = await fetch("/api/features");
        
        if (!response.ok) {
          const data = await response.json().catch(() => ({ error: "Unknown error" }));
          setError(data.error || `Server error: ${response.status}`);
          return;
        }

        const data = await response.json();

        if (data.status === "ok") {
          setIssues(data.issues);
        } else {
          setError(data.error || "Fehler beim Laden der Features");
        }
      } catch (err) {
        console.error("Error fetching issues:", err);
        setError("Fehler beim Laden der Features");
      } finally {
        setIsLoading(false);
      }
    }

    fetchIssues();
  }, []);

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString("de-DE", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  };

  return (
    <div className="min-h-screen bg-white dark:bg-black p-8">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-3xl font-bold mb-6 text-black dark:text-white">
          Features
        </h1>

        {isLoading && (
          <p className="text-gray-600 dark:text-gray-400">Lädt Features...</p>
        )}

        {error && (
          <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
            <p className="text-red-800 dark:text-red-300">{error}</p>
          </div>
        )}

        {!isLoading && !error && issues.length === 0 && (
          <div className="bg-gray-50 dark:bg-gray-900/20 border border-gray-200 dark:border-gray-800 rounded-lg p-8 text-center">
            <p className="text-gray-600 dark:text-gray-400 text-lg mb-2">
              Keine Features gefunden
            </p>
            <p className="text-gray-500 dark:text-gray-500 text-sm">
              Es wurden noch keine Features durch AFU-9 erstellt.
            </p>
          </div>
        )}

        {!isLoading && !error && issues.length > 0 && (
          <div className="space-y-4">
            {issues.map((issue) => (
              <a
                key={issue.number}
                href={issue.htmlUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="block p-6 bg-gray-50 dark:bg-gray-900/20 border border-gray-200 dark:border-gray-800 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-900/30 transition-colors"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <h2 className="text-xl font-semibold mb-2 text-black dark:text-white">
                      {issue.title}
                    </h2>
                    <div className="flex items-center gap-4 text-sm text-gray-600 dark:text-gray-400">
                      <span
                        className={`px-2 py-1 rounded-full text-xs font-medium ${
                          issue.state === "open"
                            ? "bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300"
                            : "bg-purple-100 dark:bg-purple-900/30 text-purple-800 dark:text-purple-300"
                        }`}
                      >
                        {issue.state === "open" ? "Offen" : "Geschlossen"}
                      </span>
                      <span>Erstellt: {formatDate(issue.createdAt)}</span>
                      <span className="text-gray-400 dark:text-gray-500">
                        #{issue.number}
                      </span>
                    </div>
                  </div>
                  <svg
                    className="w-5 h-5 text-gray-400 dark:text-gray-600 flex-shrink-0"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
                    />
                  </svg>
                </div>
              </a>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
