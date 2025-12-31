"use client";

/**
 * Timeline Chain View Page
 * 
 * Minimal UI to display the evidence-backed chain for an Issue.
 * Shows: Issue ↔ PR ↔ Run ↔ Deploy ↔ Verdict (and artifacts)
 * 
 * E72.4 (I724): Query API "Chain for Issue" + minimal UI node view
 * 
 * Features:
 * - Deterministic node display order
 * - Evidence fields: node IDs, timestamps, links
 * - Minimal, functional design
 */

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { API_ROUTES } from "@/lib/api-routes";

interface TimelineNode {
  id: string;
  source_system: "github" | "afu9";
  source_type: string;
  source_id: string;
  node_type: "ISSUE" | "PR" | "RUN" | "DEPLOY" | "VERDICT" | "ARTIFACT" | "COMMENT";
  title: string | null;
  url: string | null;
  payload_json: Record<string, unknown>;
  lawbook_version: string | null;
  created_at: string;
  updated_at: string;
}

interface TimelineEdge {
  id: string;
  from_node_id: string;
  to_node_id: string;
  edge_type: string;
  payload_json: Record<string, unknown>;
  created_at: string;
}

interface ChainResponse {
  issueId: string;
  sourceSystem: string;
  nodes: TimelineNode[];
  edges: TimelineEdge[];
  metadata: {
    nodeCount: number;
    edgeCount: number;
    timestamp: string;
  };
}

const NODE_TYPE_LABELS: Record<string, string> = {
  ISSUE: "Issue",
  PR: "Pull Request",
  RUN: "Run",
  DEPLOY: "Deploy",
  VERDICT: "Verdict",
  ARTIFACT: "Artifact",
  COMMENT: "Comment",
};

const NODE_TYPE_COLORS: Record<string, string> = {
  ISSUE: "bg-blue-100 text-blue-800",
  PR: "bg-purple-100 text-purple-800",
  RUN: "bg-yellow-100 text-yellow-800",
  DEPLOY: "bg-green-100 text-green-800",
  VERDICT: "bg-red-100 text-red-800",
  ARTIFACT: "bg-gray-100 text-gray-800",
  COMMENT: "bg-orange-100 text-orange-800",
};

