"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, useState, Suspense } from "react";
import Link from "next/link";

function ResetPasswordForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const usernameParam = searchParams.get("username") || "";

  const [username, setUsername] = useState(usernameParam);
  const [code, setCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setSuccess(false);

    // Validate passwords match
    if (newPassword !== confirmPassword) {
      setError("Passwörter stimmen nicht überein");
      setLoading(false);
      return;
    }

    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, code, newPassword }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Password reset failed");
      }

      setSuccess(true);
      // Redirect to login after 2 seconds
      setTimeout(() => {
        router.push("/login");
      }, 2000);
    } catch (err: any) {
      setError(err.message || "Password reset failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-white flex items-center justify-center p-6">
      <div className="w-full max-w-md rounded-lg border border-slate-800 bg-slate-900/80 p-6 shadow-xl">
        <h1 className="text-2xl font-semibold mb-4">Neues Passwort setzen</h1>
        <p className="text-sm text-slate-300 mb-6">
          Gib den Reset-Code aus deiner E-Mail und dein neues Passwort ein.
        </p>

        {success ? (
          <div className="rounded-md border border-green-500 bg-green-500/10 px-3 py-3 text-sm text-green-200 mb-4">
            <p className="font-medium mb-1">Passwort erfolgreich geändert!</p>
            <p className="text-xs">Du wirst zum Login weitergeleitet...</p>
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

            <div className="flex flex-col gap-2">
              <label className="text-sm text-slate-300" htmlFor="code">
                Reset-Code
              </label>
              <input
                id="code"
                name="code"
                type="text"
                className="w-full rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-white focus:border-sky-500 focus:outline-none font-mono"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="123456"
                required
              />
            </div>

            <div className="flex flex-col gap-2">
              <label className="text-sm text-slate-300" htmlFor="newPassword">
                Neues Passwort
              </label>
              <input
                id="newPassword"
                name="newPassword"
                type="password"
                className="w-full rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-white focus:border-sky-500 focus:outline-none"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                autoComplete="new-password"
                required
              />
            </div>

            <div className="flex flex-col gap-2">
              <label className="text-sm text-slate-300" htmlFor="confirmPassword">
                Passwort bestätigen
              </label>
              <input
                id="confirmPassword"
                name="confirmPassword"
                type="password"
                className="w-full rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-white focus:border-sky-500 focus:outline-none"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                autoComplete="new-password"
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
              {loading ? "Setze Passwort..." : "Passwort setzen"}
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

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-slate-950 text-white flex items-center justify-center">Laden...</div>}>
      <ResetPasswordForm />
    </Suspense>
  );
}
