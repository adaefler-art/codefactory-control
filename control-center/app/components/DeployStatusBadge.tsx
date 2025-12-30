"use client";

import { useEffect, useState } from "react";
import { DeployStatusResponse, DeployStatus } from "@/lib/contracts/deployStatus";
import { API_ROUTES } from "@/lib/api-routes";

interface DeployStatusBadgeProps {
  env?: string;
  className?: string;
  showLabel?: boolean;
  refreshInterval?: number; // milliseconds
}

const statusColors: Record<DeployStatus, { bg: string; text: string; border: string }> = {
  GREEN: {
    bg: "bg-green-900/30",
    text: "text-green-400",
    border: "border-green-500/50",
  },
  YELLOW: {
    bg: "bg-yellow-900/30",
    text: "text-yellow-400",
    border: "border-yellow-500/50",
  },
  RED: {
    bg: "bg-red-900/30",
    text: "text-red-400",
    border: "border-red-500/50",
  },
};

const statusIcons: Record<DeployStatus, string> = {
  GREEN: "●",
  YELLOW: "⚠",
  RED: "✖",
};

export default function DeployStatusBadge({
  env = "prod",
  className = "",
  showLabel = true,
  refreshInterval = 60000, // 1 minute default
}: DeployStatusBadgeProps) {
  const [status, setStatus] = useState<DeployStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchStatus = async () => {
    try {
      const response = await fetch(API_ROUTES.deploy.status(env));
      if (!response.ok) {
        throw new Error(`Failed to fetch status: ${response.status}`);
      }
      const data: DeployStatusResponse = await response.json();
      setStatus(data);
      setError(null);
    } catch (err) {
      console.error("Failed to fetch deploy status:", err);
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStatus();

    // Set up polling
    const interval = setInterval(fetchStatus, refreshInterval);

    return () => clearInterval(interval);
  }, [env, refreshInterval]);

  if (loading) {
    return (
      <div className={`inline-flex items-center px-2 py-1 rounded-md border border-gray-700 bg-gray-800/30 ${className}`}>
        <span className="text-gray-400 text-xs">Loading...</span>
      </div>
    );
  }

  if (error || !status) {
    return (
      <div className={`inline-flex items-center px-2 py-1 rounded-md border border-gray-700 bg-gray-800/30 ${className}`}>
        <span className="text-gray-400 text-xs">Status unavailable</span>
      </div>
    );
  }

  const colors = statusColors[status.status];
  const icon = statusIcons[status.status];

  // Create tooltip with reason summary
  const tooltip = status.reasons
    .map((r) => `${r.severity.toUpperCase()}: ${r.message}`)
    .join("\n");

  return (
    <div
      className={`inline-flex items-center px-2 py-1 rounded-md border ${colors.border} ${colors.bg} cursor-help ${className}`}
      title={tooltip}
    >
      <span className={`${colors.text} text-sm mr-1`}>{icon}</span>
      {showLabel && (
        <>
          <span className={`${colors.text} text-xs font-medium`}>{status.status}</span>
          <span className="text-gray-500 text-xs ml-1">({env})</span>
        </>
      )}
    </div>
  );
}
