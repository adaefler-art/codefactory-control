"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { safeFetch, formatErrorMessage } from "@/lib/api/safe-fetch";

interface Workflow {
  id: string;
  name: string;
  description: string;
  definition: {
    steps?: Array<{
      name: string;
      tool: string;
      params?: Record<string, unknown>;
    }>;
  };
  version: number;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export default function WorkflowsPage() {
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedWorkflow, setSelectedWorkflow] = useState<Workflow | null>(null);
  const [executionInput, setExecutionInput] = useState("");
  const [isExecuting, setIsExecuting] = useState(false);

  useEffect(() => {
    async function fetchWorkflows() {
      try {
        const response = await fetch("/api/workflows", { credentials: "include" });
        const data = await safeFetch(response);
        setWorkflows(data.workflows || []);
      } catch (err) {
        console.error("Error fetching workflows:", err);
        setError(formatErrorMessage(err));
      } finally {
        setIsLoading(false);
      }
    }

    fetchWorkflows();
  }, []);

  const handleExecuteWorkflow = async (workflow: Workflow) => {
    setIsExecuting(true);
    try {
      let input = {};
      if (executionInput.trim()) {
        try {
          input = JSON.parse(executionInput);
        } catch {
          alert("Invalid JSON input");
          setIsExecuting(false);
          return;
        }
      }

      const response = await fetch("/api/workflow/execute", {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          workflow: workflow.definition,
          context: {
            input,
            repo: {
              owner: "adaefler-art",
              name: "codefactory-control",
              default_branch: "main",
            },
          },
        }),
      });

      const result = await safeFetch(response);
      alert(`Workflow executed successfully!\nExecution ID: ${result.executionId}`);
      setSelectedWorkflow(null);
      setExecutionInput("");
    } catch (err) {
      console.error("Error executing workflow:", err);
      alert(`Fehler: ${formatErrorMessage(err)}`);
    } finally {
      setIsExecuting(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0d1117] text-gray-200">
      <div className="border-b border-gray-800 bg-[#161b22]">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <h1 className="text-2xl font-semibold text-gray-200">Workflows</h1>
          <p className="text-sm text-gray-400 mt-1">
            Verfügbare Workflow-Definitionen und deren Ausführung
          </p>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-8">
        {isLoading && (
          <div className="text-center py-12">
            <p className="text-gray-400">Lädt Workflows...</p>
          </div>
        )}

        {error && (
          <div className="bg-red-900/20 border border-red-800 rounded-lg p-4 mb-6">
            <p className="text-red-300">{error}</p>
          </div>
        )}

        {!isLoading && !error && workflows.length === 0 && (
          <div className="bg-gray-900/50 border border-gray-800 rounded-lg p-8 text-center">
            <p className="text-gray-400">Keine Workflows gefunden</p>
          </div>
        )}

        {!isLoading && !error && workflows.length > 0 && (
          <div className="space-y-4">
            {workflows.map((workflow) => (
              <div
                key={workflow.id}
                className="bg-gray-900/50 border border-gray-800 rounded-lg p-6 hover:bg-gray-900/70 transition-colors"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2">
                      <h2 className="text-xl font-semibold text-gray-200">
                        {workflow.name}
                      </h2>
                      <span
                        className={`text-xs px-2 py-1 rounded ${
                          workflow.enabled
                            ? "bg-green-900/30 text-green-400"
                            : "bg-gray-900/30 text-gray-400"
                        }`}
                      >
                        {workflow.enabled ? "Enabled" : "Disabled"}
                      </span>
                      <span className="text-xs text-gray-500">v{workflow.version}</span>
                    </div>
                    <p className="text-sm text-gray-400 mb-4">{workflow.description}</p>
                    <div className="flex items-center gap-4 text-xs text-gray-500">
                      <span>
                        {workflow.definition?.steps?.length || 0} steps
                      </span>
                      <span>•</span>
                      <span>
                        Created: {new Date(workflow.createdAt).toLocaleDateString("de-DE")}
                      </span>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setSelectedWorkflow(workflow)}
                      disabled={!workflow.enabled}
                      className={`px-4 py-2 rounded text-sm font-medium transition-colors ${
                        workflow.enabled
                          ? "bg-blue-600 hover:bg-blue-700 text-white"
                          : "bg-gray-800 text-gray-500 cursor-not-allowed"
                      }`}
                    >
                      Execute
                    </button>
                    <Link
                      href={`/workflow/${workflow.id}`}
                      className="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded text-sm font-medium transition-colors"
                    >
                      View
                    </Link>
                  </div>
                </div>

                {/* Workflow Steps Preview */}
                {workflow.definition?.steps && workflow.definition.steps.length > 0 && (
                  <div className="mt-4 pt-4 border-t border-gray-800">
                    <div className="text-xs text-gray-400 mb-2">Steps:</div>
                    <div className="flex flex-wrap gap-2">
                      {workflow.definition.steps.slice(0, 5).map((step, index: number) => (
                        <span
                          key={index}
                          className="text-xs px-2 py-1 bg-gray-800/50 text-gray-400 rounded"
                        >
                          {index + 1}. {step.name}
                        </span>
                      ))}
                      {workflow.definition.steps.length > 5 && (
                        <span className="text-xs px-2 py-1 text-gray-500">
                          +{workflow.definition.steps.length - 5} more
                        </span>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Execute Workflow Modal */}
      {selectedWorkflow && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-900 border border-gray-700 rounded-lg p-6 max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <h3 className="text-xl font-semibold text-gray-200 mb-4">
              Execute Workflow: {selectedWorkflow.name}
            </h3>
            
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Input (JSON)
              </label>
              <textarea
                value={executionInput}
                onChange={(e) => setExecutionInput(e.target.value)}
                className="w-full h-32 px-3 py-2 bg-gray-800 border border-gray-700 rounded text-gray-200 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder='{"issue_number": 123, "cluster": "production"}'
              />
              <p className="text-xs text-gray-500 mt-1">
                Provide workflow input as JSON. Leave empty for default values.
              </p>
            </div>

            <div className="mb-4 p-4 bg-gray-800/50 rounded">
              <div className="text-xs text-gray-400 mb-2">Workflow Steps:</div>
              <ol className="text-sm text-gray-300 space-y-1">
                {selectedWorkflow.definition?.steps?.map((step, index: number) => (
                  <li key={index} className="flex gap-2">
                    <span className="text-gray-500">{index + 1}.</span>
                    <span>{step.name} ({step.tool})</span>
                  </li>
                ))}
              </ol>
            </div>

            <div className="flex gap-3 justify-end">
              <button
                onClick={() => {
                  setSelectedWorkflow(null);
                  setExecutionInput("");
                }}
                disabled={isExecuting}
                className="px-4 py-2 text-gray-400 hover:text-gray-200 transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={() => handleExecuteWorkflow(selectedWorkflow)}
                disabled={isExecuting}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded transition-colors disabled:opacity-50"
              >
                {isExecuting ? "Executing..." : "Execute Workflow"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
