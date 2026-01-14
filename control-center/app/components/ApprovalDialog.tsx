/**
 * Approval Dialog Component (E87.1)
 * 
 * UI dialog for obtaining explicit human approval for dangerous operations.
 * 
 * Features:
 * - Action summary (what/where/impact)
 * - Required phrase input (signed "yes")
 * - Optional reason input
 * - Disabled confirm until phrase matches
 * - Visual feedback on phrase validation
 * 
 * Usage:
 * ```tsx
 * <ApprovalDialog
 *   isOpen={showDialog}
 *   actionType="merge"
 *   actionSummary={{
 *     title: "Merge Pull Request",
 *     target: "owner/repo#123",
 *     impact: "Will merge PR into main branch",
 *     riskFlags: ["Production deployment", "Database migration"]
 *   }}
 *   onApprove={(signedPhrase, reason) => handleApprove(signedPhrase, reason)}
 *   onCancel={() => setShowDialog(false)}
 * />
 * ```
 */

'use client';

import { useState, useEffect } from 'react';
import { ActionType, getRequiredPhrase, validateSignedPhrase } from '@/lib/approvals/approval-gate';

export interface ActionSummary {
  title: string;
  target: string;
  impact: string;
  riskFlags?: string[];
  details?: Record<string, any>;
}

export interface ApprovalDialogProps {
  isOpen: boolean;
  actionType: ActionType;
  actionSummary: ActionSummary;
  onApprove: (signedPhrase: string, reason?: string) => void;
  onCancel: () => void;
  isProcessing?: boolean;
}

export function ApprovalDialog({
  isOpen,
  actionType,
  actionSummary,
  onApprove,
  onCancel,
  isProcessing = false,
}: ApprovalDialogProps) {
  const [signedPhrase, setSignedPhrase] = useState('');
  const [reason, setReason] = useState('');
  const [phraseValid, setPhraseValid] = useState(false);

  const requiredPhrase = getRequiredPhrase(actionType);

  // Validate phrase on every change
  useEffect(() => {
    const validation = validateSignedPhrase(signedPhrase, actionType);
    setPhraseValid(validation.valid);
  }, [signedPhrase, actionType]);

  // Reset state when dialog opens/closes
  useEffect(() => {
    if (isOpen) {
      setSignedPhrase('');
      setReason('');
      setPhraseValid(false);
    }
  }, [isOpen]);

  if (!isOpen) {
    return null;
  }

  const handleApprove = () => {
    if (phraseValid && !isProcessing) {
      onApprove(signedPhrase, reason || undefined);
    }
  };

  const getActionIcon = () => {
    switch (actionType) {
      case 'merge':
        return '🔀';
      case 'prod_operation':
        return '🚀';
      case 'destructive_operation':
        return '⚠️';
      default:
        return '⚡';
    }
  };

  const getActionColor = () => {
    switch (actionType) {
      case 'merge':
        return 'purple';
      case 'prod_operation':
        return 'blue';
      case 'destructive_operation':
        return 'red';
      default:
        return 'yellow';
    }
  };

  const color = getActionColor();
  const borderColor = `border-${color}-700`;
  const textColor = `text-${color}-400`;
  const bgColor = `bg-${color}-600`;
  const hoverBgColor = `hover:bg-${color}-700`;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className={`bg-gray-900 border ${borderColor} rounded-lg p-6 max-w-2xl mx-4 w-full`}>
        {/* Header */}
        <h3 className={`text-xl font-bold ${textColor} mb-4`}>
          {getActionIcon()} {actionSummary.title}
        </h3>

        {/* Action Summary */}
        <div className="text-gray-300 space-y-3 mb-6">
          <div className="p-3 bg-gray-800 border border-gray-700 rounded-md">
            <p className="text-sm text-gray-400">Target:</p>
            <p className="font-medium">{actionSummary.target}</p>
          </div>

          <div className="p-3 bg-gray-800 border border-gray-700 rounded-md">
            <p className="text-sm text-gray-400">Impact:</p>
            <p>{actionSummary.impact}</p>
          </div>

          {actionSummary.riskFlags && actionSummary.riskFlags.length > 0 && (
            <div className="p-3 bg-gray-800 border border-red-700 rounded-md">
              <p className="text-sm text-red-400 font-medium mb-2">⚠️ Risk Flags:</p>
              <ul className="list-disc list-inside space-y-1">
                {actionSummary.riskFlags.map((flag, idx) => (
                  <li key={idx} className="text-sm text-red-300">{flag}</li>
                ))}
              </ul>
            </div>
          )}

          {actionSummary.details && (
            <details className="p-3 bg-gray-800 border border-gray-700 rounded-md">
              <summary className="text-sm text-gray-400 cursor-pointer">Additional Details</summary>
              <pre className="mt-2 text-xs text-gray-300 overflow-auto">
                {JSON.stringify(actionSummary.details, null, 2)}
              </pre>
            </details>
          )}
        </div>

        {/* Signed Phrase Input */}
        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-300 mb-2">
            To confirm, type: <span className="font-mono font-bold text-yellow-400">{requiredPhrase}</span>
          </label>
          <input
            type="text"
            value={signedPhrase}
            onChange={(e) => setSignedPhrase(e.target.value)}
            placeholder={requiredPhrase}
            disabled={isProcessing}
            className={`w-full px-3 py-2 bg-gray-800 border rounded-md text-gray-100 font-mono focus:outline-none focus:ring-2 ${
              signedPhrase === '' 
                ? 'border-gray-700 focus:ring-gray-500' 
                : phraseValid 
                  ? 'border-green-500 focus:ring-green-500' 
                  : 'border-red-500 focus:ring-red-500'
            }`}
            autoFocus
          />
          {signedPhrase !== '' && !phraseValid && (
            <p className="mt-1 text-xs text-red-400">
              Phrase does not match. Please type exactly: {requiredPhrase}
            </p>
          )}
          {phraseValid && (
            <p className="mt-1 text-xs text-green-400">
              ✓ Phrase verified
            </p>
          )}
        </div>

        {/* Optional Reason Input */}
        <div className="mb-6">
          <label className="block text-sm font-medium text-gray-300 mb-2">
            Reason (optional)
          </label>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Why are you approving this action?"
            disabled={isProcessing}
            rows={3}
            className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-md text-gray-100 focus:outline-none focus:ring-2 focus:ring-gray-500"
          />
        </div>

        {/* Actions */}
        <div className="flex gap-3 justify-end">
          <button
            onClick={onCancel}
            disabled={isProcessing}
            className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-md font-medium transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleApprove}
            disabled={!phraseValid || isProcessing}
            className={`px-4 py-2 ${bgColor} ${hoverBgColor} text-white rounded-md font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed`}
          >
            {isProcessing ? 'Processing...' : 'Approve'}
          </button>
        </div>
      </div>
    </div>
  );
}
