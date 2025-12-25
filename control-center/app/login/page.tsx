"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useState, useEffect } from "react";
import Link from "next/link";
import { safeFetch, formatErrorMessage } from "@/lib/api/safe-fetch";

interface BuildMetadata {
  version: string;
  timestamp: string;
  commitHash: string;
  environment: string;
}

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [buildMetadata, setBuildMetadata] = useState<BuildMetadata | null>(null);

  // Fetch build metadata on component mount
  useEffect(() => {
    fetch('/api/build-metadata', { credentials: 'include' })
      .then(res => safeFetch(res))
      .then(data => setBuildMetadata(data))
      .catch(err => console.error('Failed to load build metadata:', err));
  }, []);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ username, password }),
      });
      await safeFetch(res);
      router.push("/dashboard");
    } catch (err: unknown) {
      setError(formatErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const formatTimestamp = (timestamp: string) => {
    try {
      const date = new Date(timestamp);
      return date.toISOString().replace('T', ' ').split('.')[0] + ' UTC';
    } catch {
      return timestamp;
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-white flex items-center justify-center p-6">
      <div className="w-full max-w-md rounded-lg border border-slate-800 bg-slate-900/80 p-6 shadow-xl">
        <h1 className="text-2xl font-semibold mb-4">AFU-9 Login</h1>
        <p className="text-sm text-slate-300 mb-6">
          Bitte melde dich mit deinem Cognito-Benutzernamen und Passwort an.
        </p>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="flex flex-col gap-2">
            <label className="text-sm text-slate-300" htmlFor="username">
              Benutzername
            </label>
            <input
              id="username"
              name="username"
              type="text"
              className="w-full rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-white focus:border-sky-500 focus:outline-none"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              required
            />
          </div>
          <div className="flex flex-col gap-2">
            <label className="text-sm text-slate-300" htmlFor="password">
              Passwort
            </label>
            <input
              id="password"
              name="password"
              type="password"
              className="w-full rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-white focus:border-sky-500 focus:outline-none"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
          </div>
          {error && (
            <div className="rounded-md border border-red-500 bg-red-500/10 px-3 py-2 text-sm text-red-200">
              {error}
            </div>
          )}
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-md bg-sky-500 px-3 py-2 font-semibold text-white shadow hover:bg-sky-400 disabled:cursor-not-allowed disabled:opacity-70"
          >
            {loading ? "Anmelden..." : "Anmelden"}
          </button>
        </form>

        <div className="mt-4 text-center">
          <Link
            href="/forgot-password"
            className="text-sm text-sky-400 hover:text-sky-300 transition-colors"
          >
            Passwort vergessen?
          </Link>
        </div>

        {buildMetadata && (
          <div className="mt-6 pt-4 border-t border-slate-700 text-center text-xs text-slate-400 space-y-1">
            <div className="font-mono">
              AFU-9 · v{buildMetadata.version} · {buildMetadata.commitHash}
            </div>
            <div>
              deployed {formatTimestamp(buildMetadata.timestamp)}
            </div>
            {buildMetadata.environment !== 'development' && (
              <div className="text-slate-500">
                {buildMetadata.environment}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
