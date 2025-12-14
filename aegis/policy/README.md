# AEGIS Policy DSL v1 (Deterministic)

- Policy file: aegis.policy.yml (canonical copy at repository root)
- Version: aegis.policy.v1
- Evaluation: rules are processed top-down; first BLOCK match short-circuits evaluation. Highest severity among matched rules determines the proposed action.
- Validation: JSON Schema (Ajv, draft-07) with `additionalProperties: false` on every object plus explicit identifier allowlist; any unknown keys or identifiers fail fast.
- Inputs: all required fields must be present; missing CI, security, change flags, or canary inputs raise errors.
- Tests: `npm run test` executes the policy validator/evaluator suite.
- Literals: string literals must be double-quoted (e.g., `ci.status == "success"`). Bare words are treated as identifiers only; using an unquoted word where a literal is expected fails fast. Booleans (true/false) and numbers are supported as literals without quotes.
- Action mapping: evaluator returns both `proposedAction` (policy) and `proposedFactoryAction` (factory vocabulary). Mapping is deterministic via `mapPolicyActionToFactoryAction(action, learning_mode)`: KILL_AND_ROLLBACK → KILL_AND_ROLLBACK; HOLD_FOR_HUMAN → HOLD_FOR_HUMAN; REQUIRE_APPROVAL → HOLD_FOR_HUMAN; ALLOW → HOLD_FOR_HUMAN when learning_mode=true, otherwise APPROVE_AUTOMERGE_DEPLOY.
