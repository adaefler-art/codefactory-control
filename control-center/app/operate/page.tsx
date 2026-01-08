"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { API_ROUTES } from "@/lib/api-routes";

interface WhoamiData {
  sub: string;
  isAdmin: boolean;
}

export default function OperatePage() {
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  const [whoami, setWhoami] = useState<WhoamiData | null>(null);
  const [whoamiLoading, setWhoamiLoading] = useState(true);

  const handleSync = async () => {
    if (!whoami?.isAdmin) {
      setSyncMessage({
        type: "error",
        text: "Admin access required to sync GitHub issues.",
      });
      return;
    }

    setIsSyncing(true);
    setSyncMessage(null);

    try {
      const response = await fetch(API_ROUTES.ops.issues.sync, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || data.details || "Sync failed");
      }

      setSyncMessage({
        type: "success",
        text: `✅ Synced ${data.upserted || 0} issues successfully (${data.statusSynced || 0} statuses updated)`,
      });
    } catch (err) {
      setSyncMessage({
        type: "error",
        text: `❌ Sync failed: ${err instanceof Error ? err.message : String(err)}`,
      });
    } finally {
      setIsSyncing(false);
    }
  };

  useEffect(() => {
    let isMounted = true;

    const fetchWhoami = async () => {
      setWhoamiLoading(true);
      try {
        const response = await fetch(API_ROUTES.ops.whoami, {
          credentials: "include",
          cache: "no-store",
        });

        if (!isMounted) return;

        if (response.ok) {
          const data = (await response.json()) as WhoamiData;
          setWhoami(data);
          return;
        }

        setWhoami(null);
      } catch {
        if (!isMounted) return;
        setWhoami(null);
      } finally {
        if (!isMounted) return;
        setWhoamiLoading(false);
      }
    };

    fetchWhoami();

    return () => {
      isMounted = false;
    };
  }, []);

  const operateItems = [
    {
      href: "/workflows",
      title: "Workflows",
      description: "Workflow-Definitionen verwalten und Workflows auslösen",
      icon: "⚙️",
    },
    {
      href: "/agents",
      title: "Agents",
      description: "LLM-basierte Agent Runs und Token-Statistiken überwachen",
      icon: "🤖",
    },
    {
      href: "/factory",
      title: "Factory Status",
      description: "Read-only Übersicht der Factory Runs, Verdicts und KPIs",
      icon: "🏭",
    },
    {
      href: "/deploy/status",
      title: "Deploy Status",
      description: "ECS Service Status und Deployment-Überwachung",
      icon: "🚀",
    },
    {
      href: "/repositories",
      title: "Repositories",
      description: "Verbundene GitHub-Repositories verwalten",
      icon: "📚",
    },
  ];

  return (
    <div className="min-h-screen bg-[#0d1117] text-gray-200">
      <div className="border-b border-gray-800 bg-[#161b22]">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-semibold text-gray-200">Operate</h1>
              <p className="text-sm text-gray-400 mt-1">
                Workflow-Ausführung, Agent-Runs, Factory Status und Repository-Verwaltung
              </p>
            </div>

            {/* Sync Button */}
            <button
              onClick={handleSync}
              disabled={isSyncing || whoamiLoading || !whoami?.isAdmin}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-md font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {whoamiLoading
                ? "Loading..."
                : isSyncing
                  ? "Syncing..."
                  : "Sync GitHub Issues Now"}
            </button>
          </div>

          {!whoamiLoading && whoami && !whoami.isAdmin && (
            <div className="mt-2 text-sm text-gray-400">
              Admin access required to sync GitHub issues.
            </div>
          )}

          {/* Sync Message Toast */}
          {syncMessage && (
            <div
              className={`mt-4 p-4 rounded-md border ${
                syncMessage.type === "success"
                  ? "bg-green-900/20 border-green-700 text-green-200"
                  : "bg-red-900/20 border-red-700 text-red-200"
              }`}
            >
              {syncMessage.text}
            </div>
          )}
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-8">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {operateItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="block bg-gray-900/50 border border-gray-800 rounded-lg p-6 hover:bg-gray-900/70 hover:border-purple-800 transition-all"
            >
              <div className="flex items-start gap-4">
                <div className="text-3xl">{item.icon}</div>
                <div className="flex-1">
                  <h3 className="text-lg font-semibold text-gray-200 mb-2">
                    {item.title}
                  </h3>
                  <p className="text-sm text-gray-400">{item.description}</p>
                </div>
                <svg
                  className="w-5 h-5 text-gray-500"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9 5l7 7-7 7"
                  />
                </svg>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
