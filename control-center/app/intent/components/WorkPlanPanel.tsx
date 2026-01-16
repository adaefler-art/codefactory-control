"use client";

/**
 * Work Plan Panel Component
 * V09-I04: WorkPlanV1: Freies Plan-Artefakt (ohne Draft)
 * 
 * Features:
 * - Editable work plan with goals, context, options, todos, notes
 * - Auto-load and auto-save plan per session
 * - Visual editor for structured planning
 * - Hash display for change detection
 * - Empty state when no plan exists
 */

import { useEffect, useState } from "react";
import { API_ROUTES } from "@/lib/api-routes";
import type { WorkPlanContentV1, WorkPlanGoal, WorkPlanTodo, WorkPlanOption } from "@/lib/schemas/workPlan";

interface WorkPlanPanelProps {
  sessionId: string | null;
  onDraftCompiled?: () => void; // Callback when plan is compiled to draft
}

export default function WorkPlanPanel({ sessionId, onDraftCompiled }: WorkPlanPanelProps) {
  const [plan, setPlan] = useState<WorkPlanContentV1 | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isCompiling, setIsCompiling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [compileSuccess, setCompileSuccess] = useState(false);
  const [contentHash, setContentHash] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);

  // Auto-load plan when session changes
  useEffect(() => {
    if (sessionId) {
      loadPlan();
    } else {
      setPlan(null);
      setError(null);
      setContentHash(null);
      setUpdatedAt(null);
    }
  }, [sessionId]);

  const loadPlan = async () => {
    if (!sessionId) return;

    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(API_ROUTES.intent.sessions.workPlan(sessionId), {
        credentials: "include",
        cache: "no-store",
      });

      if (!response.ok) {
        throw new Error(`Failed to load work plan: ${response.statusText}`);
      }

      const data = await response.json();

      if (data.exists) {
        setPlan(data.content);
        setContentHash(data.contentHash);
        setUpdatedAt(data.updatedAt);
      } else {
        // Empty state - initialize with empty plan
        setPlan({
          goals: [],
          options: [],
          todos: [],
        });
        setContentHash(null);
        setUpdatedAt(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setIsLoading(false);
    }
  };

  const savePlan = async () => {
    if (!sessionId || !plan) return;

    setIsSaving(true);
    setError(null);
    setSaveSuccess(false);

    try {
      const response = await fetch(API_ROUTES.intent.sessions.workPlan(sessionId), {
        method: "PUT",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ content: plan }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `Failed to save work plan: ${response.statusText}`);
      }

      const data = await response.json();
      setContentHash(data.contentHash);
      setUpdatedAt(data.updatedAt);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setIsSaving(false);
    }
  };

  const compileToDraft = async () => {
    if (!sessionId) return;

    setIsCompiling(true);
    setError(null);
    setCompileSuccess(false);

    try {
      const response = await fetch(API_ROUTES.intent.sessions.compilePlanToDraft(sessionId), {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `Failed to compile plan: ${response.statusText}`);
      }

      const data = await response.json();
      setCompileSuccess(true);
      setTimeout(() => setCompileSuccess(false), 2000);
      
      // Notify parent that draft was compiled
      if (onDraftCompiled) {
        onDraftCompiled();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setIsCompiling(false);
    }
  };

  const updateContext = (context: string) => {
    if (!plan) return;
    setPlan({ ...plan, context: context || undefined });
  };

  const updateNotes = (notes: string) => {
    if (!plan) return;
    setPlan({ ...plan, notes: notes || undefined });
  };

  const addGoal = () => {
    if (!plan) return;
    const newGoal: WorkPlanGoal = {
      id: crypto.randomUUID(),
      text: '',
      completed: false,
    };
    setPlan({ ...plan, goals: [...plan.goals, newGoal] });
  };

  const updateGoal = (goalId: string, updates: Partial<WorkPlanGoal>) => {
    if (!plan) return;
    setPlan({
      ...plan,
      goals: plan.goals.map(g => g.id === goalId ? { ...g, ...updates } : g),
    });
  };

  const removeGoal = (goalId: string) => {
    if (!plan) return;
    setPlan({ ...plan, goals: plan.goals.filter(g => g.id !== goalId) });
  };

  const addTodo = () => {
    if (!plan) return;
    const newTodo: WorkPlanTodo = {
      id: crypto.randomUUID(),
      text: '',
      completed: false,
    };
    setPlan({ ...plan, todos: [...plan.todos, newTodo] });
  };

  const updateTodo = (todoId: string, updates: Partial<WorkPlanTodo>) => {
    if (!plan) return;
    setPlan({
      ...plan,
      todos: plan.todos.map(t => t.id === todoId ? { ...t, ...updates } : t),
    });
  };

  const removeTodo = (todoId: string) => {
    if (!plan) return;
    setPlan({ ...plan, todos: plan.todos.filter(t => t.id !== todoId) });
  };

  if (!sessionId) {
    return (
      <div className="p-4 text-gray-400 text-sm">
        Select or create a session to view its work plan.
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="p-4 text-gray-400 text-sm">
        Loading work plan...
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 space-y-2">
        <div className="text-red-400 text-sm">Error: {error}</div>
        <button
          onClick={loadPlan}
          className="px-3 py-1 bg-gray-700 hover:bg-gray-600 text-white text-xs rounded"
        >
          Retry
        </button>
      </div>
    );
  }

  if (!plan) {
    return (
      <div className="p-4 text-gray-400 text-sm">
        No work plan available.
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header with metadata */}
      <div className="flex items-center justify-between p-3 border-b border-gray-700">
        <div className="flex items-center gap-3">
          <h3 className="text-sm font-medium text-gray-200">Work Plan</h3>
          {contentHash && (
            <span className="text-xs font-mono text-gray-500" title={`Hash: ${contentHash}`}>
              {contentHash}
            </span>
          )}
          {updatedAt && (
            <span className="text-xs text-gray-500">
              Updated: {new Date(updatedAt).toLocaleString()}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {saveSuccess && (
            <span className="text-xs text-green-400">Saved ✓</span>
          )}
          {compileSuccess && (
            <span className="text-xs text-green-400">Compiled ✓</span>
          )}
          <button
            onClick={savePlan}
            disabled={isSaving || isCompiling}
            className="px-3 py-1 bg-purple-600 hover:bg-purple-700 disabled:bg-gray-600 text-white text-xs rounded"
          >
            {isSaving ? 'Saving...' : 'Save Plan'}
          </button>
          <button
            onClick={compileToDraft}
            disabled={isCompiling || isSaving || !contentHash}
            className="px-3 py-1 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 text-white text-xs rounded"
            title={!contentHash ? 'Save plan first' : 'Compile plan to issue draft'}
          >
            {isCompiling ? 'Compiling...' : 'Compile → Draft'}
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-6">
        {/* Context */}
        <div>
          <label className="block text-xs font-medium text-gray-300 mb-2">
            Context & Background
          </label>
          <textarea
            value={plan.context || ''}
            onChange={(e) => updateContext(e.target.value)}
            placeholder="Describe the context, constraints, and requirements..."
            className="w-full h-24 px-3 py-2 bg-gray-800 border border-gray-700 rounded text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:border-purple-500"
            maxLength={5000}
          />
        </div>

        {/* Goals */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-xs font-medium text-gray-300">
              Goals ({plan.goals.length}/50)
            </label>
            <button
              onClick={addGoal}
              disabled={plan.goals.length >= 50}
              className="px-2 py-1 bg-gray-700 hover:bg-gray-600 disabled:bg-gray-800 text-white text-xs rounded"
            >
              + Add Goal
            </button>
          </div>
          <div className="space-y-2">
            {plan.goals.map((goal) => (
              <div key={goal.id} className="flex items-start gap-2 p-2 bg-gray-800 rounded border border-gray-700">
                <input
                  type="checkbox"
                  checked={goal.completed}
                  onChange={(e) => updateGoal(goal.id, { completed: e.target.checked })}
                  className="mt-1"
                />
                <input
                  type="text"
                  value={goal.text}
                  onChange={(e) => updateGoal(goal.id, { text: e.target.value })}
                  placeholder="Goal description..."
                  className="flex-1 bg-transparent border-none text-sm text-gray-200 placeholder-gray-500 focus:outline-none"
                  maxLength={5000}
                />
                <select
                  value={goal.priority || ''}
                  onChange={(e) => updateGoal(goal.id, { priority: (e.target.value as 'HIGH' | 'MEDIUM' | 'LOW') || undefined })}
                  className="px-2 py-1 bg-gray-700 text-xs text-gray-200 rounded border-none"
                >
                  <option value="">Priority</option>
                  <option value="HIGH">High</option>
                  <option value="MEDIUM">Medium</option>
                  <option value="LOW">Low</option>
                </select>
                <button
                  onClick={() => removeGoal(goal.id)}
                  className="text-red-400 hover:text-red-300 text-xs"
                >
                  ✕
                </button>
              </div>
            ))}
            {plan.goals.length === 0 && (
              <div className="text-xs text-gray-500 italic">No goals yet. Click "+ Add Goal" to start.</div>
            )}
          </div>
        </div>

        {/* Todos */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-xs font-medium text-gray-300">
              To-Dos ({plan.todos.length}/50)
            </label>
            <button
              onClick={addTodo}
              disabled={plan.todos.length >= 50}
              className="px-2 py-1 bg-gray-700 hover:bg-gray-600 disabled:bg-gray-800 text-white text-xs rounded"
            >
              + Add Todo
            </button>
          </div>
          <div className="space-y-2">
            {plan.todos.map((todo) => (
              <div key={todo.id} className="flex items-start gap-2 p-2 bg-gray-800 rounded border border-gray-700">
                <input
                  type="checkbox"
                  checked={todo.completed}
                  onChange={(e) => updateTodo(todo.id, { completed: e.target.checked })}
                  className="mt-1"
                />
                <input
                  type="text"
                  value={todo.text}
                  onChange={(e) => updateTodo(todo.id, { text: e.target.value })}
                  placeholder="Todo item..."
                  className="flex-1 bg-transparent border-none text-sm text-gray-200 placeholder-gray-500 focus:outline-none"
                  maxLength={5000}
                />
                <button
                  onClick={() => removeTodo(todo.id)}
                  className="text-red-400 hover:text-red-300 text-xs"
                >
                  ✕
                </button>
              </div>
            ))}
            {plan.todos.length === 0 && (
              <div className="text-xs text-gray-500 italic">No todos yet. Click "+ Add Todo" to start.</div>
            )}
          </div>
        </div>

        {/* Notes */}
        <div>
          <label className="block text-xs font-medium text-gray-300 mb-2">
            Additional Notes
          </label>
          <textarea
            value={plan.notes || ''}
            onChange={(e) => updateNotes(e.target.value)}
            placeholder="Free-form notes, ideas, considerations..."
            className="w-full h-32 px-3 py-2 bg-gray-800 border border-gray-700 rounded text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:border-purple-500"
            maxLength={5000}
          />
        </div>
      </div>
    </div>
  );
}
