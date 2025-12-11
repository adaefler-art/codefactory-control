"use client";

import { useState } from "react";

export default function NewFeaturePage() {
  const [title, setTitle] = useState("");
  const [briefing, setBriefing] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    try {
      const response = await fetch("/api/features", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ title, briefing }),
      });

      const data = await response.json();

      if (response.ok && data.status === "ok") {
        alert(`Feature erstellt: ${data.url}`);
        setTitle("");
        setBriefing("");
      } else {
        alert(`Fehler: ${data.error || "Unbekannter Fehler"}`);
      }
    } catch (error) {
      console.error("Error submitting feature:", error);
      alert("Fehler beim Erstellen des Features");
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
