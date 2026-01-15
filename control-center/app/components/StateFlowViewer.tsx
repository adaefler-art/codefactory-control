"use client";

/**
 * State Flow Viewer Component
 * E85.3: UI: State Flow Viewer
 * 
 * Visual representation of:
 * - Current state
 * - Valid next states (enabled/disabled)
 * - Blocking reasons
 * - Next action button (only shown when allowed)
 */

import { useEffect, useState, useRef } from 'react';
import { API_ROUTES } from '@/lib/api-routes';

interface BlockingReason {
  type: 'missing_check' | 'missing_review' | 'guardrail' | 'precondition';
  description: string;
  details?: string;
}

interface NextState {
  state: string;
  enabled: boolean;
  transitionType: string;
  description: string;
  blockingReasons: BlockingReason[];
}

interface StateFlowData {
  currentState: string;
  isTerminal: boolean;
  nextStates: NextState[];
  canTransition: boolean;
}

interface StateFlowViewerProps {
  issueId: string;
  readOnly?: boolean;
  onStateTransition?: (newState: string) => void;
}

// UUID validation regex
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function StateFlowViewer({ issueId, readOnly = false, onStateTransition }: StateFlowViewerProps) {
  const [stateFlow, setStateFlow] = useState<StateFlowData | null>(null);
  const [blockersForDone, setBlockersForDone] = useState<BlockingReason[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedNextState, setSelectedNextState] = useState<string | null>(null);
  // Track if we've had a client error (4xx) to prevent retries
  const hasClientErrorRef = useRef(false);

  useEffect(() => {
    // Reset error state when issueId changes
    hasClientErrorRef.current = false;
    setError(null);
    
    // Validate issueId before fetching
    if (!issueId || typeof issueId !== 'string' || !UUID_REGEX.test(issueId)) {
      setError('Invalid issue ID');
      setIsLoading(false);
      return;
    }

    let cancelled = false;

    async function fetchStateFlow() {
      // Don't retry if we already had a client error
      if (hasClientErrorRef.current) {
        return;
      }

      setIsLoading(true);

      try {
        const response = await fetch(API_ROUTES.issues.stateFlow(issueId), {
          credentials: 'include',
          cache: 'no-store',
        });

        if (cancelled) return;

        if (!response.ok) {
          // For 4xx errors, don't retry - set error once
          if (response.status >= 400 && response.status < 500) {
            hasClientErrorRef.current = true;
            const errorData = await response.json().catch(() => ({}));
            setError(errorData.error || `Client error: ${response.status}`);
            setIsLoading(false);
            return;
          }
          throw new Error(`Failed to fetch state flow: ${response.statusText}`);
        }

        const data = await response.json();
        if (cancelled) return;

        setStateFlow(data.stateFlow);
        setBlockersForDone(data.blockersForDone);
        setError(null);
      } catch (err) {
        if (cancelled) return;
        console.error('[StateFlowViewer] Error fetching state flow:', err);
        setError(err instanceof Error ? err.message : 'Failed to load state flow');
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    fetchStateFlow();

    return () => {
      cancelled = true;
    };
  }, [issueId]);

  const getBlockingReasonIcon = (type: BlockingReason['type']) => {
    switch (type) {
      case 'missing_check':
        return '🔍';
      case 'missing_review':
        return '👀';
      case 'guardrail':
        return '🛡️';
      case 'precondition':
        return '⚠️';
      default:
        return '❌';
    }
  };

  const getTransitionTypeColor = (type: string) => {
    switch (type) {
      case 'FORWARD':
        return 'text-green-400';
      case 'BACKWARD':
        return 'text-orange-400';
      case 'PAUSE':
        return 'text-yellow-400';
      case 'RESUME':
        return 'text-blue-400';
      case 'TERMINATE':
        return 'text-red-400';
      default:
        return 'text-gray-400';
    }
  };

  if (isLoading) {
    return (
      <div className="bg-gray-900 border border-gray-800 rounded-lg p-6">
        <div className="text-center py-4">
          <div className="inline-block animate-spin rounded-full h-6 w-6 border-b-2 border-purple-500"></div>
          <p className="mt-2 text-gray-400 text-sm">Loading state flow...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-gray-900 border border-gray-800 rounded-lg p-6">
        <div className="bg-red-900/20 border border-red-700 rounded-lg p-4">
          <p className="text-red-300 text-sm">{error}</p>
        </div>
      </div>
    );
  }

  if (!stateFlow) {
    return null;
  }

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-lg overflow-hidden">
      {/* Header */}
      <div className="px-6 py-4 bg-gray-800/30 border-b border-gray-800">
        <h3 className="text-lg font-semibold text-purple-400">
          State Flow
        </h3>
        <p className="text-sm text-gray-400 mt-1">
          Based on E85.1 State Machine Specification
        </p>
      </div>

      {/* Current State */}
      <div className="p-6 border-b border-gray-800">
        <div className="flex items-center justify-between mb-2">
          <label className="text-sm font-medium text-gray-300">
            Current State
          </label>
          {stateFlow.isTerminal && (
            <span className="px-2 py-1 text-xs font-medium rounded-md bg-gray-700/30 text-gray-300 border border-gray-600">
              Terminal State
            </span>
          )}
        </div>
        <div className="px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg">
          <span className="text-xl font-bold text-purple-400">
            {stateFlow.currentState}
          </span>
        </div>
      </div>

      {/* Blockers for DONE */}
      {blockersForDone.length > 0 && (
        <div className="p-6 border-b border-gray-800 bg-orange-900/10">
          <h4 className="text-sm font-semibold text-orange-300 mb-3">
            ⚡ What's missing to reach DONE?
          </h4>
          <div className="space-y-2">
            {blockersForDone.map((blocker, idx) => (
              <div
                key={idx}
                className="flex items-start gap-3 px-3 py-2 bg-gray-800/50 border border-gray-700 rounded-md"
              >
                <span className="text-lg flex-shrink-0">
                  {getBlockingReasonIcon(blocker.type)}
                </span>
                <div className="flex-1">
                  <p className="text-sm text-gray-200">{blocker.description}</p>
                  {blocker.details && (
                    <p className="text-xs text-gray-400 mt-1">{blocker.details}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Next States */}
      {!stateFlow.isTerminal && stateFlow.nextStates.length > 0 && (
        <div className="p-6">
          <h4 className="text-sm font-semibold text-gray-300 mb-3">
            Valid Next States
          </h4>
          <div className="space-y-3">
            {stateFlow.nextStates.map((nextState) => (
              <div
                key={nextState.state}
                className={`border rounded-lg overflow-hidden transition-all ${
                  nextState.enabled
                    ? 'border-green-700 bg-green-900/10'
                    : 'border-gray-700 bg-gray-800/30 opacity-60'
                }`}
              >
                {/* State Header */}
                <div className="px-4 py-3 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <input
                      type="radio"
                      name="next-state"
                      checked={selectedNextState === nextState.state}
                      onChange={() => setSelectedNextState(nextState.state)}
                      disabled={!nextState.enabled || readOnly}
                      className="w-4 h-4"
                    />
                    <div>
                      <div className="flex items-center gap-2">
                        <span className={`text-base font-bold ${
                          nextState.enabled ? 'text-green-300' : 'text-gray-400'
                        }`}>
                          {nextState.state}
                        </span>
                        <span className={`text-xs font-medium ${getTransitionTypeColor(nextState.transitionType)}`}>
                          {nextState.transitionType}
                        </span>
                      </div>
                      <p className="text-xs text-gray-400 mt-1">
                        {nextState.description}
                      </p>
                    </div>
                  </div>
                  <div>
                    {nextState.enabled ? (
                      <span className="px-2 py-1 text-xs font-medium rounded-md bg-green-900/30 text-green-300 border border-green-700">
                        ✓ Allowed
                      </span>
                    ) : (
                      <span className="px-2 py-1 text-xs font-medium rounded-md bg-gray-700/30 text-gray-400 border border-gray-600">
                        ✗ Blocked
                      </span>
                    )}
                  </div>
                </div>

                {/* Blocking Reasons */}
                {!nextState.enabled && nextState.blockingReasons.length > 0 && (
                  <div className="px-4 py-3 bg-gray-800/50 border-t border-gray-700">
                    <p className="text-xs font-medium text-gray-400 mb-2">
                      Blocking Reasons:
                    </p>
                    <div className="space-y-1">
                      {nextState.blockingReasons.map((reason, idx) => (
                        <div key={idx} className="flex items-start gap-2">
                          <span className="text-sm flex-shrink-0">
                            {getBlockingReasonIcon(reason.type)}
                          </span>
                          <p className="text-xs text-gray-300">{reason.description}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Next Action Button */}
          {!readOnly && selectedNextState && stateFlow.nextStates.find(ns => ns.state === selectedNextState)?.enabled && (
            <div className="mt-4 pt-4 border-t border-gray-700">
              <button
                onClick={() => {
                  if (onStateTransition) {
                    onStateTransition(selectedNextState);
                  }
                }}
                className="w-full px-6 py-3 bg-green-600 hover:bg-green-700 text-white rounded-lg font-medium transition-colors flex items-center justify-center gap-2"
              >
                <span>→</span>
                <span>Transition to {selectedNextState}</span>
              </button>
              <p className="text-xs text-gray-400 text-center mt-2">
                ℹ️ This will change the issue state based on E85.1 specification
              </p>
            </div>
          )}

          {!readOnly && !stateFlow.canTransition && (
            <div className="mt-4 pt-4 border-t border-gray-700">
              <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-4 text-center">
                <p className="text-sm text-gray-400">
                  ⚠️ No transitions available. Resolve blockers to proceed.
                </p>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Terminal State Message */}
      {stateFlow.isTerminal && (
        <div className="p-6">
          <div className="bg-emerald-900/20 border border-emerald-700 rounded-lg p-4 text-center">
            <p className="text-sm text-emerald-300 font-medium">
              ✓ This issue has reached a terminal state
            </p>
            <p className="text-xs text-gray-400 mt-1">
              No further state transitions are possible
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
