"use client";

import { useEffect, useState, useCallback } from "react";
import { safeFetch, formatErrorMessage } from "@/lib/api/safe-fetch";
import { API_ROUTES } from "@/lib/api-routes";

interface DbInfo {
  reachable: boolean;
  host: string;
  port: number;
  database: string;
}

interface RepoInfo {
  migrationCount: number;
  latest: string | null;
}

interface LedgerInfo {
  table: string;
  appliedCount: number;
  lastApplied: string | null;
  lastAppliedAt: string | null;
}

interface HashMismatch {
  filename: string;
  repoHash: string;
  dbHash: string;
}

interface ParityInfo {
  status: "PASS" | "FAIL";
  missingInDb: string[];
  extraInDb: string[];
  hashMismatches: HashMismatch[];
}

interface MigrationParityData {
  version: string;
  generatedAt: string;
  lawbookVersion: string;
  db: DbInfo;
  repo: RepoInfo;
  ledger: LedgerInfo;
  parity: ParityInfo;
}

interface WhoamiData {
  sub: string;
  isAdmin: boolean;
}

interface ErrorInfo {
  code?: string;
  details?: string;
}

export default function MigrationsOpsPage() {
  const [data, setData] = useState<MigrationParityData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [errorInfo, setErrorInfo] = useState<ErrorInfo | null>(null);
  const [limit, setLimit] = useState<number>(200);
  const [is403Error, setIs403Error] = useState(false);
  const [is409ProdDisabled, setIs409ProdDisabled] = useState(false);
  const [whoamiData, setWhoamiData] = useState<WhoamiData | null>(null);
  const [whoami401, setWhoami401] = useState(false);

  const fetchMigrationParity = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    setErrorInfo(null);
    setIs403Error(false);
    setIs409ProdDisabled(false);
    setWhoamiData(null);
    setWhoami401(false);

    try {
      const params = new URLSearchParams();
      params.append("limit", limit.toString());

      const url = `${API_ROUTES.ops.migrations}?${params.toString()}`;

      const response = await fetch(url, {
        credentials: "include",
        cache: "no-store",
      });

      // Check for env-disabled (409)
      if (response.status === 409) {
        const errorData = await response.json();
        setIs409ProdDisabled(true);
        setErrorInfo(errorData);
        throw new Error(errorData.details || 'Migration parity checks are disabled in this environment');
      }

      // Check for 403 before processing response
      if (response.status === 403) {
        setIs403Error(true);
        
        // Fetch whoami to get diagnostic info
        try {
          const whoamiResponse = await fetch(API_ROUTES.ops.whoami, {
            credentials: "include",
            cache: "no-store",
          });
          
          if (whoamiResponse.status === 401) {
            setWhoami401(true);
          } else if (whoamiResponse.ok) {
            const whoami = await whoamiResponse.json();
            setWhoamiData(whoami);
          }
        } catch (whoamiErr) {
          console.error("Error fetching whoami:", whoamiErr);
        }
      }

      const result = await safeFetch(response);
      setData(result);
    } catch (err) {
      console.error("Error fetching migration parity:", err);
      setError(formatErrorMessage(err));
    } finally {
      setIsLoading(false);
    }
  }, [limit]);

  useEffect(() => {
    fetchMigrationParity();
  }, [fetchMigrationParity]);

  const formatDate = (dateString: string | null) => {
    if (!dateString) return "-";
    const date = new Date(dateString);
    if (Number.isNaN(date.getTime())) return "-";
    return date.toLocaleString("de-DE", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  };

  const getStatusBadge = (status: "PASS" | "FAIL") => {
    if (status === "PASS") {
      return (
        <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-green-100 text-green-800">
          ✓ PASS
        </span>
      );
    }
    return (
      <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-red-100 text-red-800">
        ✗ FAIL
      </span>
    );
  };

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-3xl font-bold text-gray-900">Migration Parity Check</h1>
          <p className="mt-2 text-sm text-gray-600">
            Deterministic comparison of database migrations vs. repository files
          </p>
        </div>

        {/* Controls */}
        <div className="bg-white shadow rounded-lg p-4 mb-6">
          <div className="flex items-center gap-4">
            <div>
              <label htmlFor="limit" className="block text-sm font-medium text-gray-700 mb-1">
                Result Limit
              </label>
              <select
                id="limit"
                value={limit}
                onChange={(e) => setLimit(parseInt(e.target.value, 10))}
                className="block w-32 rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
              >
                <option value={50}>50</option>
                <option value={100}>100</option>
                <option value={200}>200</option>
                <option value={500}>500</option>
              </select>
            </div>
            <div className="flex-1"></div>
            <button
              onClick={fetchMigrationParity}
              disabled={isLoading}
              className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isLoading ? "Loading..." : "Refresh"}
            </button>
          </div>
        </div>

        {/* Error State */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6">
            <h3 className="text-sm font-medium text-red-800">Error</h3>
            <p className="mt-1 text-sm text-red-700">{error}</p>
            
            {/* Environment Disabled Message */}
            {is409ProdDisabled && (
              <div className="mt-4 pt-4 border-t border-red-300">
                <h4 className="text-sm font-semibold text-red-900 mb-2">
                  🚫 Environment Access Disabled
                </h4>
                <div className="bg-white rounded p-3 space-y-2">
                  <p className="text-xs text-red-800">
                    <strong>Migration parity checks are disabled in this environment.</strong>
                  </p>
                  <p className="text-xs text-gray-700 mt-2">
                    This is a stage-only tool. It is disabled in production and unconfigured environments
                    to reduce operational costs and risks.
                  </p>
                  {errorInfo?.code && (
                    <div className="mt-2 pt-2 border-t border-gray-200">
                      <span className="text-xs font-medium text-gray-600">Error Code:</span>
                      <code className="ml-2 text-xs bg-gray-100 px-2 py-1 rounded text-gray-900 font-mono">
                        {errorInfo.code}
                      </code>
                    </div>
                  )}
                </div>
              </div>
            )}
            
            {/* 403 Diagnostic Information */}
            {is403Error && whoami401 && (
              <div className="mt-4 pt-4 border-t border-red-300">
                <h4 className="text-sm font-semibold text-red-900 mb-2">
                  🔍 Diagnostic Information
                </h4>
                <div className="bg-white rounded p-3 space-y-2">
                  <p className="text-xs text-red-800">
                    <strong>Not authenticated.</strong> You need to be logged in to access this page.
                  </p>
                  <p className="text-xs text-gray-600 mt-2">
                    Please sign in and try again.
                  </p>
                </div>
              </div>
            )}
            
            {is403Error && whoamiData && (
              <div className="mt-4 pt-4 border-t border-red-300">
                <h4 className="text-sm font-semibold text-red-900 mb-2">
                  🔍 Diagnostic Information
                </h4>
                <div className="bg-white rounded p-3 space-y-2">
                  <div>
                    <span className="text-xs font-medium text-gray-700">Environment:</span>
                    <span className="ml-2 text-xs px-2 py-1 rounded font-medium bg-blue-100 text-blue-800">
                      Staging (Production would return 409)
                    </span>
                  </div>
                  <div>
                    <span className="text-xs font-medium text-gray-700">Your sub:</span>
                    <code className="ml-2 text-xs bg-gray-100 px-2 py-1 rounded text-gray-900 font-mono">
                      {whoamiData.sub}
                    </code>
                  </div>
                  <div>
                    <span className="text-xs font-medium text-gray-700">Admin status:</span>
                    <span className={`ml-2 text-xs px-2 py-1 rounded font-medium ${
                      whoamiData.isAdmin 
                        ? 'bg-green-100 text-green-800' 
                        : 'bg-red-100 text-red-800'
                    }`}>
                      {whoamiData.isAdmin ? '✓ Admin' : '✗ Not Admin'}
                    </span>
                  </div>
                  {!whoamiData.isAdmin && (
                    <div className="mt-3 pt-3 border-t border-gray-200">
                      <p className="text-xs text-gray-800">
                        <strong>To fix:</strong> Set the <code className="bg-gray-100 px-1 rounded">AFU9_ADMIN_SUBS</code> environment variable to include this sub:
                      </p>
                      <code className="block mt-2 text-xs bg-gray-800 text-green-400 px-3 py-2 rounded font-mono">
                        AFU9_ADMIN_SUBS={whoamiData.sub}
                      </code>
                      <p className="text-xs text-gray-600 mt-2">
                        For multiple admins, use comma-separated values.
                      </p>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Loading State */}
        {isLoading && !data && (
          <div className="bg-white shadow rounded-lg p-8 text-center">
            <p className="text-gray-600">Loading migration parity data...</p>
          </div>
        )}

        {/* Data Display */}
        {data && !isLoading && (
          <>
            {/* Overview Card */}
            <div className="bg-white shadow rounded-lg p-6 mb-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-semibold text-gray-900">Parity Status</h2>
                {getStatusBadge(data.parity.status)}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <p className="text-sm text-gray-600">Database</p>
                  <p className="text-lg font-medium text-gray-900">
                    {data.db.reachable ? "✓ Reachable" : "✗ Unreachable"}
                  </p>
                  <p className="text-xs text-gray-500">
                    {data.db.host}:{data.db.port}/{data.db.database}
                  </p>
                </div>

                <div>
                  <p className="text-sm text-gray-600">Repository Migrations</p>
                  <p className="text-lg font-medium text-gray-900">{data.repo.migrationCount}</p>
                  <p className="text-xs text-gray-500">Latest: {data.repo.latest || "-"}</p>
                </div>

                <div>
                  <p className="text-sm text-gray-600">Applied Migrations</p>
                  <p className="text-lg font-medium text-gray-900">{data.ledger.appliedCount}</p>
                  <p className="text-xs text-gray-500">
                    Last: {data.ledger.lastApplied || "-"}
                  </p>
                </div>
              </div>

              <div className="mt-4 pt-4 border-t border-gray-200">
                <p className="text-xs text-gray-500">
                  Generated: {formatDate(data.generatedAt)} | Lawbook: {data.lawbookVersion}
                </p>
              </div>
            </div>

            {/* Discrepancies */}
            {data.parity.status === "FAIL" && (
              <div className="space-y-6">
                {/* Missing in DB */}
                {data.parity.missingInDb.length > 0 && (
                  <div className="bg-white shadow rounded-lg p-6">
                    <h3 className="text-lg font-semibold text-gray-900 mb-4">
                      Missing in Database ({data.parity.missingInDb.length})
                    </h3>
                    <div className="bg-yellow-50 border border-yellow-200 rounded p-3">
                      <p className="text-sm text-yellow-800 mb-2">
                        These migrations exist in the repository but have not been applied to the database:
                      </p>
                      <ul className="list-disc list-inside space-y-1">
                        {data.parity.missingInDb.map((filename) => (
                          <li key={filename} className="text-sm text-gray-700 font-mono">
                            {filename}
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                )}

                {/* Extra in DB */}
                {data.parity.extraInDb.length > 0 && (
                  <div className="bg-white shadow rounded-lg p-6">
                    <h3 className="text-lg font-semibold text-gray-900 mb-4">
                      Extra in Database ({data.parity.extraInDb.length})
                    </h3>
                    <div className="bg-orange-50 border border-orange-200 rounded p-3">
                      <p className="text-sm text-orange-800 mb-2">
                        These migrations are in the database but missing from the repository:
                      </p>
                      <ul className="list-disc list-inside space-y-1">
                        {data.parity.extraInDb.map((filename) => (
                          <li key={filename} className="text-sm text-gray-700 font-mono">
                            {filename}
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                )}

                {/* Hash Mismatches */}
                {data.parity.hashMismatches.length > 0 && (
                  <div className="bg-white shadow rounded-lg p-6">
                    <h3 className="text-lg font-semibold text-gray-900 mb-4">
                      Hash Mismatches ({data.parity.hashMismatches.length})
                    </h3>
                    <div className="bg-red-50 border border-red-200 rounded p-3">
                      <p className="text-sm text-red-800 mb-2">
                        These migrations have different content in the repository vs. database:
                      </p>
                      <div className="space-y-3">
                        {data.parity.hashMismatches.map((mismatch) => (
                          <div key={mismatch.filename} className="border-l-4 border-red-400 pl-3">
                            <p className="text-sm font-mono font-semibold text-gray-900">
                              {mismatch.filename}
                            </p>
                            <p className="text-xs text-gray-600">
                              Repo: <code className="bg-white px-1 rounded">{mismatch.repoHash.substring(0, 12)}...</code>
                            </p>
                            <p className="text-xs text-gray-600">
                              DB: <code className="bg-white px-1 rounded">{mismatch.dbHash.substring(0, 12)}...</code>
                            </p>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Success State */}
            {data.parity.status === "PASS" && (
              <div className="bg-white shadow rounded-lg p-6">
                <div className="text-center py-8">
                  <div className="text-6xl mb-4">✓</div>
                  <h3 className="text-xl font-semibold text-gray-900 mb-2">
                    All Migrations in Sync
                  </h3>
                  <p className="text-gray-600">
                    Repository and database migrations are perfectly aligned. No discrepancies detected.
                  </p>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
