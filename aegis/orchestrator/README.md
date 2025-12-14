# AEGIS Orchestrator v1 (MVP)

- plan(): deterministic action planning from a valid aegis.verdict.v1 with confidence/learning_mode gates.
- execute(): idempotent adapter execution with status transitions PROPOSED→APPROVED→EXECUTED→VERIFIED (FAILED terminal), audit logged.
- Audit: append-only JSONL at ./aegis_audit.log.jsonl (schema: aegis/orchestrator/audit.schema.json).
- Explain: renderShort/renderLong provide deterministic summaries from verdict + plan.
- CLI: `orchestrator <explain|plan|execute> --verdict <path> [--minConfidence 0.85] [--dryRun]`.
- Safeguards: no auto-exec in learning_mode; confidence gate for APPROVE_AUTOMERGE_DEPLOY; validation against verdict schema; fail-fast on invalid inputs.
