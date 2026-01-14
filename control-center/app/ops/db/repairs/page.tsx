/**
 * E86.5: DB Repair Mechanism UI
 * /ops/db/repairs
 * 
 * Purpose: Admin UI for staging-only DB repair operations
 * Features: List repairs, Preview (no DB writes), Execute with hash verification
 * 
 * SECURITY:
 * - Stage-only (backend enforces via guards)
 * - Admin-only (backend enforces via AFU9_ADMIN_SUBS)
 * - Hash verification required for execution
 * - Full audit trail in db_repair_runs
 */

'use client';

import { useState, useEffect } from 'react';

interface RepairPlaybook {
  repairId: string;
  description: string;
  hash: string;
  version: string;
  stageOnly: boolean;
  requiresAdmin: boolean;
  requiredTablesAfter: string[];
}

interface RepairListResponse {
  version: string;
  generatedAt: string;
  requestId: string;
  repairs: RepairPlaybook[];
}

interface PreviewResponse {
  version: string;
  generatedAt: string;
  requestId: string;
  repairId: string;
  description: string;
  hash: string;
  requiredTablesCheck: {
    required: string[];
    missing: string[];
    allPresent: boolean;
  };
  wouldApply: boolean;
  plan: string[];
  deploymentEnv: string;
  lawbookHash: string | null;
}

interface ExecuteResponse {
  version: string;
  generatedAt: string;
  requestId: string;
  repairId: string;
  repairRunId: string;
  status: 'SUCCESS' | 'FAILED';
  summary: {
    preMissingTables: string[];
    postMissingTables: string[];
    statementsExecuted: number;
    errorCode?: string;
    errorMessage?: string;
  };
}

