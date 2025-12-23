"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import Link from "next/link";

function makeCorrelationId() {
  try {
    return crypto.randomUUID();
  } catch {
    return `cc-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }
}

export default function ForgotPasswordPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setSuccess(false);

    try {
      const correlationId = makeCorrelationId();
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "x-correlation-id": correlationId,
        },
        body: JSON.stringify({ username }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Request failed");
      }

      setSuccess(true);
      // Redirect to reset password page after 2 seconds
      setTimeout(() => {
        router.push(`/reset-password?username=${encodeURIComponent(username)}`);
      }, 2000);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Request failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-white flex items-center justify-center p-6">
      <div className="w-full max-w-md rounded-lg border border-slate-800 bg-slate-900/80 p-6 shadow-xl">
        <h1 className="text-2xl font-semibold mb-4">Passwort vergessen</h1>
        <p className="text-sm text-slate-300 mb-6">
          Gib deinen Benutzernamen ein, um einen Passwort-Reset-Code per E-Mail zu erhalten.
        </p>

        {success ? (
          <div className="rounded-md border border-green-500 bg-green-500/10 px-3 py-3 text-sm text-green-200 mb-4">
            <p className="font-medium mb-1">Reset-Code gesendet!</p>
            <p className="text-xs">
              Wenn die E-Mail-Adresse existiert, wurde ein Code gesendet. Du wirst weitergeleitet...
            </p>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="flex flex-col gap-2">
              <label className="text-sm text-slate-300" htmlFor="username">
                Benutzername / E-Mail
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
              {loading ? "Sende..." : "Reset-Code anfordern"}
            </button>
          </form>
        )}

        <div className="mt-6 text-center">
          <Link
            href="/login"
            className="text-sm text-sky-400 hover:text-sky-300 transition-colors"
          >
            ← Zurück zum Login
          </Link>
        </div>
      </div>
    </div>
  );
}
