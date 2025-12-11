"use client";

import { useState } from "react";

export default function NewFeaturePage() {
  const [title, setTitle] = useState("");
  const [briefing, setBriefing] = useState("");
  const [loading, setLoading] = useState(false);
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setResultUrl(null);

    try {
      const res = await fetch("/api/features", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, briefing }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? "Unbekannter Fehler");
        return;
      }

      setResultUrl(data.url);
    } catch (err) {
      console.error(err);
      setError("Netzwerk- oder Serverfehler");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      <h1 className="text-2xl font-bold">Neues Feature für AFU-9</h1>
      <p className="text-sm text-gray-600">
        Gib ein kurzes Briefing ein – AFU-9 erzeugt eine Spezifikation und legt
        ein GitHub-Issue im Rhythm-Repo an.
      </p>

      <form onSubmit={handleSubmit} className="space-y-3">
        <input
          className="border p-2 w-full"
          placeholder="Feature-Titel"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          required
        />

        <textarea
          className="border p-2 w-full h-40"
          placeholder="Briefing (Ziel, Kontext, betroffene Flows, etc.)"
          value={briefing}
          onChange={(e) => setBriefing(e.target.value)}
          required
        />

        <button
          type="submit"
          disabled={loading}
          className="bg-black text-white px-4 py-2 disabled:opacity-60"
        >
          {loading ? "AFU-9 arbeitet..." : "Feature anlegen"}
        </button>
      </form>

      {error && <p className="text-red-600 text-sm">Fehler: {error}</p>}

      {resultUrl && (
        <p className="text-sm">
          Issue angelegt:{" "}
          <a
            href={resultUrl}
            target="_blank"
            rel="noreferrer"
            className="text-blue-600 underline"
          >
            {resultUrl}
          </a>
        </p>
      )}
    </div>
  );
}
