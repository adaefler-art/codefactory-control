"use client";

import { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { safeFetch, formatErrorMessage } from "@/lib/api/safe-fetch";
import { API_ROUTES } from "@/lib/api-routes";

interface Incident {
  id: string;
  incident_key: string;
  severity: "YELLOW" | "RED";
  status: "OPEN" | "ACKED" | "MITIGATED" | "CLOSED";
  title: string;
  summary: string | null;
  classification: any;
  lawbook_version: string | null;
  source_primary: any;
  tags: string[];
  created_at: string;
  updated_at: string;
  first_seen_at: string;
  last_seen_at: string;
}

interface Evidence {
  id: string;
  incident_id: string;
  kind: string;
  ref: any;
  sha256: string | null;
  created_at: string;
}

interface Event {
  id: string;
  incident_id: string;
  event_type: string;
  payload: any;
  created_at: string;
}

interface TimelineNode {
  link_id: string;
  link_type: string;
  timeline_node_id: string;
  node_type: string;
  node_id: string;
  created_at: string;
}

export default function IncidentDetailPage() {
  const params = useParams();
  const id = useMemo(() => {
    const routeId = params?.id;
    const candidate = Array.isArray(routeId) ? routeId[0] : routeId;
    return typeof candidate === "string" && candidate.trim().length > 0 ? candidate : "";
  }, [params?.id]);

  const hasId = id.length > 0;

  const [incident, setIncident] = useState<Incident | null>(null);
  const [evidence, setEvidence] = useState<Evidence[]>([]);
  const [events, setEvents] = useState<Event[]>([]);
  const [links, setLinks] = useState<TimelineNode[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!hasId) return;
    fetchIncidentDetails();
  }, [id, hasId]);

  if (!hasId) {
    return (
      <div className="p-6">
        <div className="text-red-600">Incident not found (missing id)</div>
        <div className="mt-4">
          <Link href="/incidents" className="text-blue-600 hover:underline">
            Back to incidents
          </Link>
        </div>
      </div>
    );
  }

  const fetchIncidentDetails = async () => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(API_ROUTES.incidents.get(id), {
        credentials: "include",
        cache: "no-store",
      });

      const data = await safeFetch(response);
      // Defensive: check if data is object and has expected properties
      if (typeof data === 'object' && data !== null && 'incident' in data && 'evidence' in data && 'events' in data && 'links' in data) {
        const d = data as { incident: Incident; evidence: Evidence[]; events: Event[]; links: TimelineNode[] };
        setIncident(d.incident);
        setEvidence(d.evidence || []);
        setEvents(d.events || []);
        setLinks(d.links || []);
      } else {
        setError('Invalid response from server');
      }
    } catch (err) {
      console.error("Error fetching incident details:", err);
      setError(formatErrorMessage(err));
    } finally {
      setIsLoading(false);
    }
  };

  const getSeverityBadgeColor = (severity: string) => {
    switch (severity) {
      case "RED":
        return "bg-red-900/30 text-red-200 border border-red-700";
      case "YELLOW":
        return "bg-yellow-900/30 text-yellow-200 border border-yellow-700";
      default:
        return "bg-gray-700/30 text-gray-200 border border-gray-600";
    }
  };

  const getStatusBadgeColor = (status: string) => {
    switch (status) {
      case "OPEN":
        return "bg-red-900/30 text-red-200 border border-red-700";
      case "ACKED":
        return "bg-yellow-900/30 text-yellow-200 border border-yellow-700";
      case "MITIGATED":
        return "bg-blue-900/30 text-blue-200 border border-blue-700";
      case "CLOSED":
        return "bg-green-900/30 text-green-200 border border-green-700";
      default:
        return "bg-gray-700/30 text-gray-200 border border-gray-600";
    }
  };

  const getEventTypeBadgeColor = (eventType: string) => {
    switch (eventType) {
      case "CREATED":
        return "bg-blue-900/30 text-blue-200 border border-blue-700";
      case "CLASSIFIED":
        return "bg-purple-900/30 text-purple-200 border border-purple-700";
      case "UPDATED":
        return "bg-gray-700/30 text-gray-200 border border-gray-600";
      case "REMEDIATION_STARTED":
        return "bg-yellow-900/30 text-yellow-200 border border-yellow-700";
      case "REMEDIATION_DONE":
        return "bg-green-900/30 text-green-200 border border-green-700";
      case "CLOSED":
        return "bg-green-900/30 text-green-200 border border-green-700";
      default:
        return "bg-gray-700/30 text-gray-200 border border-gray-600";
    }
  };

  const getLinkTypeBadgeColor = (linkType: string) => {
    switch (linkType) {
      case "TRIGGERED_BY":
        return "bg-red-900/30 text-red-200 border border-red-700";
      case "CAUSED_BY":
        return "bg-orange-900/30 text-orange-200 border border-orange-700";
      case "RELATED_TO":
        return "bg-blue-900/30 text-blue-200 border border-blue-700";
      case "REMEDIATED_BY":
        return "bg-green-900/30 text-green-200 border border-green-700";
      default:
        return "bg-gray-700/30 text-gray-200 border border-gray-600";
    }
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    if (Number.isNaN(date.getTime())) return "-";
    return date.toLocaleDateString("de-DE", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const truncateHash = (hash: string | null, length: number = 12) => {
    if (!hash) return "-";
    return hash.length > length ? `${hash.substring(0, length)}...` : hash;
  };

  const formatJsonCompact = (obj: any): string => {
    if (!obj) return "{}";
    try {
      const str = JSON.stringify(obj);
      return str.length > 100 ? `${str.substring(0, 100)}...` : str;
    } catch {
      return "{}";
    }
  };

  const getTimelineLink = (node: TimelineNode): string => {
    // Try to construct a link to the timeline or related resource
    if (node.node_type === "ISSUE") {
      return `/issues/${node.node_id}`;
    } else if (node.node_type === "RUN") {
      return `/workflows/runs/${node.node_id}`;
    } else if (node.node_type === "DEPLOY") {
      return `/deploy/${node.node_id}`;
    }
    return `/timeline`;
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-950 text-gray-100">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="text-center py-12">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-red-500"></div>
            <p className="mt-4 text-gray-400">Loading incident...</p>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-950 text-gray-100">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="bg-red-900/20 border border-red-700 rounded-lg p-4">
            <p className="text-red-300">Error: {error}</p>
            <Link
              href="/incidents"
              className="mt-4 inline-block text-red-400 hover:text-red-300"
            >
              ← Back to Incidents
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (!incident) {
    return null;
  }

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="mb-6">
          <Link
            href="/incidents"
            className="text-red-400 hover:text-red-300 mb-4 inline-block"
          >
            ← Back to Incidents
          </Link>
        </div>

        {/* Main Card */}
        <div className="bg-gray-900 border border-gray-800 rounded-lg overflow-hidden">
          {/* Title Section */}
          <div className="p-6 border-b border-gray-800">
            <h1 className="text-3xl font-bold text-red-400">{incident.title}</h1>
            <div className="mt-2 text-sm text-gray-500">
              Incident ID: {incident.id.substring(0, 8)}
            </div>
          </div>

          {/* Metadata Section */}
          <div className="p-6 border-b border-gray-800 bg-gray-800/30">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Severity */}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Severity
                </label>
                <span
                  className={`inline-block px-3 py-2 text-sm font-medium rounded-md ${getSeverityBadgeColor(
                    incident.severity
                  )}`}
                >
                  {incident.severity}
                </span>
              </div>

              {/* Status */}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Status
                </label>
                <span
                  className={`inline-block px-3 py-2 text-sm font-medium rounded-md ${getStatusBadgeColor(
                    incident.status
                  )}`}
                >
                  {incident.status}
                </span>
              </div>

              {/* Category */}
              {incident.classification?.category && (
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    Category
                  </label>
                  <div className="px-3 py-2 bg-gray-800 border border-gray-700 rounded-md text-gray-300">
                    {incident.classification.category}
                  </div>
                </div>
              )}

              {/* Confidence */}
              {incident.classification?.confidence && (
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    Confidence
                  </label>
                  <div className="px-3 py-2 bg-gray-800 border border-gray-700 rounded-md text-gray-300">
                    {incident.classification.confidence}
                  </div>
                </div>
              )}

              {/* First Seen */}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  First Seen
                </label>
                <div className="px-3 py-2 bg-gray-800 border border-gray-700 rounded-md text-gray-400">
                  {formatDate(incident.first_seen_at)}
                </div>
              </div>

              {/* Last Seen */}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Last Seen
                </label>
                <div className="px-3 py-2 bg-gray-800 border border-gray-700 rounded-md text-gray-400">
                  {formatDate(incident.last_seen_at)}
                </div>
              </div>
            </div>

            {/* Lawbook Version */}
            {incident.lawbook_version && (
              <div className="mt-4">
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Lawbook Version
                </label>
                <div className="px-3 py-2 bg-gray-800 border border-gray-700 rounded-md text-gray-400 font-mono text-sm">
                  {incident.lawbook_version}
                </div>
              </div>
            )}

            {/* Tags */}
            {incident.tags && incident.tags.length > 0 && (
              <div className="mt-4">
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Tags
                </label>
                <div className="flex flex-wrap gap-2">
                  {incident.tags.map((tag, idx) => (
                    <span
                      key={idx}
                      className="px-2 py-1 text-xs font-medium rounded-md bg-blue-900/30 text-blue-200 border border-blue-700"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Summary Section */}
          {incident.summary && (
            <div className="p-6 border-b border-gray-800">
              <label className="block text-sm font-medium text-gray-300 mb-3">
                Summary
              </label>
              <div className="px-4 py-3 bg-gray-800 border border-gray-700 rounded-md text-gray-300 whitespace-pre-wrap">
                {incident.summary}
              </div>
            </div>
          )}

          {/* Evidence Section */}
          <div className="p-6 border-b border-gray-800">
            <h2 className="text-xl font-semibold text-red-400 mb-4">
              Evidence ({evidence.length})
            </h2>
            {evidence.length === 0 ? (
              <div className="text-center py-8 text-gray-500">
                No evidence recorded
              </div>
            ) : (
              <div className="space-y-3">
                {evidence.map((ev) => (
                  <div
                    key={ev.id}
                    className="p-4 bg-gray-800/30 border border-gray-700 rounded-lg"
                  >
                    <div className="flex items-start justify-between mb-2">
                      <div>
                        <span className="px-2 py-1 text-xs font-medium rounded-md bg-purple-900/30 text-purple-200 border border-purple-700">
                          {ev.kind}
                        </span>
                      </div>
                      <div className="text-xs text-gray-500">
                        {formatDate(ev.created_at)}
                      </div>
                    </div>
                    {ev.sha256 && (
                      <div className="text-xs text-gray-400 mt-2 font-mono">
                        Hash: {truncateHash(ev.sha256)}
                      </div>
                    )}
                    <div className="text-xs text-gray-500 mt-2 font-mono bg-gray-900 p-2 rounded overflow-x-auto">
                      {formatJsonCompact(ev.ref)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Events Section */}
          <div className="p-6 border-b border-gray-800">
            <h2 className="text-xl font-semibold text-red-400 mb-4">
              Events Timeline ({events.length})
            </h2>
            {events.length === 0 ? (
              <div className="text-center py-8 text-gray-500">
                No events recorded
              </div>
            ) : (
              <div className="space-y-3">
                {events.map((event) => (
                  <div
                    key={event.id}
                    className="flex items-start gap-4 p-4 bg-gray-800/30 border border-gray-700 rounded-lg"
                  >
                    <div className="flex-shrink-0 pt-1">
                      <span
                        className={`px-2 py-1 text-xs font-medium rounded-md ${getEventTypeBadgeColor(
                          event.event_type
                        )}`}
                      >
                        {event.event_type}
                      </span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-gray-500">
                        {formatDate(event.created_at)}
                      </div>
                      {event.payload && Object.keys(event.payload).length > 0 && (
                        <div className="text-xs text-gray-400 mt-1 font-mono bg-gray-900 p-2 rounded overflow-x-auto">
                          {formatJsonCompact(event.payload)}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Related Timeline Nodes Section */}
          <div className="p-6">
            <h2 className="text-xl font-semibold text-red-400 mb-4">
              Related Timeline Nodes ({links.length})
            </h2>
            {links.length === 0 ? (
              <div className="text-center py-8 text-gray-500">
                No timeline links
              </div>
            ) : (
              <div className="space-y-3">
                {links.map((link) => (
                  <div
                    key={link.link_id}
                    className="p-4 bg-gray-800/30 border border-gray-700 rounded-lg"
                  >
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span
                          className={`px-2 py-1 text-xs font-medium rounded-md ${getLinkTypeBadgeColor(
                            link.link_type
                          )}`}
                        >
                          {link.link_type}
                        </span>
                        <span className="px-2 py-1 text-xs font-medium rounded-md bg-gray-700/30 text-gray-200 border border-gray-600">
                          {link.node_type}
                        </span>
                      </div>
                      <div className="text-xs text-gray-500">
                        {formatDate(link.created_at)}
                      </div>
                    </div>
                    <div className="mt-2">
                      <Link
                        href={getTimelineLink(link)}
                        className="text-sm text-blue-400 hover:text-blue-300 font-mono"
                      >
                        {link.node_id} →
                      </Link>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
