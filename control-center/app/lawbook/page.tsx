"use client";

import { useEffect, useMemo, useState } from "react";

type LawbookScope =
  | "global"
  | "api"
  | "ui"
  | "issues"
  | "workflows"
  | "deploy"
  | "observability";

type LawbookCategory =
  | "safety"
  | "security"
  | "reliability"
  | "quality"
  | "compliance"
  | "performance"
  | "cost"
  | "product"
  | "observability";

type LawbookEnforcement = "hard" | "soft" | "advisory";

type Guardrail = {
  id: string;
  title: string;
  description: string;
  scope: LawbookScope;
  category: LawbookCategory;
  enforcement: LawbookEnforcement;
  createdAt: string;
  updatedAt: string;
};

type LawbookParameter = {
  key: string;
  title: string;
  description: string;
  scope: LawbookScope;
  category: LawbookCategory;
  type: "string" | "number" | "boolean" | "json";
  defaultValue: unknown;
  createdAt: string;
  updatedAt: string;
};

type MemoryEntry = {
  id: string;
  title: string;
  content: string;
  scope: LawbookScope;
  category: LawbookCategory;
  createdAt: string;
  updatedAt: string;
};

type GuardrailsResponse = {
  hash: string;
  version: number;
  guardrails: Guardrail[];
};

type ParametersResponse = {
  hash: string;
  version: number;
  parameters: LawbookParameter[];
};

type MemoryResponse = {
  hash: string;
  seed: { hash: string; version: number; entries: MemoryEntry[] };
  session: { hash: string; version: number; entries: MemoryEntry[] };
};

type Tab = "memory" | "guardrails" | "parameters";

function formatDate(dateString: string) {
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) return dateString;
  return date.toLocaleDateString("de-DE", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function stringifyDefaultValue(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return "[unserializable]";
  }
}

