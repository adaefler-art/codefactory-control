"use client";

import { useState } from "react";

// Type definitions
interface Issue {
  id: string;
  title: string;
  status: "backlog" | "in_progress" | "done";
  assignee?: string;
  priority?: "high" | "medium" | "low";
  estimate?: number;
  size?: "small" | "medium" | "large";
  linkedPRs?: number;
  subIssuesProgress?: { completed: number; total: number };
}

// Mock data
const initialIssues: Issue[] = [
  {
    id: "CF1-1",
    title: "AFU-9 Orchestrator Lambda implementieren",
    status: "done",
    assignee: "AE",
    priority: "high",
    estimate: 8,
    size: "large",
    linkedPRs: 1,
    subIssuesProgress: { completed: 3, total: 3 },
  },
  {
    id: "CF1-2",
    title: "Control Center UI mit Next.js aufsetzen",
    status: "in_progress",
    assignee: "AE",
    priority: "high",
    estimate: 5,
    size: "medium",
    linkedPRs: 0,
    subIssuesProgress: { completed: 2, total: 4 },
  },
  {
    id: "CF1-3",
    title: "GitHub Issue Interpreter Lambda",
    status: "backlog",
    assignee: "AE",
    priority: "medium",
    estimate: 3,
    size: "small",
  },
];

