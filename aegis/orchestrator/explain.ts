import { VerdictDocument } from '../verdict/types';
import { ActionPlan } from './types';

export function renderShort(verdict: VerdictDocument, plan: ActionPlan): string {
  return `Action=${plan.final_action}; Confidence=${plan.confidence}; Risk=${verdict.scorecard.risk_level}; Score=${verdict.scorecard.overall}`;
}

export function renderLong(verdict: VerdictDocument, plan: ActionPlan): string {
  const parts: string[] = [];
  parts.push(`Run ${verdict.run.run_id} repo=${verdict.run.repo} pr=${verdict.run.pr_number} sha=${verdict.run.head_sha}`);
  parts.push(`Policy action=${verdict.policy_evaluation.policy_action} -> Factory action=${verdict.policy_evaluation.proposed_factory_action}`);
  parts.push(`Verdict proposed=${verdict.verdict.proposed_action} final=${plan.final_action} confidence=${plan.confidence}`);
  parts.push(`Risk level=${verdict.scorecard.risk_level} overall=${verdict.scorecard.overall}`);
  if (verdict.inputs.learning_mode) parts.push('Learning mode active: auto-exec disabled');
  if (plan.notes) parts.push(`Notes: ${plan.notes}`);
  return parts.join(' | ');
}