export default function LawbookPage() {
  const [activeTab, setActiveTab] = useState<Tab>("memory");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [guardrails, setGuardrails] = useState<Guardrail[]>([]);
  const [parameters, setParameters] = useState<LawbookParameter[]>([]);
  const [memorySeed, setMemorySeed] = useState<MemoryEntry[]>([]);
  const [memorySession, setMemorySession] = useState<MemoryEntry[]>([]);

  const [scopeFilter, setScopeFilter] = useState<string>("");
  const [categoryFilter, setCategoryFilter] = useState<string>("");
  const [enforcementFilter, setEnforcementFilter] = useState<string>("");

  useEffect(() => {
    let cancelled = false;

    async function loadAll() {
      setLoading(true);
      setError(null);

      try {
        const [gRes, pRes, mRes] = await Promise.all([
          fetch("/api/lawbook/guardrails", { credentials: "include" }),
          fetch("/api/lawbook/parameters", { credentials: "include" }),
          fetch("/api/lawbook/memory", { credentials: "include" }),
        ]);

        if (!gRes.ok) throw new Error("Failed to load guardrails");
        if (!pRes.ok) throw new Error("Failed to load parameters");
        if (!mRes.ok) throw new Error("Failed to load memory");

        const gJson = (await gRes.json()) as GuardrailsResponse;
        const pJson = (await pRes.json()) as ParametersResponse;
        const mJson = (await mRes.json()) as MemoryResponse;

        if (cancelled) return;

        setGuardrails(Array.isArray(gJson.guardrails) ? gJson.guardrails : []);
        setParameters(Array.isArray(pJson.parameters) ? pJson.parameters : []);
        setMemorySeed(Array.isArray(mJson.seed?.entries) ? mJson.seed.entries : []);
        setMemorySession(Array.isArray(mJson.session?.entries) ? mJson.session.entries : []);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load Lawbook");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadAll();

    return () => {
      cancelled = true;
    };
  }, []);

  const scopeOptions = useMemo(() => {
    const scopes = new Set<string>();
    for (const g of guardrails) scopes.add(g.scope);
    for (const p of parameters) scopes.add(p.scope);
    for (const m of memorySeed) scopes.add(m.scope);
    for (const m of memorySession) scopes.add(m.scope);
    return Array.from(scopes).sort();
  }, [guardrails, parameters, memorySeed, memorySession]);

  const categoryOptions = useMemo(() => {
    const categories = new Set<string>();
    for (const g of guardrails) categories.add(g.category);
    for (const p of parameters) categories.add(p.category);
    for (const m of memorySeed) categories.add(m.category);
    for (const m of memorySession) categories.add(m.category);
    return Array.from(categories).sort();
  }, [guardrails, parameters, memorySeed, memorySession]);

  const enforcementOptions = useMemo(() => {
    const enforcements = new Set<string>();
    for (const g of guardrails) enforcements.add(g.enforcement);
    return Array.from(enforcements).sort();
  }, [guardrails]);

  const filteredGuardrails = useMemo(() => {
    return guardrails.filter((g) => {
      if (scopeFilter && g.scope !== scopeFilter) return false;
      if (categoryFilter && g.category !== categoryFilter) return false;
      if (enforcementFilter && g.enforcement !== enforcementFilter) return false;
      return true;
    });
  }, [guardrails, scopeFilter, categoryFilter, enforcementFilter]);

  const filteredParameters = useMemo(() => {
    return parameters.filter((p) => {
      if (scopeFilter && p.scope !== scopeFilter) return false;
      if (categoryFilter && p.category !== categoryFilter) return false;
      return true;
    });
  }, [parameters, scopeFilter, categoryFilter]);

  const filteredMemory = useMemo(() => {
    const all = [
      ...memorySeed.map((e) => ({ ...e, source: "seed" as const })),
      ...memorySession.map((e) => ({ ...e, source: "session" as const })),
    ];

    return all.filter((m) => {
      if (scopeFilter && m.scope !== scopeFilter) return false;
      if (categoryFilter && m.category !== categoryFilter) return false;
      return true;
    });
  }, [memorySeed, memorySession, scopeFilter, categoryFilter]);

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-purple-400">Lawbook</h1>
          <p className="mt-2 text-gray-400">
            Read-only transparency view (Guardrails, Parameters, Memory).
          </p>

          <div className="mt-6 bg-gray-900 border border-gray-800 rounded-lg p-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">Scope</label>
                <select
                  value={scopeFilter}
                  onChange={(e) => setScopeFilter(e.target.value)}
                  className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-md text-gray-100 focus:outline-none focus:ring-2 focus:ring-purple-500"
                >
                  <option value="">All</option>
                  {scopeOptions.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">Category</label>
                <select
                  value={categoryFilter}
                  onChange={(e) => setCategoryFilter(e.target.value)}
                  className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-md text-gray-100 focus:outline-none focus:ring-2 focus:ring-purple-500"
                >
                  <option value="">All</option>
                  {categoryOptions.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">Enforcement</label>
                <select
                  value={enforcementFilter}
                  onChange={(e) => setEnforcementFilter(e.target.value)}
                  className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-md text-gray-100 focus:outline-none focus:ring-2 focus:ring-purple-500"
                >
                  <option value="">All</option>
                  {enforcementOptions.map((enf) => (
                    <option key={enf} value={enf}>
                      {enf}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          <div className="mt-6 flex items-center space-x-2">
            {(
              [
                { id: "memory", label: "Memory" },
                { id: "guardrails", label: "Guardrails" },
                { id: "parameters", label: "Parameters" },
              ] as const
            ).map((t) => (
              <button
                key={t.id}
                onClick={() => setActiveTab(t.id)}
                className={
                  activeTab === t.id
                    ? "px-4 py-2 rounded-md text-sm font-medium bg-purple-900/30 text-purple-200"
                    : "px-4 py-2 rounded-md text-sm font-medium text-gray-200 hover:bg-gray-800 hover:text-white"
                }
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {loading && (
          <div className="text-center py-12">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-purple-500"></div>
            <p className="mt-4 text-gray-400">Loading Lawbook...</p>
          </div>
        )}

        {error && (
          <div className="bg-red-900/20 border border-red-700 rounded-lg p-4 mb-6">
            <p className="text-red-300">Error: {error}</p>
          </div>
        )}

        {!loading && !error && activeTab === "guardrails" && (
          <div className="bg-gray-900 border border-gray-800 rounded-lg overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-800">
              <h2 className="text-lg font-semibold text-gray-100">Guardrails</h2>
              <p className="text-sm text-gray-400">{filteredGuardrails.length} items</p>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-800">
                <thead className="bg-gray-900">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase">ID</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase">Title</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase">Scope</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase">Category</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase">Enforcement</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase">Updated</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-800">
                  {filteredGuardrails.map((g) => (
                    <tr key={g.id} className="hover:bg-gray-800/30">
                      <td className="px-4 py-3 text-sm text-gray-200 font-mono">{g.id}</td>
                      <td className="px-4 py-3 text-sm text-gray-100">
                        <div className="font-medium">{g.title}</div>
                        <div className="text-xs text-gray-400 mt-1">{g.description}</div>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-200">{g.scope}</td>
                      <td className="px-4 py-3 text-sm text-gray-200">{g.category}</td>
                      <td className="px-4 py-3 text-sm text-gray-200">{g.enforcement}</td>
                      <td className="px-4 py-3 text-sm text-gray-300">{formatDate(g.updatedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {!loading && !error && activeTab === "parameters" && (
          <div className="bg-gray-900 border border-gray-800 rounded-lg overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-800">
              <h2 className="text-lg font-semibold text-gray-100">Parameters</h2>
              <p className="text-sm text-gray-400">{filteredParameters.length} items</p>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-800">
                <thead className="bg-gray-900">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase">Key</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase">Title</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase">Type</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase">Scope</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase">Category</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase">Default</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase">Updated</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-800">
                  {filteredParameters.map((p) => (
                    <tr key={p.key} className="hover:bg-gray-800/30">
                      <td className="px-4 py-3 text-sm text-gray-200 font-mono">{p.key}</td>
                      <td className="px-4 py-3 text-sm text-gray-100">
                        <div className="font-medium">{p.title}</div>
                        <div className="text-xs text-gray-400 mt-1">{p.description}</div>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-200">{p.type}</td>
                      <td className="px-4 py-3 text-sm text-gray-200">{p.scope}</td>
                      <td className="px-4 py-3 text-sm text-gray-200">{p.category}</td>
                      <td className="px-4 py-3 text-sm text-gray-200">{stringifyDefaultValue(p.defaultValue)}</td>
                      <td className="px-4 py-3 text-sm text-gray-300">{formatDate(p.updatedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {!loading && !error && activeTab === "memory" && (
          <div className="bg-gray-900 border border-gray-800 rounded-lg overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-800">
              <h2 className="text-lg font-semibold text-gray-100">Memory</h2>
              <p className="text-sm text-gray-400">{filteredMemory.length} items</p>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-800">
                <thead className="bg-gray-900">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase">Source</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase">ID</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase">Title</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase">Scope</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase">Category</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase">Updated</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-800">
                  {filteredMemory.map((m) => (
                    <tr key={`${m.source}:${m.id}`} className="hover:bg-gray-800/30">
                      <td className="px-4 py-3 text-sm text-gray-200">{m.source}</td>
                      <td className="px-4 py-3 text-sm text-gray-200 font-mono">{m.id}</td>
                      <td className="px-4 py-3 text-sm text-gray-100">
                        <div className="font-medium">{m.title}</div>
                        <div className="text-xs text-gray-400 mt-1">{m.content}</div>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-200">{m.scope}</td>
                      <td className="px-4 py-3 text-sm text-gray-200">{m.category}</td>
                      <td className="px-4 py-3 text-sm text-gray-300">{formatDate(m.updatedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
