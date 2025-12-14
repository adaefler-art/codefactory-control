# AEGIS Verdict Engine v1

- Schema: aegis/verdict/schema.json (`aegis.verdict.v1`), validated via Ajv.
- Inputs: policy evaluation snapshot, signals (CI/security/canary), change summary, learning_mode, and run metadata.
- Scoring: weighted dimensions (tests 25%, security 25%, ops 20%, risk 15%, policy 15%); risk_level from overall with infra/db_migration override to MEDIUM/HIGH.
- Actions: base on policy proposed_factory_action, overridden by CI/canary/security failures; learning_mode prevents auto-approve (forces HOLD_FOR_HUMAN).
- Confidence: deterministic from overall + risk_level, clamped to 0–1.
- Rationale: template summary, deterministic recommended_next_steps keyed to blockers/risk flags; no LLMs or randomness.
- Tests: `npm test` runs verdict engine specs under aegis/verdict/__tests__.
