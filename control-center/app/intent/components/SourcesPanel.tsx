/**
 * SourcesPanel Component
 * 
 * Displays used_sources for INTENT assistant messages.
 * Issue E73.2: Sources Panel + used_sources Contract
 * 
 * Features:
 * - Collapsible panel
 * - Compact display of source references
 * - No full content leaks; only refs/hashes
 */

"use client";

import { useState } from "react";
import type { SourceRef, UsedSources } from "@/lib/schemas/usedSources";

interface SourcesPanelProps {
  sources: UsedSources | null | undefined;
}

/**
 * Render a single source reference compactly
 */
function SourceItem({ source }: { source: SourceRef }) {
  switch (source.kind) {
    case "file_snippet":
      return (
        <div className="border border-gray-200 rounded-lg p-3 bg-white hover:bg-gray-50 transition-colors">
          <div className="flex items-start gap-2">
            <div className="flex-shrink-0 w-6 h-6 rounded bg-blue-100 flex items-center justify-center">
              <svg className="w-4 h-4 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-xs font-medium text-gray-500 uppercase tracking-wide">File Snippet</div>
              <div className="text-sm font-mono text-gray-900 truncate mt-1">
                {source.repo.owner}/{source.repo.repo}
              </div>
              <div className="text-sm text-gray-700 truncate">
                {source.path}
              </div>
              <div className="text-xs text-gray-500 mt-1">
                Lines {source.startLine}-{source.endLine} • {source.branch}
              </div>
              <div className="text-xs font-mono text-gray-400 mt-1">
                Hash: {source.snippetHash}
              </div>
            </div>
          </div>
        </div>
      );

    case "github_issue":
      return (
        <div className="border border-gray-200 rounded-lg p-3 bg-white hover:bg-gray-50 transition-colors">
          <div className="flex items-start gap-2">
            <div className="flex-shrink-0 w-6 h-6 rounded bg-green-100 flex items-center justify-center">
              <svg className="w-4 h-4 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-xs font-medium text-gray-500 uppercase tracking-wide">GitHub Issue</div>
              <div className="text-sm font-mono text-gray-900 truncate mt-1">
                {source.repo.owner}/{source.repo.repo}#{source.number}
              </div>
              {source.title && (
                <div className="text-sm text-gray-700 truncate">
                  {source.title}
                </div>
              )}
              {source.url && (
                <a 
                  href={source.url} 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="text-xs text-blue-600 hover:text-blue-800 hover:underline mt-1 inline-block"
                >
                  View Issue →
                </a>
              )}
            </div>
          </div>
        </div>
      );

    case "github_pr":
      return (
        <div className="border border-gray-200 rounded-lg p-3 bg-white hover:bg-gray-50 transition-colors">
          <div className="flex items-start gap-2">
            <div className="flex-shrink-0 w-6 h-6 rounded bg-purple-100 flex items-center justify-center">
              <svg className="w-4 h-4 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-xs font-medium text-gray-500 uppercase tracking-wide">GitHub PR</div>
              <div className="text-sm font-mono text-gray-900 truncate mt-1">
                {source.repo.owner}/{source.repo.repo}#{source.number}
              </div>
              {source.title && (
                <div className="text-sm text-gray-700 truncate">
                  {source.title}
                </div>
              )}
              {source.url && (
                <a 
                  href={source.url} 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="text-xs text-blue-600 hover:text-blue-800 hover:underline mt-1 inline-block"
                >
                  View PR →
                </a>
              )}
            </div>
          </div>
        </div>
      );

    case "afu9_artifact":
      return (
        <div className="border border-gray-200 rounded-lg p-3 bg-white hover:bg-gray-50 transition-colors">
          <div className="flex items-start gap-2">
            <div className="flex-shrink-0 w-6 h-6 rounded bg-orange-100 flex items-center justify-center">
              <svg className="w-4 h-4 text-orange-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-xs font-medium text-gray-500 uppercase tracking-wide">AFU-9 Artifact</div>
              <div className="text-sm text-gray-900 truncate mt-1">
                {source.artifactType}: {source.artifactId}
              </div>
              {source.sha256 && (
                <div className="text-xs font-mono text-gray-400 mt-1">
                  SHA256: {source.sha256.substring(0, 16)}...
                </div>
              )}
              {source.ref && (
                <div className="text-xs text-gray-500 mt-1">
                  {Object.keys(source.ref).length} metadata field(s)
                </div>
              )}
            </div>
          </div>
        </div>
      );
  }
}

/**
 * SourcesPanel: Collapsible panel displaying source references
 */
export function SourcesPanel({ sources }: SourcesPanelProps) {
  const [isExpanded, setIsExpanded] = useState(true);

  if (!sources || sources.length === 0) {
    return null;
  }

  return (
    <div className="w-80 border-l border-gray-200 bg-gray-50 flex flex-col">
      {/* Header */}
      <div className="border-b border-gray-200 bg-white px-4 py-3">
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="flex items-center justify-between w-full text-left hover:bg-gray-50 rounded px-2 py-1 -mx-2 -my-1 transition-colors"
        >
          <div className="flex items-center gap-2">
            <svg 
              className={`w-4 h-4 text-gray-500 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
              fill="none" 
              stroke="currentColor" 
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
            <span className="font-semibold text-gray-900">Sources</span>
          </div>
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
            {sources.length}
          </span>
        </button>
      </div>

      {/* Content */}
      {isExpanded && (
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {sources.map((source, index) => (
            <SourceItem key={index} source={source} />
          ))}
        </div>
      )}

      {/* Footer */}
      {isExpanded && (
        <div className="border-t border-gray-200 bg-white px-4 py-2">
          <p className="text-xs text-gray-500">
            Evidence for this assistant response
          </p>
        </div>
      )}
    </div>
  );
}

/**
 * SourcesBadge: Small indicator showing source count on messages
 */
export function SourcesBadge({ count }: { count: number }) {
  if (count === 0) return null;

  return (
    <div className="inline-flex items-center gap-1 px-2 py-1 bg-blue-50 border border-blue-200 rounded text-xs text-blue-700">
      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
      <span>{count} source{count !== 1 ? 's' : ''}</span>
    </div>
  );
}