export default function TimelineChainPage() {
  const params = useParams();
  const issueId = params?.issueId as string;

  const [chain, setChain] = useState<ChainResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sourceSystem, setSourceSystem] = useState<"github" | "afu9">("afu9");

  useEffect(() => {
    if (!issueId) {
      setError("No issue ID provided");
      setIsLoading(false);
      return;
    }

    const fetchChain = async () => {
      try {
        setIsLoading(true);
        setError(null);

        const url = API_ROUTES.timeline.chain(issueId, sourceSystem);
        const response = await fetch(url);

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.error || `HTTP ${response.status}`);
        }

        const data: ChainResponse = await response.json();
        setChain(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to fetch chain");
      } finally {
        setIsLoading(false);
      }
    };

    fetchChain();
  }, [issueId, sourceSystem]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 p-8">
        <div className="max-w-4xl mx-auto">
          <p className="text-gray-600">Loading timeline chain...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 p-8">
        <div className="max-w-4xl mx-auto">
          <div className="bg-red-50 border border-red-200 rounded-lg p-4">
            <h2 className="text-red-800 font-semibold mb-2">Error</h2>
            <p className="text-red-600">{error}</p>
          </div>
          <Link href="/issues" className="text-blue-600 hover:underline mt-4 inline-block">
            ← Back to Issues
          </Link>
        </div>
      </div>
    );
  }

  if (!chain) {
    return (
      <div className="min-h-screen bg-gray-50 p-8">
        <div className="max-w-4xl mx-auto">
          <p className="text-gray-600">No chain data available</p>
        </div>
      </div>
    );
  }

  const getNodeColor = (nodeType: string) => {
    return NODE_TYPE_COLORS[nodeType] || "bg-gray-100 text-gray-800";
  };

  const getNodeLabel = (nodeType: string) => {
    return NODE_TYPE_LABELS[nodeType] || nodeType;
  };

  const formatTimestamp = (timestamp: string) => {
    try {
      return new Date(timestamp).toLocaleString();
    } catch {
      return timestamp;
    }
  };

  const getConnectedNodes = (nodeId: string) => {
    const outgoing = chain.edges.filter(e => e.from_node_id === nodeId);
    const incoming = chain.edges.filter(e => e.to_node_id === nodeId);
    return { outgoing, incoming };
  };

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <Link href="/issues" className="text-blue-600 hover:underline mb-4 inline-block">
            ← Back to Issues
          </Link>
          <h1 className="text-3xl font-bold text-gray-900 mb-2">
            Timeline Chain
          </h1>
          <div className="flex items-center gap-4 text-sm text-gray-600">
            <span>Issue ID: <code className="bg-gray-200 px-2 py-1 rounded">{chain.issueId}</code></span>
            <span>Source: <code className="bg-gray-200 px-2 py-1 rounded">{chain.sourceSystem}</code></span>
          </div>
        </div>

        {/* Source System Selector */}
        <div className="mb-6">
          <label className="text-sm font-medium text-gray-700 mr-3">Source System:</label>
          <select
            value={sourceSystem}
            onChange={(e) => setSourceSystem(e.target.value as "github" | "afu9")}
            className="border border-gray-300 rounded px-3 py-1 text-sm"
          >
            <option value="afu9">AFU-9</option>
            <option value="github">GitHub</option>
          </select>
        </div>

        {/* Metadata */}
        <div className="bg-white rounded-lg shadow p-6 mb-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Chain Metadata</h2>
          <div className="grid grid-cols-3 gap-4 text-sm">
            <div>
              <span className="text-gray-600">Node Count:</span>
              <span className="ml-2 font-semibold text-gray-900">{chain.metadata.nodeCount}</span>
            </div>
            <div>
              <span className="text-gray-600">Edge Count:</span>
              <span className="ml-2 font-semibold text-gray-900">{chain.metadata.edgeCount}</span>
            </div>
            <div>
              <span className="text-gray-600">Query Time:</span>
              <span className="ml-2 font-semibold text-gray-900">{formatTimestamp(chain.metadata.timestamp)}</span>
            </div>
          </div>
        </div>

        {/* Nodes List */}
        <div className="bg-white rounded-lg shadow">
          <div className="p-6 border-b border-gray-200">
            <h2 className="text-lg font-semibold text-gray-900">Timeline Nodes</h2>
            <p className="text-sm text-gray-600 mt-1">
              Ordered deterministically by node type, creation time, and ID
            </p>
          </div>

          <div className="divide-y divide-gray-200">
            {chain.nodes.length === 0 ? (
              <div className="p-6 text-center text-gray-600">
                No nodes found in chain
              </div>
            ) : (
              chain.nodes.map((node, index) => {
                const { outgoing, incoming } = getConnectedNodes(node.id);
                
                return (
                  <div key={node.id} className="p-6 hover:bg-gray-50">
                    {/* Node Header */}
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex items-center gap-3">
                        <span className="text-gray-500 font-mono text-sm">#{index + 1}</span>
                        <span className={`px-3 py-1 rounded-full text-xs font-semibold ${getNodeColor(node.node_type)}`}>
                          {getNodeLabel(node.node_type)}
                        </span>
                        {node.title && (
                          <h3 className="font-semibold text-gray-900">{node.title}</h3>
                        )}
                      </div>
                    </div>

                    {/* Node Details */}
                    <div className="grid grid-cols-2 gap-3 text-sm mb-3">
                      <div>
                        <span className="text-gray-600">Node ID:</span>
                        <code className="ml-2 text-xs bg-gray-100 px-2 py-1 rounded">{node.id}</code>
                      </div>
                      <div>
                        <span className="text-gray-600">Source:</span>
                        <code className="ml-2 text-xs bg-gray-100 px-2 py-1 rounded">
                          {node.source_system}:{node.source_type}:{node.source_id}
                        </code>
                      </div>
                      <div>
                        <span className="text-gray-600">Created:</span>
                        <span className="ml-2 text-gray-900">{formatTimestamp(node.created_at)}</span>
                      </div>
                      <div>
                        <span className="text-gray-600">Updated:</span>
                        <span className="ml-2 text-gray-900">{formatTimestamp(node.updated_at)}</span>
                      </div>
                    </div>

                    {/* URL if available */}
                    {node.url && (
                      <div className="mb-3">
                        <a
                          href={node.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-600 hover:underline text-sm"
                        >
                          View Source →
                        </a>
                      </div>
                    )}

                    {/* Lawbook Version */}
                    {node.lawbook_version && (
                      <div className="mb-3 text-sm">
                        <span className="text-gray-600">Lawbook Version:</span>
                        <code className="ml-2 text-xs bg-gray-100 px-2 py-1 rounded">{node.lawbook_version}</code>
                      </div>
                    )}

                    {/* Connections */}
                    {(outgoing.length > 0 || incoming.length > 0) && (
                      <div className="mt-3 pt-3 border-t border-gray-200">
                        <p className="text-xs text-gray-600 mb-2">Connections:</p>
                        <div className="flex flex-wrap gap-2">
                          {incoming.map((edge) => (
                            <span key={edge.id} className="text-xs bg-blue-50 text-blue-700 px-2 py-1 rounded">
                              ← {edge.edge_type}
                            </span>
                          ))}
                          {outgoing.map((edge) => (
                            <span key={edge.id} className="text-xs bg-green-50 text-green-700 px-2 py-1 rounded">
                              {edge.edge_type} →
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Edges Section */}
        {chain.edges.length > 0 && (
          <div className="bg-white rounded-lg shadow mt-6">
            <div className="p-6 border-b border-gray-200">
              <h2 className="text-lg font-semibold text-gray-900">Edges</h2>
              <p className="text-sm text-gray-600 mt-1">
                Relationships between nodes
              </p>
            </div>
            <div className="divide-y divide-gray-200">
              {chain.edges.map((edge, index) => (
                <div key={edge.id} className="p-4 text-sm">
                  <div className="flex items-center gap-3 mb-2">
                    <span className="text-gray-500 font-mono">#{index + 1}</span>
                    <span className="font-semibold text-gray-900">{edge.edge_type}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-3 text-xs text-gray-600">
                    <div>
                      <span>From:</span>
                      <code className="ml-2 bg-gray-100 px-2 py-1 rounded">{edge.from_node_id}</code>
                    </div>
                    <div>
                      <span>To:</span>
                      <code className="ml-2 bg-gray-100 px-2 py-1 rounded">{edge.to_node_id}</code>
                    </div>
                    <div>
                      <span>Created:</span>
                      <span className="ml-2">{formatTimestamp(edge.created_at)}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