export default function OpsDbRepairsPage() {
  const [repairs, setRepairs] = useState<RepairPlaybook[]>([]);
  const [selectedRepair, setSelectedRepair] = useState<RepairPlaybook | null>(null);
  const [previewData, setPreviewData] = useState<PreviewResponse | null>(null);
  const [executeData, setExecuteData] = useState<ExecuteResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Load repairs on mount
  useEffect(() => {
    loadRepairs();
  }, []);

  const loadRepairs = async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/ops/db/repairs');
      const data: RepairListResponse = await response.json();

      if (!response.ok) {
        setError(`Failed to load repairs: ${(data as any).error || 'Unknown error'}`);
        return;
      }

      setRepairs(data.repairs);
    } catch (err: any) {
      setError(err.message || 'Failed to load repairs');
    } finally {
      setLoading(false);
    }
  };

  const handlePreview = async (repair: RepairPlaybook) => {
    setLoading(true);
    setError(null);
    setPreviewData(null);
    setExecuteData(null);
    setSelectedRepair(repair);

    try {
      const response = await fetch('/api/ops/db/repairs/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repairId: repair.repairId }),
      });

      const data: PreviewResponse = await response.json();

      if (!response.ok) {
        setError(`Preview failed: ${(data as any).error || 'Unknown error'}`);
        return;
      }

      setPreviewData(data);
    } catch (err: any) {
      setError(err.message || 'Failed to preview repair');
    } finally {
      setLoading(false);
    }
  };

  const handleExecute = async () => {
    if (!previewData || !selectedRepair) {
      setError('Must preview repair before executing');
      return;
    }

    const confirmed = window.confirm(
      `Execute repair "${selectedRepair.repairId}"?\n\n` +
      `This will modify the database.\n\n` +
      `Hash: ${previewData.hash.substring(0, 16)}...\n\n` +
      `Click OK to proceed.`
    );

    if (!confirmed) return;

    setLoading(true);
    setError(null);
    setExecuteData(null);

    try {
      const response = await fetch('/api/ops/db/repairs/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          repairId: selectedRepair.repairId,
          expectedHash: previewData.hash,
        }),
      });

      const data: ExecuteResponse = await response.json();

      if (!response.ok) {
        setError(`Execute failed: ${(data as any).error || 'Unknown error'}`);
        return;
      }

      setExecuteData(data);
      setPreviewData(null);
    } catch (err: any) {
      setError(err.message || 'Failed to execute repair');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="container mx-auto px-4 py-8 max-w-6xl">
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">DB Repair Mechanism</h1>
        <p className="text-gray-600">
          Stage-only repair playbooks for schema drift (evidence-first, deterministic, idempotent)
        </p>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-800 px-4 py-3 rounded mb-6">
          <strong className="font-semibold">Error: </strong>
          <span>{error}</span>
        </div>
      )}

      {/* Repairs List */}
      <div className="bg-white shadow rounded-lg mb-6">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-xl font-semibold">Available Repairs</h2>
        </div>
        <div className="px-6 py-4">
          {loading && repairs.length === 0 ? (
            <p className="text-gray-500">Loading repairs...</p>
          ) : repairs.length === 0 ? (
            <p className="text-gray-500">No repairs available</p>
          ) : (
            <div className="space-y-4">
              {repairs.map((repair) => (
                <div
                  key={repair.repairId}
                  className={`border rounded-lg p-4 ${
                    selectedRepair?.repairId === repair.repairId
                      ? 'border-blue-500 bg-blue-50'
                      : 'border-gray-200'
                  }`}
                >
                  <div className="flex justify-between items-start mb-2">
                    <div>
                      <h3 className="font-mono font-semibold text-lg">{repair.repairId}</h3>
                      <p className="text-gray-600 mt-1">{repair.description}</p>
                    </div>
                    <button
                      onClick={() => handlePreview(repair)}
                      disabled={loading}
                      className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:bg-gray-400"
                    >
                      Preview
                    </button>
                  </div>
                  <div className="text-sm text-gray-500 mt-3 space-y-1">
                    <div>Hash: <code className="bg-gray-100 px-2 py-1 rounded">{repair.hash.substring(0, 16)}...</code></div>
                    <div>Version: {repair.version}</div>
                    {repair.requiredTablesAfter.length > 0 && (
                      <div>Tables: {repair.requiredTablesAfter.join(', ')}</div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Preview Results */}
      {previewData && (
        <div className="bg-white shadow rounded-lg mb-6">
          <div className="px-6 py-4 border-b border-gray-200">
            <h2 className="text-xl font-semibold">Preview: {previewData.repairId}</h2>
          </div>
          <div className="px-6 py-4 space-y-4">
            <div>
              <strong>Description:</strong> {previewData.description}
            </div>
            <div>
              <strong>Hash:</strong> <code className="bg-gray-100 px-2 py-1 rounded">{previewData.hash}</code>
            </div>
            <div>
              <strong>Environment:</strong> {previewData.deploymentEnv}
            </div>
            <div>
              <strong>Would Apply:</strong>{' '}
              <span className={previewData.wouldApply ? 'text-green-600' : 'text-red-600'}>
                {previewData.wouldApply ? 'YES' : 'NO'}
              </span>
            </div>

            {/* Required Tables Check */}
            <div className="bg-gray-50 p-4 rounded">
              <h3 className="font-semibold mb-2">Required Tables Check</h3>
              <div className="space-y-2">
                <div>
                  <strong>Required:</strong> {previewData.requiredTablesCheck.required.length > 0 ? previewData.requiredTablesCheck.required.join(', ') : 'None'}
                </div>
                {previewData.requiredTablesCheck.missing.length > 0 && (
                  <div className="text-red-600">
                    <strong>Missing:</strong> {previewData.requiredTablesCheck.missing.join(', ')}
                  </div>
                )}
                <div>
                  <strong>All Present:</strong>{' '}
                  <span className={previewData.requiredTablesCheck.allPresent ? 'text-green-600' : 'text-red-600'}>
                    {previewData.requiredTablesCheck.allPresent ? 'YES' : 'NO'}
                  </span>
                </div>
              </div>
            </div>

            {/* Plan */}
            <div className="bg-gray-50 p-4 rounded">
              <h3 className="font-semibold mb-2">Plan ({previewData.plan.length} statements)</h3>
              <div className="space-y-2 max-h-96 overflow-y-auto">
                {previewData.plan.map((stmt, idx) => (
                  <pre key={idx} className="bg-white p-2 rounded border border-gray-200 text-xs overflow-x-auto">
                    {stmt}
                  </pre>
                ))}
              </div>
            </div>

            {/* Execute Button */}
            <div className="pt-4 border-t border-gray-200">
              <button
                onClick={handleExecute}
                disabled={loading || !previewData.wouldApply}
                className="px-6 py-3 bg-green-600 text-white rounded font-semibold hover:bg-green-700 disabled:bg-gray-400"
              >
                Execute Repair
              </button>
              {!previewData.wouldApply && (
                <p className="text-sm text-gray-500 mt-2">
                  Cannot execute: Required tables check failed
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Execute Results */}
      {executeData && (
        <div className="bg-white shadow rounded-lg">
          <div className={`px-6 py-4 border-b ${executeData.status === 'SUCCESS' ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
            <h2 className="text-xl font-semibold">
              Execution Result: {executeData.status}
            </h2>
          </div>
          <div className="px-6 py-4 space-y-4">
            <div>
              <strong>Repair ID:</strong> {executeData.repairId}
            </div>
            <div>
              <strong>Run ID:</strong> <code className="bg-gray-100 px-2 py-1 rounded">{executeData.repairRunId}</code>
            </div>
            <div>
              <strong>Request ID:</strong> <code className="bg-gray-100 px-2 py-1 rounded">{executeData.requestId}</code>
            </div>
            <div>
              <strong>Statements Executed:</strong> {executeData.summary.statementsExecuted}
            </div>

            {executeData.summary.preMissingTables.length > 0 && (
              <div>
                <strong>Pre-Missing Tables:</strong> {executeData.summary.preMissingTables.join(', ')}
              </div>
            )}

            {executeData.summary.postMissingTables.length > 0 && (
              <div className="text-red-600">
                <strong>Post-Missing Tables:</strong> {executeData.summary.postMissingTables.join(', ')}
              </div>
            )}

            {executeData.summary.errorCode && (
              <div className="bg-red-50 p-4 rounded border border-red-200">
                <strong>Error Code:</strong> {executeData.summary.errorCode}
                {executeData.summary.errorMessage && (
                  <div className="mt-2">
                    <strong>Error Message:</strong> {executeData.summary.errorMessage}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
