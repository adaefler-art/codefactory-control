/**
 * Diagnostic Orchestrator
 * 
 * Main entry point for running diagnostics on INTENT authoring incidents.
 * Orchestrates: Evidence Pack → Classifier → Proofs → Playbook
 */

import type { IncidentEvidencePack } from './incidentSchema';
import { validateEvidencePack, redactEvidencePack } from './incidentSchema';
import { classifyIncident, type ClassificationResult } from './classifier';
import { runProofs, type ProofRunnerOutput } from './proofs';
import { getPlaybook, type PlaybookEntry } from './playbooks';

/**
 * Next Action
 */
export interface NextAction {
  playbookId: string;
  type: 'PATCH' | 'INVESTIGATE' | 'ESCALATE';
  description: string;
  copilotPrompt: string;
}

/**
 * Diagnostic Output
 */
export interface DiagnosticOutput {
  incidentId: string;
  timestamp: string;
  classification: ClassificationResult;
  confidence: number;
  proofs: ProofRunnerOutput;
  nextAction: NextAction;
  playbook: PlaybookEntry;
}

/**
 * Diagnostic Options
 */
export interface DiagnosticOptions {
  /**
   * Skip evidence pack validation (for testing)
   */
  skipValidation?: boolean;
  
  /**
   * Skip redaction (for internal use only - NEVER in production)
   */
  skipRedaction?: boolean;
}

/**
 * Run complete diagnostic pipeline
 * 
 * @param evidencePack - Raw evidence pack (will be validated)
 * @param options - Diagnostic options
 * @returns Diagnostic output
 */
export function diagnoseIncident(
  evidencePack: unknown,
  options: DiagnosticOptions = {}
): DiagnosticOutput {
  // Step 1: Validate evidence pack
  let pack: IncidentEvidencePack;
  if (options.skipValidation) {
    pack = evidencePack as IncidentEvidencePack;
  } else {
    pack = validateEvidencePack(evidencePack);
  }
  
  // Step 2: Redact sensitive data
  if (!options.skipRedaction) {
    pack = redactEvidencePack(pack);
  }
  
  // Step 3: Classify incident
  const classification = classifyIncident(pack);
  
  // Step 4: Run required proofs
  const proofs = runProofs(pack, classification.requiredProofs);
  
  // Step 5: Get playbook
  const playbook = getPlaybook(classification.code);
  
  // Step 6: Determine next action
  const nextAction = determineNextAction(classification, proofs, playbook);
  
  // Step 7: Build output (deterministic ordering)
  const output: DiagnosticOutput = {
    incidentId: pack.incidentId,
    timestamp: new Date().toISOString(),
    classification: {
      code: classification.code,
      title: classification.title,
      description: classification.description,
      confidence: classification.confidence,
      matchedRules: [...classification.matchedRules].sort(), // Stable sort
      requiredProofs: [...classification.requiredProofs].sort(), // Stable sort
    },
    confidence: classification.confidence,
    proofs: {
      proofs: proofs.proofs.sort((a, b) => a.id.localeCompare(b.id)), // Stable sort
      summary: proofs.summary,
    },
    nextAction,
    playbook,
  };
  
  return output;
}

/**
 * Determine next action based on classification and proofs
 */
function determineNextAction(
  classification: ClassificationResult,
  proofs: ProofRunnerOutput,
  playbook: PlaybookEntry
): NextAction {
  const { summary } = proofs;
  
  // High confidence + all proofs pass = PATCH
  if (classification.confidence >= 0.85 && summary.failed === 0 && summary.insufficient === 0) {
    return {
      playbookId: playbook.id,
      type: 'PATCH',
      description: `High confidence diagnosis. Apply patch from playbook ${playbook.id}.`,
      copilotPrompt: playbook.copilotPrompt,
    };
  }
  
  // Medium confidence or some proofs insufficient = INVESTIGATE
  if (classification.confidence >= 0.60 || summary.insufficient > 0) {
    return {
      playbookId: playbook.id,
      type: 'INVESTIGATE',
      description: `Medium confidence. Investigate further before applying patch.`,
      copilotPrompt: `Review the evidence pack and proof results before proceeding.\n\n${playbook.copilotPrompt}`,
    };
  }
  
  // Low confidence = ESCALATE
  return {
    playbookId: playbook.id,
    type: 'ESCALATE',
    description: `Low confidence diagnosis. Manual investigation required.`,
    copilotPrompt: `This incident requires manual investigation. Classification: ${classification.code}\n\nEvidence suggests: ${classification.description}\n\nConsider: ${playbook.copilotPrompt}`,
  };
}

/**
 * Format diagnostic output as JSON string
 * 
 * Uses stable formatting for deterministic output.
 * 
 * @param output - Diagnostic output
 * @returns JSON string
 */
export function formatDiagnosticOutput(output: DiagnosticOutput): string {
  return JSON.stringify(output, null, 2);
}
