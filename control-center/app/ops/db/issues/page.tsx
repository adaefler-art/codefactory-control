/**
 * Package 2: Frontend UI - Ops DB Issues Page
 * /ops/db/issues
 * 
 * Purpose: Admin UI for bulk setting issues to DONE status
 * Features: Preview, Execute with CONFIRM, bounded output
 */

'use client';

import { useState } from 'react';
import { API_ROUTES } from '@/lib/api-routes';

interface PreviewResponse {
  ok: boolean;
  requestId: string;
  environment: string;
  params: {
    statuses: string[];
    githubIssueMin?: number;
    githubIssueMax?: number;
    limit: number;
  };
  statusDistribution: Array<{ status: string; count: number }>;
  affectedCount: number;
  sampleRows: Array<{
    id: string;
    githubIssueNumber: number;
    title: string;
    status: string;
  }>;
}

interface ExecuteResponse {
  ok: boolean;
  requestId: string;
  environment: string;
  params: {
    statuses: string[];
    githubIssueMin?: number;
    githubIssueMax?: number;
  };
  result: {
    updatedCount: number;
    sampleRows: Array<{
      id: string;
      githubIssueNumber: number;
      title: string;
      status: string;
    }>;
    returnedSampleCount: number;
    maxReturningRows: number;
    truncated: boolean;
  };
}

