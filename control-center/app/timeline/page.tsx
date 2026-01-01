"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface TimelineIssue {
  id: string;
  number: number;
  title: string;
  state: string;
  updated_at: string;
}

export default function TimelinePage() {
  const [issues, setIssues] = useState<TimelineIssue[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function fetchIssues() {
      try {
        const response = await fetch("/api/issues", { credentials: "include" });
        const data = await response.json();
        
        if (response.ok) {
          setIssues(data.issues || []);
        }
      } catch (err) {
        console.error("Error fetching issues:", err);
      } finally {
        setIsLoading(false);
      }
    }

    fetchIssues();
  }, []);

  return (
    <div className="min-h-screen bg-[#0d1117] text-gray-200">
      <div className="border-b border-gray-800 bg-[#161b22]">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <h1 className="text-2xl font-semibold text-gray-200">Timeline</h1>
          <p className="text-sm text-gray-400 mt-1">
            Issue-bezogene Timeline-Ansicht mit Chain-Tracking
          </p>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-8">
        {isLoading ? (
          <div className="text-center py-12">
            <p className="text-gray-400">Lädt Timeline...</p>
          </div>
        ) : issues.length === 0 ? (
          <div className="bg-gray-900/50 border border-gray-800 rounded-lg p-8 text-center">
            <p className="text-gray-400">Keine Issues gefunden</p>
            <p className="text-sm text-gray-500 mt-2">
              Timeline-Ansicht zeigt die Verlaufskette von Issues
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {issues.map((issue) => (
              <Link
                key={issue.id}
                href={`/timeline/${issue.id}`}
                className="block bg-gray-900/50 border border-gray-800 rounded-lg p-4 hover:bg-gray-900/70 transition-colors"
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-sm text-gray-400">#{issue.number}</span>
                      <span
                        className={`text-xs px-2 py-0.5 rounded ${
                          issue.state === "open"
                            ? "bg-green-900/30 text-green-400"
                            : "bg-purple-900/30 text-purple-400"
                        }`}
                      >
                        {issue.state}
                      </span>
                    </div>
                    <h3 className="text-base font-medium text-gray-200">
                      {issue.title}
                    </h3>
                    <p className="text-xs text-gray-500 mt-1">
                      Updated: {new Date(issue.updated_at).toLocaleDateString("de-DE")}
                    </p>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
