"use client";

import { useState } from "react";
import { safeFetch, formatErrorMessage } from "@/lib/api/safe-fetch";

export default function NewFeaturePage() {
  const [title, setTitle] = useState("");
  const [briefing, setBriefing] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError(null);

    try {
      const response = await fetch("/api/features", {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ title, briefing }),
      });

      const data = await safeFetch(response);

      if (data.status === "ok") {
        alert(`Feature erstellt: ${data.url}`);
        setTitle("");
        setBriefing("");
      } else {
        const errorMessage = data.error || "Unbekannter Fehler";
        setError(errorMessage);
      }
    } catch (error) {
      console.error("Error submitting feature:", error);
      setError(formatErrorMessage(error));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-white dark:bg-black p-8">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-3xl font-bold mb-6 text-black dark:text-white">
          Neues Feature erstellen
        </h1>
        
        {error && (
          <div className="mb-6 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-md">
            <p className="text-red-800 dark:text-red-200 font-medium">Fehler</p>
            <p className="text-red-700 dark:text-red-300 text-sm mt-1">{error}</p>
          </div>
        )}
        
        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <label 
              htmlFor="title" 
              className="block text-sm font-medium mb-2 text-black dark:text-white"
            >
              Feature-Titel
            </label>
            <input
              type="text"
              id="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
              className="w-full px-4 py-2 border border-gray-300 dark:border-gray-700 rounded-md bg-white dark:bg-gray-900 text-black dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="z.B. User-Login mit OAuth"
            />
          </div>

          <div>
            <label 
              htmlFor="briefing" 
              className="block text-sm font-medium mb-2 text-black dark:text-white"
            >
              Feature-Briefing
            </label>
            <textarea
              id="briefing"
              value={briefing}
              onChange={(e) => setBriefing(e.target.value)}
              required
              rows={10}
              className="w-full px-4 py-2 border border-gray-300 dark:border-gray-700 rounded-md bg-white dark:bg-gray-900 text-black dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="Beschreiben Sie das gewünschte Feature im Detail..."
            />
          </div>

          <button
            type="submit"
            disabled={isSubmitting}
            className="px-6 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white font-medium rounded-md transition-colors"
          >
            {isSubmitting ? "Erstelle Feature..." : "Feature erstellen"}
          </button>
        </form>
      </div>
    </div>
  );
}
