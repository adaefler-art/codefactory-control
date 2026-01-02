"use client";

import { useEffect, useState } from "react";
import { API_ROUTES } from "@/lib/api-routes";
import { RiskClass } from "@/lib/flags-env-catalog";

interface EffectiveConfigValue {
  key: string;
  value: string | number | boolean | null;
  source: string;
  expectedType: string;
  actualType: string;
  isSet: boolean;
  isMissing: boolean;
  config: {
    description: string;
    riskClass: string;
    required: boolean;
    defaultValue: any;
    tags: string[];
    source: string;
  };
}

interface EffectiveConfigReport {
  timestamp: string;
  environment: string;
  values: EffectiveConfigValue[];
  missing: EffectiveConfigValue[];
  missingRequired: EffectiveConfigValue[];
  summary: {
    total: number;
    set: number;
    missing: number;
    missingRequired: number;
    fromBuild: number;
    fromEnv: number;
    fromDefault: number;
  };
}

interface FlagsEnvResponse {
  ok: boolean;
  catalog: {
    version: string;
    lastUpdated: string;
    totalFlags: number;
  };
  effective: EffectiveConfigReport;
}

export default function FlagsEnvPage() {
  const [data, setData] = useState<FlagsEnvResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filterRisk, setFilterRisk] = useState<string>("all");
  const [filterSource, setFilterSource] = useState<string>("all");
  const [filterTag, setFilterTag] = useState<string>("all");
  const [showOnlyMissing, setShowOnlyMissing] = useState(false);

  useEffect(() => {
    async function fetchData() {
      try {
        const response = await fetch(API_ROUTES.system.flagsEnv, {
          credentials: "include",
        });
        const result = await response.json();

        if (response.ok) {
          setData(result);
        } else {
          setError(result.error || "Failed to load configuration");
        }
      } catch (err) {
        console.error("Error fetching flags/env data:", err);
        setError("Fehler beim Laden der Konfiguration");
      } finally {
        setIsLoading(false);
      }
    }

    fetchData();
  }, []);

  const handleExportJSON = () => {
    if (!data) return;

    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `flags-env-config-${new Date().toISOString().split("T")[0]}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Get unique tags
  const allTags = data
    ? Array.from(
        new Set(data.effective.values.flatMap((v) => v.config.tags))
      ).sort()
    : [];

  // Filter values
  const filteredValues = data
    ? data.effective.values.filter((v) => {
        if (showOnlyMissing && v.isSet) return false;
        if (filterRisk !== "all" && v.config.riskClass !== filterRisk)
          return false;
        if (filterSource !== "all" && v.source !== filterSource) return false;
        if (filterTag !== "all" && !v.config.tags.includes(filterTag))
          return false;
        return true;
      })
    : [];

  const getRiskBadgeClass = (risk: string) => {
    switch (risk) {
      case RiskClass.CRITICAL:
        return "bg-red-900/30 text-red-400 border-red-800";
      case RiskClass.HIGH:
        return "bg-orange-900/30 text-orange-400 border-orange-800";
      case RiskClass.MEDIUM:
        return "bg-yellow-900/30 text-yellow-400 border-yellow-800";
      case RiskClass.LOW:
        return "bg-green-900/30 text-green-400 border-green-800";
      default:
        return "bg-gray-900/30 text-gray-400 border-gray-800";
    }
  };

  const getSourceBadgeClass = (source: string) => {
    switch (source) {
      case "build":
        return "bg-blue-900/30 text-blue-400";
      case "environment":
        return "bg-purple-900/30 text-purple-400";
      case "default":
        return "bg-gray-900/30 text-gray-400";
      case "missing":
        return "bg-red-900/30 text-red-400";
      default:
        return "bg-gray-900/30 text-gray-400";
    }
  };

  const formatValue = (value: any): string => {
    if (value === null || value === undefined) return "null";
    if (typeof value === "object") return JSON.stringify(value);
    if (typeof value === "boolean") return value ? "true" : "false";
    return String(value);
  };

  return (
    <div className="min-h-screen bg-[#0d1117] text-gray-200">
      <div className="border-b border-gray-800 bg-[#161b22]">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <h1 className="text-2xl font-semibold text-gray-200">
            Feature Flags & Environment Inventory
          </h1>
          <p className="text-sm text-gray-400 mt-1">
            E7.0.4: Zentraler Katalog und effektive Konfiguration
          </p>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-8">
        {isLoading && (
          <div className="text-center py-12">
            <p className="text-gray-400">Lädt Konfiguration...</p>
          </div>
        )}

        {error && (
          <div className="bg-red-900/20 border border-red-800 rounded-lg p-4 mb-6">
            <p className="text-red-300">{error}</p>
          </div>
        )}

        {!isLoading && data && (
          <>
            {/* Summary Section */}
            <div className="mb-6 grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="bg-gray-900/50 border border-gray-800 rounded-lg p-4">
                <div className="text-sm text-gray-400 mb-1">Total Flags</div>
                <div className="text-2xl font-semibold text-gray-200">
                  {data.effective.summary.total}
                </div>
              </div>
              <div className="bg-green-900/20 border border-green-800 rounded-lg p-4">
                <div className="text-sm text-green-400 mb-1">Set</div>
                <div className="text-2xl font-semibold text-green-300">
                  {data.effective.summary.set}
                </div>
              </div>
              <div className="bg-yellow-900/20 border border-yellow-800 rounded-lg p-4">
                <div className="text-sm text-yellow-400 mb-1">
                  Missing (Total)
                </div>
                <div className="text-2xl font-semibold text-yellow-300">
                  {data.effective.summary.missing}
                </div>
              </div>
              <div className="bg-red-900/20 border border-red-800 rounded-lg p-4">
                <div className="text-sm text-red-400 mb-1">
                  Missing Required
                </div>
                <div className="text-2xl font-semibold text-red-300">
                  {data.effective.summary.missingRequired}
                </div>
              </div>
            </div>

            {/* Missing Required Flags Warning */}
            {data.effective.missingRequired.length > 0 && (
              <div className="mb-6 bg-red-900/20 border border-red-800 rounded-lg p-4">
                <div className="flex items-start gap-3">
                  <svg
                    className="w-5 h-5 text-red-400 mt-0.5 flex-shrink-0"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                    />
                  </svg>
                  <div className="flex-1">
                    <h3 className="text-sm font-medium text-red-300 mb-2">
                      Fehlende erforderliche Flags
                    </h3>
                    <div className="space-y-1">
                      {data.effective.missingRequired.map((v) => (
                        <div key={v.key} className="text-sm text-red-300">
                          <code className="font-mono">{v.key}</code> -{" "}
                          {v.config.description}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Catalog Info */}
            <div className="mb-6 bg-blue-900/20 border border-blue-800 rounded-lg p-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-medium text-blue-300 mb-1">
                    Catalog Version {data.catalog.version}
                  </div>
                  <div className="text-xs text-blue-300/80">
                    Last updated: {data.catalog.lastUpdated} • Environment:{" "}
                    {data.effective.environment}
                  </div>
                </div>
                <button
                  onClick={handleExportJSON}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded text-sm font-medium transition-colors flex items-center gap-2"
                >
                  <svg
                    className="w-4 h-4"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                    />
                  </svg>
                  Export JSON
                </button>
              </div>
            </div>

            {/* Filters */}
            <div className="mb-6 bg-gray-900/50 border border-gray-800 rounded-lg p-4">
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div>
                  <label className="block text-xs text-gray-400 mb-2">
                    Risk Class
                  </label>
                  <select
                    value={filterRisk}
                    onChange={(e) => setFilterRisk(e.target.value)}
                    className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded text-gray-200 text-sm focus:outline-none focus:border-blue-500"
                  >
                    <option value="all">All</option>
                    <option value="critical">Critical</option>
                    <option value="high">High</option>
                    <option value="medium">Medium</option>
                    <option value="low">Low</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-2">
                    Source
                  </label>
                  <select
                    value={filterSource}
                    onChange={(e) => setFilterSource(e.target.value)}
                    className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded text-gray-200 text-sm focus:outline-none focus:border-blue-500"
                  >
                    <option value="all">All</option>
                    <option value="build">Build</option>
                    <option value="environment">Environment</option>
                    <option value="default">Default</option>
                    <option value="missing">Missing</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-2">
                    Tag
                  </label>
                  <select
                    value={filterTag}
                    onChange={(e) => setFilterTag(e.target.value)}
                    className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded text-gray-200 text-sm focus:outline-none focus:border-blue-500"
                  >
                    <option value="all">All Tags</option>
                    {allTags.map((tag) => (
                      <option key={tag} value={tag}>
                        {tag}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-2">
                    Show
                  </label>
                  <button
                    onClick={() => setShowOnlyMissing(!showOnlyMissing)}
                    className={`w-full px-3 py-2 rounded text-sm font-medium transition-colors ${
                      showOnlyMissing
                        ? "bg-yellow-600 text-white"
                        : "bg-gray-800 border border-gray-700 text-gray-200"
                    }`}
                  >
                    {showOnlyMissing ? "Showing Missing" : "Show All"}
                  </button>
                </div>
              </div>
            </div>

            {/* Values Table */}
            <div className="bg-gray-900/50 border border-gray-800 rounded-lg overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-800/50">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                        Key
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                        Value
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                        Source
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                        Risk
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                        Tags
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-800">
                    {filteredValues.map((value) => (
                      <tr
                        key={value.key}
                        className="hover:bg-gray-900/70 transition-colors"
                      >
                        <td className="px-4 py-3">
                          <div className="font-mono text-sm text-gray-200">
                            {value.key}
                          </div>
                          <div className="text-xs text-gray-400 mt-1">
                            {value.config.description}
                          </div>
                          {value.config.required && (
                            <span className="inline-block mt-1 text-xs px-2 py-0.5 rounded bg-orange-900/30 text-orange-400">
                              Required
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <div
                            className={`font-mono text-sm ${
                              value.isMissing
                                ? "text-red-400"
                                : "text-gray-200"
                            }`}
                          >
                            {formatValue(value.value)}
                          </div>
                          <div className="text-xs text-gray-500 mt-1">
                            Type: {value.expectedType}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`text-xs px-2 py-1 rounded ${getSourceBadgeClass(
                              value.source
                            )}`}
                          >
                            {value.source}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`text-xs px-2 py-1 rounded border ${getRiskBadgeClass(
                              value.config.riskClass
                            )}`}
                          >
                            {value.config.riskClass}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap gap-1">
                            {value.config.tags.map((tag) => (
                              <span
                                key={tag}
                                className="text-xs px-2 py-0.5 rounded bg-gray-800 text-gray-400"
                              >
                                {tag}
                              </span>
                            ))}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {filteredValues.length === 0 && (
                <div className="text-center py-12 text-gray-400">
                  Keine Einträge gefunden mit den aktuellen Filtern
                </div>
              )}
            </div>

            {/* Source Distribution */}
            <div className="mt-6 grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="bg-blue-900/20 border border-blue-800 rounded-lg p-4">
                <div className="text-sm text-blue-400 mb-1">From Build</div>
                <div className="text-xl font-semibold text-blue-300">
                  {data.effective.summary.fromBuild}
                </div>
              </div>
              <div className="bg-purple-900/20 border border-purple-800 rounded-lg p-4">
                <div className="text-sm text-purple-400 mb-1">
                  From Environment
                </div>
                <div className="text-xl font-semibold text-purple-300">
                  {data.effective.summary.fromEnv}
                </div>
              </div>
              <div className="bg-gray-900/50 border border-gray-800 rounded-lg p-4">
                <div className="text-sm text-gray-400 mb-1">From Default</div>
                <div className="text-xl font-semibold text-gray-300">
                  {data.effective.summary.fromDefault}
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