// Status Badge Component
function StatusBadge({ status }: { status: Issue["status"] }) {
  const colors = {
    backlog: "bg-gray-500/20 text-gray-300 border-gray-600",
    in_progress: "bg-blue-500/20 text-blue-300 border-blue-600",
    done: "bg-green-500/20 text-green-300 border-green-600",
  };

  const labels = {
    backlog: "Backlog",
    in_progress: "In progress",
    done: "Done",
  };

  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${colors[status]}`}
    >
      {labels[status]}
    </span>
  );
}

// Priority Badge Component
function PriorityBadge({ priority }: { priority?: Issue["priority"] }) {
  if (!priority) return <span className="text-gray-600">-</span>;

  const colors = {
    high: "text-red-400",
    medium: "text-yellow-400",
    low: "text-blue-400",
  };

  return (
    <span className={`text-sm font-medium ${colors[priority]}`}>
      {priority.charAt(0).toUpperCase() + priority.slice(1)}
    </span>
  );
}

// Assignee Avatar Component
function AssigneeAvatar({ assignee }: { assignee?: string }) {
  if (!assignee) return <span className="text-gray-600">-</span>;

  return (
    <div className="flex items-center justify-center w-6 h-6 rounded-full bg-blue-600 text-white text-xs font-medium">
      {assignee}
    </div>
  );
}

// Issue Row Component
function IssueRow({
  issue,
  onStatusChange,
}: {
  issue: Issue;
  onStatusChange: (id: string, newStatus: Issue["status"]) => void;
}) {
  return (
    <tr className="border-b border-gray-800 hover:bg-gray-800/30 transition-colors">
      <td className="py-3 px-4">
        <div className="flex items-center gap-2">
          <svg
            className="w-4 h-4 text-gray-600"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M9 5l7 7-7 7"
            />
          </svg>
          <span className="text-gray-400 text-xs font-mono mr-2">
            {issue.id}
          </span>
          <span className="text-gray-200 text-sm">{issue.title}</span>
        </div>
      </td>
      <td className="py-3 px-4">
        <AssigneeAvatar assignee={issue.assignee} />
      </td>
      <td className="py-3 px-4">
        <select
          value={issue.status}
          onChange={(e) =>
            onStatusChange(issue.id, e.target.value as Issue["status"])
          }
          className="bg-gray-900 border border-gray-700 text-gray-300 text-xs rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="backlog">Backlog</option>
          <option value="in_progress">In progress</option>
          <option value="done">Done</option>
        </select>
      </td>
      <td className="py-3 px-4 text-center">
        {issue.linkedPRs !== undefined ? (
          <span className="text-gray-400 text-sm">{issue.linkedPRs}</span>
        ) : (
          <span className="text-gray-600">-</span>
        )}
      </td>
      <td className="py-3 px-4">
        {issue.subIssuesProgress ? (
          <span className="text-gray-400 text-sm">
            {issue.subIssuesProgress.completed}/{issue.subIssuesProgress.total}
          </span>
        ) : (
          <span className="text-gray-600">-</span>
        )}
      </td>
      <td className="py-3 px-4">
        <PriorityBadge priority={issue.priority} />
      </td>
      <td className="py-3 px-4 text-center">
        {issue.estimate !== undefined ? (
          <span className="text-gray-400 text-sm">{issue.estimate}</span>
        ) : (
          <span className="text-gray-600">-</span>
        )}
      </td>
      <td className="py-3 px-4">
        {issue.size ? (
          <span className="text-gray-400 text-sm capitalize">{issue.size}</span>
        ) : (
          <span className="text-gray-600">-</span>
        )}
      </td>
    </tr>
  );
}

// Board Section Component
function BoardSection({
  title,
  status,
  issues,
  onStatusChange,
  onAddItem,
}: {
  title: string;
  status: Issue["status"];
  issues: Issue[];
  onStatusChange: (id: string, newStatus: Issue["status"]) => void;
  onAddItem: (status: Issue["status"]) => void;
}) {
  const totalEstimate = issues.reduce(
    (sum, issue) => sum + (issue.estimate || 0),
    0
  );

  return (
    <div className="mb-8">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-semibold text-gray-200">{title}</h2>
        <span className="text-sm text-gray-500">Estimate: {totalEstimate}</span>
      </div>

      <div className="bg-gray-900/50 border border-gray-800 rounded-lg overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-gray-800 bg-gray-900/70">
              <th className="py-2 px-4 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                Title
              </th>
              <th className="py-2 px-4 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                Assignees
              </th>
              <th className="py-2 px-4 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                Status
              </th>
              <th className="py-2 px-4 text-center text-xs font-medium text-gray-400 uppercase tracking-wider">
                Linked PRs
              </th>
              <th className="py-2 px-4 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                Sub-issues
              </th>
              <th className="py-2 px-4 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                Priority
              </th>
              <th className="py-2 px-4 text-center text-xs font-medium text-gray-400 uppercase tracking-wider">
                Estimate
              </th>
              <th className="py-2 px-4 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                Size
              </th>
            </tr>
          </thead>
          <tbody>
            {issues.length > 0 ? (
              issues.map((issue) => (
                <IssueRow
                  key={issue.id}
                  issue={issue}
                  onStatusChange={onStatusChange}
                />
              ))
            ) : (
              <tr>
                <td colSpan={8} className="py-8 text-center text-gray-600">
                  No items in this section
                </td>
              </tr>
            )}
          </tbody>
        </table>

        <div className="border-t border-gray-800 p-3">
          <button
            onClick={() => onAddItem(status)}
            className="flex items-center gap-2 text-sm text-gray-400 hover:text-gray-200 transition-colors"
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
                d="M12 4v16m8-8H4"
              />
            </svg>
            Add item
          </button>
        </div>
      </div>
    </div>
  );
}

// Add Item Modal Component
function AddItemModal({
  isOpen,
  onClose,
  onAdd,
  defaultStatus,
}: {
  isOpen: boolean;
  onClose: () => void;
  onAdd: (title: string, status: Issue["status"]) => void;
  defaultStatus: Issue["status"];
}) {
  const [title, setTitle] = useState("");
  const [status, setStatus] = useState(defaultStatus);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (title.trim()) {
      onAdd(title, status);
      setTitle("");
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
      <div className="bg-gray-900 border border-gray-700 rounded-lg p-6 max-w-md w-full mx-4">
        <h3 className="text-xl font-semibold text-gray-200 mb-4">
          Add new item
        </h3>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label
              htmlFor="title"
              className="block text-sm font-medium text-gray-300 mb-2"
            >
              Title
            </label>
            <input
              type="text"
              id="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Enter item title..."
              autoFocus
            />
          </div>
          <div>
            <label
              htmlFor="status"
              className="block text-sm font-medium text-gray-300 mb-2"
            >
              Status
            </label>
            <select
              id="status"
              value={status}
              onChange={(e) => setStatus(e.target.value as Issue["status"])}
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="backlog">Backlog</option>
              <option value="in_progress">In progress</option>
              <option value="done">Done</option>
            </select>
          </div>
          <div className="flex gap-3 justify-end">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-gray-400 hover:text-gray-200 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded transition-colors"
            >
              Add item
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// Main Board Page Component
export default function BoardPage() {
  const [issues, setIssues] = useState<Issue[]>(initialIssues);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalDefaultStatus, setModalDefaultStatus] =
    useState<Issue["status"]>("backlog");
  const [activeTab, setActiveTab] = useState("backlog");

  const handleStatusChange = (id: string, newStatus: Issue["status"]) => {
    setIssues((prevIssues) =>
      prevIssues.map((issue) =>
        issue.id === id ? { ...issue, status: newStatus } : issue
      )
    );
  };

  const handleAddItem = (status: Issue["status"]) => {
    setModalDefaultStatus(status);
    setIsModalOpen(true);
  };

  const handleCreateItem = (title: string, status: Issue["status"]) => {
    const newIssue: Issue = {
      id: `CF1-${issues.length + 1}`,
      title,
      status,
      assignee: "AE",
      priority: "medium",
    };
    setIssues((prevIssues) => [...prevIssues, newIssue]);
  };

  const backlogIssues = issues.filter((issue) => issue.status === "backlog");
  const inProgressIssues = issues.filter(
    (issue) => issue.status === "in_progress"
  );
  const doneIssues = issues.filter((issue) => issue.status === "done");

  return (
    <div className="min-h-screen bg-[#0d1117] text-gray-200">
      {/* Header */}
      <div className="border-b border-gray-800 bg-[#161b22]">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <h1 className="text-xl font-semibold text-gray-200 mb-4">
            CodeFactory / AFU-9 – Release v0.1
          </h1>

          {/* Tabs */}
          <div className="flex items-center gap-4 mb-4">
            <button
              onClick={() => setActiveTab("backlog")}
              className={`px-3 py-2 text-sm font-medium rounded transition-colors ${
                activeTab === "backlog"
                  ? "bg-gray-800 text-gray-200"
                  : "text-gray-400 hover:text-gray-200"
              }`}
            >
              Backlog
            </button>
            <button
              onClick={() => setActiveTab("priority")}
              className={`px-3 py-2 text-sm font-medium rounded transition-colors ${
                activeTab === "priority"
                  ? "bg-gray-800 text-gray-200"
                  : "text-gray-400 hover:text-gray-200"
              }`}
              disabled
            >
              Priority board
            </button>
            <button
              onClick={() => setActiveTab("team")}
              className={`px-3 py-2 text-sm font-medium rounded transition-colors ${
                activeTab === "team"
                  ? "bg-gray-800 text-gray-200"
                  : "text-gray-400 hover:text-gray-200"
              }`}
              disabled
            >
              Team items
            </button>
            <button
              onClick={() => setActiveTab("roadmap")}
              className={`px-3 py-2 text-sm font-medium rounded transition-colors ${
                activeTab === "roadmap"
                  ? "bg-gray-800 text-gray-200"
                  : "text-gray-400 hover:text-gray-200"
              }`}
              disabled
            >
              Roadmap
            </button>
          </div>

          {/* Search/Filter */}
          <div className="relative">
            <input
              type="text"
              placeholder="Filter by keyword or by field"
              className="w-full max-w-md px-4 py-2 bg-[#0d1117] border border-gray-700 rounded text-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>
      </div>

      {/* Main Board Content */}
      <div className="max-w-7xl mx-auto px-6 py-8">
        <BoardSection
          title="Backlog"
          status="backlog"
          issues={backlogIssues}
          onStatusChange={handleStatusChange}
          onAddItem={handleAddItem}
        />

        <BoardSection
          title="In progress"
          status="in_progress"
          issues={inProgressIssues}
          onStatusChange={handleStatusChange}
          onAddItem={handleAddItem}
        />

        <BoardSection
          title="Done"
          status="done"
          issues={doneIssues}
          onStatusChange={handleStatusChange}
          onAddItem={handleAddItem}
        />
      </div>

      {/* Add Item Modal */}
      <AddItemModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onAdd={handleCreateItem}
        defaultStatus={modalDefaultStatus}
      />
    </div>
  );
}
