import {
  EvaluationInput,
  EvaluationResult,
  FactoryAction,
  MatchedRuleResult,
  PolicyAction,
  PolicyDocument,
  PolicyRule,
} from './types';

const ALLOWED_IDENTIFIERS = new Set([
  'ci.status',
  'security.critical_count',
  'security.high_count',
  'change_flags.infra_change',
  'change_flags.db_migration',
  'change_flags.auth_change',
  'change_flags.secrets_change',
  'change_flags.dependency_change',
  'canary.error_rate',
  'canary.latency_delta',
]);

const SEVERITY_ORDER: PolicyRule['severity'][] = ['BLOCK', 'HIGH', 'INFO'];

export function evaluatePolicy(policy: PolicyDocument, input: EvaluationInput): EvaluationResult {
  // Determinism and fail-fast: validate required input fields are present
  assertInputComplete(input);

  const learningMode = policy.defaults?.learning_mode === true;

  const matched: MatchedRuleResult[] = [];

  for (const rule of policy.rules) {
    const ok = evaluateCondition(rule.when, input);
    if (ok) {
      matched.push({
        id: rule.id,
        severity: rule.severity,
        action: rule.then,
        reason: rule.reason,
      });
      // BLOCK rules override everything; fail-fast on highest severity match
      if (rule.severity === 'BLOCK') {
        break;
      }
    }
  }

  if (matched.length === 0) {
    return {
      matched,
      highestSeverity: 'NONE',
      proposedAction: 'NONE',
      proposedFactoryAction: 'NONE',
    };
  }

  // Determine highest severity among matched
  let highest: PolicyRule['severity'] = 'INFO';
  let proposed: PolicyRule['then'] = matched[0].action;

  for (const m of matched) {
    if (compareSeverity(m.severity, highest) < 0) {
      highest = m.severity;
      proposed = m.action;
    }
  }

  return {
    matched,
    highestSeverity: highest,
    proposedAction: proposed,
    proposedFactoryAction: mapPolicyActionToFactoryAction(proposed, learningMode),
  };
}

export function mapPolicyActionToFactoryAction(action: PolicyAction | 'NONE', learningMode: boolean): FactoryAction | 'NONE' {
  if (action === 'NONE') return 'NONE';
  switch (action) {
    case 'KILL_AND_ROLLBACK':
      return 'KILL_AND_ROLLBACK';
    case 'HOLD_FOR_HUMAN':
      return 'HOLD_FOR_HUMAN';
    case 'REQUIRE_APPROVAL':
      return 'HOLD_FOR_HUMAN';
    case 'ALLOW':
      return learningMode ? 'HOLD_FOR_HUMAN' : 'APPROVE_AUTOMERGE_DEPLOY';
    default:
      throw new Error(`Unknown policy action: ${action}`);
  }
}

function compareSeverity(a: PolicyRule['severity'], b: PolicyRule['severity']): number {
  return SEVERITY_ORDER.indexOf(a) - SEVERITY_ORDER.indexOf(b);
}

function assertInputComplete(input: EvaluationInput): void {
  // All required fields must exist; missing data is a hard failure
  const requiredBooleanFlags: Array<[string, boolean]> = [
    ['change_flags.infra_change', input.change_flags?.infra_change],
    ['change_flags.db_migration', input.change_flags?.db_migration],
    ['change_flags.auth_change', input.change_flags?.auth_change],
    ['change_flags.secrets_change', input.change_flags?.secrets_change],
    ['change_flags.dependency_change', input.change_flags?.dependency_change],
  ];
  requiredBooleanFlags.forEach(([key, val]) => {
    if (typeof val !== 'boolean') {
      throw new Error(`Missing or invalid boolean input: ${key}`);
    }
  });

  const requiredNumbers: Array<[string, number]> = [
    ['security.critical_count', input.security?.critical_count],
    ['security.high_count', input.security?.high_count],
    ['canary.error_rate', input.canary?.error_rate],
    ['canary.latency_delta', input.canary?.latency_delta],
  ];
  requiredNumbers.forEach(([key, val]) => {
    if (typeof val !== 'number' || Number.isNaN(val)) {
      throw new Error(`Missing or invalid numeric input: ${key}`);
    }
  });

  if (typeof input.ci?.status !== 'string' || input.ci.status.trim() === '') {
    throw new Error('Missing or invalid input: ci.status');
  }
}