export default function OpsDbIssuesPage() {
  const [statuses, setStatuses] = useState<string[]>(['CREATED', 'SPEC_READY']);
  const [githubIssueMin, setGithubIssueMin] = useState<string>('');
  const [githubIssueMax, setGithubIssueMax] = useState<string>('');
  const [confirmInput, setConfirmInput] = useState<string>('');
  
  const [previewData, setPreviewData] = useState<PreviewResponse | null>(null);
  const [executeData, setExecuteData] = useState<ExecuteResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const handlePreview = async () => {
    setLoading(true);
    setError(null);
    setPreviewData(null);

    try {
      const params = new URLSearchParams({
        statuses: statuses.join(','),
      });
      if (githubIssueMin) params.set('githubIssueMin', githubIssueMin);
      if (githubIssueMax) params.set('githubIssueMax', githubIssueMax);

      const response = await fetch(`${API_ROUTES.ops.db.issues.previewSetDone}?${params.toString()}`);
      const data = await response.json();

      if (!response.ok) {
        setError(`${data.error}: ${data.details} (${data.code})`);
        return;
      }

      setPreviewData(data);
    } catch (err: any) {
      setError(err.message || 'Failed to fetch preview');
    } finally {
      setLoading(false);
    }
  };

  const handleExecute = async () => {
    if (confirmInput !== 'CONFIRM') {
      setError('You must type "CONFIRM" to execute');
      return;
    }

    setLoading(true);
    setError(null);
    setExecuteData(null);

    try {
      const body: any = {
        confirm: 'CONFIRM',
        statuses,
      };
      if (githubIssueMin) body.githubIssueMin = parseInt(githubIssueMin);
      if (githubIssueMax) body.githubIssueMax = parseInt(githubIssueMax);

      const response = await fetch(API_ROUTES.ops.db.issues.setDone, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await response.json();

      if (!response.ok) {
        setError(`${data.error}: ${data.details} (${data.code})`);
        return;
      }

      setExecuteData(data);
      setConfirmInput(''); // Reset confirmation input
      setPreviewData(null); // Clear preview after execute
    } catch (err: any) {
      setError(err.message || 'Failed to execute');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-white border-b border-gray-200 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <h1 className="text-2xl font-bold text-gray-900">Ops: Bulk Set Issues to DONE</h1>
          <p className="mt-1 text-sm text-gray-500">
            Admin-only operation (stage/development only)
          </p>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {/* Filters */}
        <div className="bg-white rounded-lg shadow p-6 mb-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Filters</h2>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Statuses */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Target Statuses
              </label>
              <div className="space-y-2">
                <label className="flex items-center">
                  <input
                    type="checkbox"
                    checked={statuses.includes('CREATED')}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setStatuses([...statuses, 'CREATED']);
                      } else {
                        setStatuses(statuses.filter(s => s !== 'CREATED'));
                      }
                    }}
                    className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                  <span className="ml-2 text-sm text-gray-700">CREATED</span>
                </label>
                <label className="flex items-center">
                  <input
                    type="checkbox"
                    checked={statuses.includes('SPEC_READY')}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setStatuses([...statuses, 'SPEC_READY']);
                      } else {
                        setStatuses(statuses.filter(s => s !== 'SPEC_READY'));
                      }
                    }}
                    className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                  <span className="ml-2 text-sm text-gray-700">SPEC_READY</span>
                </label>
              </div>
            </div>

            {/* Range */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                GitHub Issue Number Range (optional)
              </label>
              <div className="flex items-center space-x-2">
                <input
                  type="number"
                  placeholder="Min"
                  value={githubIssueMin}
                  onChange={(e) => setGithubIssueMin(e.target.value)}
                  className="flex-1 rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                />
                <span className="text-gray-500">to</span>
                <input
                  type="number"
                  placeholder="Max"
                  value={githubIssueMax}
                  onChange={(e) => setGithubIssueMax(e.target.value)}
                  className="flex-1 rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                />
              </div>
            </div>
          </div>

          {/* Preview Button */}
          <div className="mt-6">
            <button
              onClick={handlePreview}
              disabled={loading || statuses.length === 0}
              className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? 'Loading...' : 'Preview'}
            </button>
          </div>
        </div>

        {/* Error Display */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6">
            <p className="text-sm text-red-800">
              <span className="font-semibold">Error:</span> {error}
            </p>
          </div>
        )}

        {/* Preview Results */}
        {previewData && (
          <div className="bg-white rounded-lg shadow p-6 mb-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Preview Results</h2>
            
            <div className="mb-4 text-sm text-gray-600">
              <p><span className="font-medium">Request ID:</span> {previewData.requestId}</p>
              <p><span className="font-medium">Environment:</span> {previewData.environment}</p>
              <p><span className="font-medium">Affected Count:</span> {previewData.affectedCount}</p>
            </div>

            {/* Status Distribution */}
            <div className="mb-6">
              <h3 className="text-sm font-medium text-gray-700 mb-2">Current Status Distribution</h3>
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Count</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {previewData.statusDistribution.map((row) => (
                    <tr key={row.status}>
                      <td className="px-4 py-2 text-sm text-gray-900">{row.status}</td>
                      <td className="px-4 py-2 text-sm text-gray-900">{row.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Sample Rows */}
            {previewData.sampleRows.length > 0 && (
              <div className="mb-6">
                <h3 className="text-sm font-medium text-gray-700 mb-2">
                  Sample Issues to Update (first {previewData.params.limit})
                </h3>
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Issue #</th>
                        <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Title</th>
                        <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                      {previewData.sampleRows.map((row) => (
                        <tr key={row.id}>
                          <td className="px-4 py-2 text-sm text-gray-900">{row.githubIssueNumber}</td>
                          <td className="px-4 py-2 text-sm text-gray-900 max-w-md truncate">{row.title}</td>
                          <td className="px-4 py-2 text-sm">
                            <span className="px-2 py-1 text-xs rounded-full bg-yellow-100 text-yellow-800">
                              {row.status}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Execute Section */}
            <div className="border-t border-gray-200 pt-6">
              <h3 className="text-sm font-medium text-gray-700 mb-4">Execute Update</h3>
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Type "CONFIRM" to execute
                </label>
                <input
                  type="text"
                  value={confirmInput}
                  onChange={(e) => setConfirmInput(e.target.value)}
                  placeholder="CONFIRM"
                  className="max-w-xs rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                />
              </div>
              <button
                onClick={handleExecute}
                disabled={loading || confirmInput !== 'CONFIRM'}
                className="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? 'Executing...' : 'Execute (Set to DONE)'}
              </button>
            </div>
          </div>
        )}

        {/* Execute Results */}
        {executeData && (
          <div className="bg-green-50 border border-green-200 rounded-lg p-6">
            <h2 className="text-lg font-semibold text-green-900 mb-4">✅ Execute Complete</h2>
            
            <div className="mb-4 text-sm text-green-800">
              <p><span className="font-medium">Request ID:</span> {executeData.requestId}</p>
              <p><span className="font-medium">Environment:</span> {executeData.environment}</p>
              <p><span className="font-medium">Updated Count:</span> {executeData.result.updatedCount}</p>
              {executeData.result.truncated && (
                <p className="text-yellow-700">
                  ⚠️ Sample truncated (showing {executeData.result.returnedSampleCount} of {executeData.result.updatedCount})
                </p>
              )}
            </div>

            {/* Updated Rows Sample */}
            {executeData.result.sampleRows.length > 0 && (
              <div>
                <h3 className="text-sm font-medium text-green-800 mb-2">Updated Issues (sample)</h3>
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-green-200">
                    <thead className="bg-green-100">
                      <tr>
                        <th className="px-4 py-2 text-left text-xs font-medium text-green-700 uppercase">Issue #</th>
                        <th className="px-4 py-2 text-left text-xs font-medium text-green-700 uppercase">Title</th>
                        <th className="px-4 py-2 text-left text-xs font-medium text-green-700 uppercase">Status</th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-green-200">
                      {executeData.result.sampleRows.map((row) => (
                        <tr key={row.id}>
                          <td className="px-4 py-2 text-sm text-gray-900">{row.githubIssueNumber}</td>
                          <td className="px-4 py-2 text-sm text-gray-900 max-w-md truncate">{row.title}</td>
                          <td className="px-4 py-2 text-sm">
                            <span className="px-2 py-1 text-xs rounded-full bg-green-100 text-green-800">
                              {row.status}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
