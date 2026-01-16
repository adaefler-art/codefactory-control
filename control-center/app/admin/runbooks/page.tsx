"use client";

/**
 * Admin Runbooks Page
 * 
 * Displays operational runbooks from docs/runbooks
 * Features:
 * - Runbook list with filtering by tags
 * - Safe markdown rendering
 * - Copy-to-clipboard for code snippets
 * - Search functionality
 * 
 * Issue: I905 - Runbooks UX
 */

import { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import { API_ROUTES } from "@/lib/api-routes";

type RunbookTag = 'deploy' | 'migrations' | 'smoke' | 'gh' | 'ops' | 'intent' | 'ecs' | 'db' | 'cloudformation' | 'low-cost' | 'bulk-ops';

type RunbookMetadata = {
  id: string;
  slug: string;
  title: string;
  filePath: string;
  tags: RunbookTag[];
  lastUpdated?: string;
  purpose?: string;
  canonicalId?: string;
  author?: string;
  version?: string;
};

type RunbookManifest = {
  ok: boolean;
  runbooks: RunbookMetadata[];
  generatedAt: string;
  totalCount: number;
};

const TAG_COLORS: Record<RunbookTag, string> = {
  'deploy': 'bg-blue-100 text-blue-800',
  'migrations': 'bg-green-100 text-green-800',
  'smoke': 'bg-yellow-100 text-yellow-800',
  'gh': 'bg-purple-100 text-purple-800',
  'ops': 'bg-gray-100 text-gray-800',
  'intent': 'bg-pink-100 text-pink-800',
  'ecs': 'bg-indigo-100 text-indigo-800',
  'db': 'bg-teal-100 text-teal-800',
  'cloudformation': 'bg-orange-100 text-orange-800',
  'low-cost': 'bg-red-100 text-red-800',
  'bulk-ops': 'bg-cyan-100 text-cyan-800',
};

export default function AdminRunbooksPage() {
  const [runbooks, setRunbooks] = useState<RunbookMetadata[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedTags, setSelectedTags] = useState<Set<RunbookTag>>(new Set());

  const loadRunbooks = async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(API_ROUTES.admin.runbooks.list, {
        credentials: 'include',
        cache: 'no-store',
      });

      if (!response.ok) {
        throw new Error('Failed to load runbooks');
      }

      const data: RunbookManifest = await response.json();
      
      if (data.ok) {
        setRunbooks(data.runbooks);
      } else {
        throw new Error('Invalid response from server');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setRunbooks([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadRunbooks();
  }, []);

  // Get all unique tags from all runbooks
  const allTags = useMemo(() => {
    const tagSet = new Set<RunbookTag>();
    runbooks.forEach(rb => rb.tags.forEach(tag => tagSet.add(tag)));
    return Array.from(tagSet).sort();
  }, [runbooks]);

  // Filter runbooks by search and tags
  const filteredRunbooks = useMemo(() => {
    return runbooks.filter(runbook => {
      // Search filter
      const matchesSearch = searchQuery === "" || 
        runbook.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        runbook.purpose?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        runbook.canonicalId?.toLowerCase().includes(searchQuery.toLowerCase());
      
      // Tag filter
      const matchesTags = selectedTags.size === 0 || 
        runbook.tags.some(tag => selectedTags.has(tag));
      
      return matchesSearch && matchesTags;
    });
  }, [runbooks, searchQuery, selectedTags]);

  const toggleTag = (tag: RunbookTag) => {
    const newTags = new Set(selectedTags);
    if (newTags.has(tag)) {
      newTags.delete(tag);
    } else {
      newTags.add(tag);
    }
    setSelectedTags(newTags);
  };

  const clearFilters = () => {
    setSearchQuery("");
    setSelectedTags(new Set());
  };

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-7xl mx-auto">
        <div className="mb-6">
          <h1 className="text-3xl font-bold text-gray-900">Operational Runbooks</h1>
          <p className="mt-2 text-gray-600">
            Step-by-step procedures for common operational tasks
          </p>
        </div>

        {/* Search and Filter Section */}
        <div className="bg-white rounded-lg shadow p-6 mb-6">
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Search Runbooks
            </label>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by title, purpose, or ID..."
              className="w-full px-4 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* Tag Filter Chips */}
          {allTags.length > 0 && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Filter by Tags
              </label>
              <div className="flex flex-wrap gap-2">
                {allTags.map(tag => (
                  <button
                    key={tag}
                    onClick={() => toggleTag(tag)}
                    className={`px-3 py-1 rounded-full text-sm font-medium transition-all ${
                      selectedTags.has(tag)
                        ? TAG_COLORS[tag] + ' ring-2 ring-offset-1 ring-gray-400'
                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}
                  >
                    {tag}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Active Filters */}
          {(searchQuery || selectedTags.size > 0) && (
            <div className="mt-4 pt-4 border-t border-gray-200">
              <div className="flex items-center justify-between">
                <div className="text-sm text-gray-600">
                  {filteredRunbooks.length} of {runbooks.length} runbooks
                </div>
                <button
                  onClick={clearFilters}
                  className="text-sm text-blue-600 hover:text-blue-800"
                >
                  Clear all filters
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Error Display */}
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-800 rounded-lg p-4 mb-6">
            <strong>Error:</strong> {error}
          </div>
        )}

        {/* Loading State */}
        {loading && (
          <div className="bg-white rounded-lg shadow p-6 text-center">
            <div className="animate-pulse">Loading runbooks...</div>
          </div>
        )}

        {/* Runbooks Grid */}
        {!loading && filteredRunbooks.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredRunbooks.map(runbook => (
              <Link
                key={runbook.id}
                href={`/admin/runbooks/${runbook.slug}`}
                className="bg-white rounded-lg shadow hover:shadow-lg transition-shadow p-6 border border-gray-200 hover:border-blue-500"
              >
                <h2 className="text-lg font-semibold text-gray-900 mb-2 line-clamp-2">
                  {runbook.title}
                </h2>
                
                {runbook.purpose && (
                  <p className="text-sm text-gray-600 mb-3 line-clamp-2">
                    {runbook.purpose}
                  </p>
                )}
                
                {/* Tags */}
                <div className="flex flex-wrap gap-1 mb-3">
                  {runbook.tags.slice(0, 3).map(tag => (
                    <span
                      key={tag}
                      className={`px-2 py-0.5 rounded text-xs font-medium ${TAG_COLORS[tag]}`}
                    >
                      {tag}
                    </span>
                  ))}
                  {runbook.tags.length > 3 && (
                    <span className="px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-600">
                      +{runbook.tags.length - 3}
                    </span>
                  )}
                </div>
                
                {/* Metadata */}
                <div className="text-xs text-gray-500 space-y-1">
                  {runbook.canonicalId && (
                    <div>ID: {runbook.canonicalId}</div>
                  )}
                  {runbook.lastUpdated && (
                    <div>Updated: {runbook.lastUpdated}</div>
                  )}
                  {runbook.version && (
                    <div>Version: {runbook.version}</div>
                  )}
                </div>
              </Link>
            ))}
          </div>
        )}

        {/* No Results */}
        {!loading && filteredRunbooks.length === 0 && runbooks.length > 0 && (
          <div className="bg-white rounded-lg shadow p-6 text-center text-gray-500">
            No runbooks match your filters. Try adjusting your search or tags.
          </div>
        )}

        {/* No Runbooks */}
        {!loading && runbooks.length === 0 && (
          <div className="bg-white rounded-lg shadow p-6 text-center text-gray-500">
            No runbooks available.
          </div>
        )}
      </div>
    </div>
  );
}