// Simple deterministic expression evaluator supporting &&, ||, and basic comparisons
function evaluateCondition(expr: string, input: EvaluationInput): boolean {
  const tokens = tokenize(expr);
  let position = 0;

  function parseExpression(): boolean {
    let value = parseTerm();
    while (match('||')) {
      const right = parseTerm();
      value = value || right;
    }
    return value;
  }

  function parseTerm(): boolean {
    let value = parseFactor();
    while (match('&&')) {
      const right = parseFactor();
      value = value && right;
    }
    return value;
  }

  function parseFactor(): boolean {
    // factor := identifier op literal
    const identifier = consumeIdentifier();
    const operator = consumeOperator();
    const literal = consumeLiteral();
    return evaluateComparison(identifier, operator, literal, input);
  }

  function consumeIdentifier(): string {
    const t = tokens[position];
    if (!t || t.type !== 'identifier') {
      throw new Error(`Expected identifier at token ${position}`);
    }
    position++;
    return t.value;
  }

  function consumeOperator(): string {
    const t = tokens[position];
    if (!t || t.type !== 'operator') {
      throw new Error(`Expected operator at token ${position}`);
    }
    position++;
    return t.value;
  }

  function consumeLiteral(): string {
    const t = tokens[position];
    if (!t || t.type !== 'literal') {
      throw new Error(`Expected literal at token ${position}`);
    }
    position++;
    return t.value;
  }

  function match(symbol: string): boolean {
    const t = tokens[position];
    if (t && t.type === 'logic' && t.value === symbol) {
      position++;
      return true;
    }
    return false;
  }

  const result = parseExpression();

  if (position !== tokens.length) {
    throw new Error(`Unexpected tokens remaining at position ${position}`);
  }

  return result;
}

function evaluateComparison(
  identifier: string,
  operator: string,
  literal: string,
  input: EvaluationInput
): boolean {
  if (!ALLOWED_IDENTIFIERS.has(identifier)) {
    throw new Error(`Unknown identifier in condition: ${identifier}`);
  }

  const value = getValue(identifier, input);
  const parsedLiteral = parseLiteral(literal);

  switch (operator) {
    case '==':
      return value === parsedLiteral;
    case '!=':
      return value !== parsedLiteral;
    case '>':
      return value > parsedLiteral;
    case '>=':
      return value >= parsedLiteral;
    case '<':
      return value < parsedLiteral;
    case '<=':
      return value <= parsedLiteral;
    default:
      throw new Error(`Unsupported operator: ${operator}`);
  }
}

function parseLiteral(raw: string): string | number | boolean {
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if (raw.startsWith('"') && raw.endsWith('"')) {
    return JSON.parse(raw);
  }
  const n = Number(raw);
  if (!Number.isNaN(n) && raw.trim() !== '') {
    return n;
  }
  throw new Error(`Invalid literal: ${raw}`);
}

function getValue(identifier: string, input: EvaluationInput): string | number | boolean {
  switch (identifier) {
    case 'ci.status':
      return input.ci.status;
    case 'security.critical_count':
      return input.security.critical_count;
    case 'security.high_count':
      return input.security.high_count;
    case 'change_flags.infra_change':
      return input.change_flags.infra_change;
    case 'change_flags.db_migration':
      return input.change_flags.db_migration;
    case 'change_flags.auth_change':
      return input.change_flags.auth_change;
    case 'change_flags.secrets_change':
      return input.change_flags.secrets_change;
    case 'change_flags.dependency_change':
      return input.change_flags.dependency_change;
    case 'canary.error_rate':
      return input.canary.error_rate;
    case 'canary.latency_delta':
      return input.canary.latency_delta;
    default:
      throw new Error(`Unhandled identifier: ${identifier}`);
  }
}

type Token =
  | { type: 'identifier'; value: string }
  | { type: 'operator'; value: string }
  | { type: 'literal'; value: string }
  | { type: 'logic'; value: string };

function tokenize(expr: string): Token[] {
  const tokens: Token[] = [];
  const patterns: Array<[RegExp, (m: string) => Token | null]> = [
    [/^\s+/, () => null],
    [/^(==|!=|>=|<=|>|<)/, (m) => ({ type: 'operator', value: m })],
    [/^(&&|\|\|)/, (m) => ({ type: 'logic', value: m })],
    [/^"(?:[^"\\]|\\.)*"/, (m) => ({ type: 'literal', value: m })],
    [/^(true|false)\b/, (m) => ({ type: 'literal', value: m })],
    [/^-?\d+(?:\.\d+)?/, (m) => ({ type: 'literal', value: m })],
    [/^[A-Za-z_][A-Za-z0-9_.]*/, (m) => ({ type: 'identifier', value: m })],
  ];

  let remaining = expr;
  while (remaining.length > 0) {
    let matched = false;
    for (const [re, factory] of patterns) {
      const m = re.exec(remaining);
      if (m) {
        matched = true;
        const token = factory(m[0]);
        if (token) tokens.push(token);
        remaining = remaining.slice(m[0].length);
        break;
      }
    }
    if (!matched) {
      throw new Error(`Unable to tokenize expression near: ${remaining}`);
    }
  }

  return tokens;
}
